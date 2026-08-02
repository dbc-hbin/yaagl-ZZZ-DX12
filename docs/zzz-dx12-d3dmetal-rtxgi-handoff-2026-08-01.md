# ZZZ DX12 / D3DMetal RTXGI 작업 인수인계

> 이 문서의 초기 실험 서술 일부는 후속 실행으로 갱신되었다. 현재 권위 있는
> 상태와 다음 작업은
> `docs/zzz-dx12-rt-current-handoff-2026-08-01.md`를 먼저 참조한다.

최종 갱신: 2026-08-01 (Asia/Seoul)

이 문서는 `yaagl-dx12` 작업에서 지금까지 확인한 사실, 구현 상태,
실험 결과, 실패한 접근, 현재 디스크 상태와 다음 작업을 한곳에 보존한다.
결론과 상태는 가능한 한 2026-08-01에 다시 읽은 실제 파일, 로그, SHA-256,
앱 서명을 기준으로 한다.

## 1. 현재 결론

ZZZ의 DX12, NVIDIA 기능 메뉴 노출, DLSS 선택, DXR capability 노출까지는
성공했다. 그러나 Ray Tracing Medium 장면의 검은 배경은 해결되지 않았다.

현재 확정된 실패 사슬은 다음과 같다.

```text
D3D12/DXR capability 노출 성공
  -> ZZZ가 RTXGI D3D12 State Object를 생성
  -> D3DMetal 4.0b2가 E_INVALIDARG(0x80070057)로 거부
  -> 유효한 RTPSO/State Object가 만들어지지 않음
  -> RTXGI DispatchRays 실패
  -> RT 조명/배경이 검게 보임
```

따라서 현재 문제는 DLSS, 셰이더 캐시, 게임 설치 상태, 단순 GPU ID gate,
Metal 4 활성화 여부가 아니라 D3DMetal 4.0 beta 2의 DXR State Object 구성
경로에 있다.

아직 실제 호환성 완화 패치는 적용하지 않았다. 네 갈래 failing-HRESULT
태그를 활성 private framework에 가역 설치한 실제 product-path 실행은 한 번
완료했지만, 게임이 로그인 성공 UI에서 멈춰 RTXGI/RTPSO 경로를 한 번도
실행하지 않았다. 따라서 raw `0x8004d001`~`0x8004d004`는 아직 없다.

지원되는 Computer Use API는 bundle ID가 없는 실제 Wine 게임 창을 대상으로
지정할 수 없었다. 이를 우회하지 않고 해결하려던 same-PID AppKit host 설계도
로컬 x86_64 프로브에서 반증됐다. PID는 유지됐지만 외부 executable로
`execve`한 직후 새 ASN과 `bundleID NULL`로 재등록돼 Computer Use 대상성이
사라졌다. 현재 제약 아래 태그 stage 판별과 실제 호환성 패치는 이 지점에서
증거 부족으로 막혀 있다.

## 2. 작업 환경과 고정 경로

| 항목                | 현재 값                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| 저장소              | `/Users/hanbinnoh/Documents/yaagl-dx12`                                                   |
| Git 브랜치          | `work/zzz-gptk-dx12`                                                                      |
| 기준 HEAD           | `ca78abc29c2fc236261d088c6907d28cab6e9476`                                                |
| 앱                  | `/Users/hanbinnoh/Documents/yaagl-dx12/Yaagl ZZZ DX12.app`                                |
| Bundle ID           | `com.3shain.yaagl.nap.os.dx12`                                                            |
| 앱 Support          | `~/Library/Application Support/Yaagl ZZZ DX12`                                            |
| 활성 framework      | `~/Library/Application Support/Yaagl ZZZ DX12/wine/lib/external/D3DMetal.framework`       |
| pristine GPTK cache | `~/Library/Application Support/Yaagl ZZZ DX12/gptk/4.0b2/lib/external/D3DMetal.framework` |
| 로그                | `~/Library/Application Support/Yaagl ZZZ DX12/logs`                                       |
| 게임                | `/Applications/ZenlessZoneZero`                                                           |
| 채널                | `naposdx12`                                                                               |
| macOS               | 27.0, build `26A5388g`                                                                    |
| 하드웨어            | Apple M5 Pro, 64 GB, arm64                                                                |
| Wine                | `11.0-1-crossover-signed-experimental`                                                    |
| GPTK/D3DMetal       | `4.0b2`, x86_64/Rosetta                                                                   |

`Yaagl ZZZ DX12.app`은 2026-08-01 03:58:56 +0900에 다시 빌드됐고,
`codesign --verify --deep --strict`를 통과했다. `Info.plist`의
`LSMinimumSystemVersion`은 현재 `27.0.0`이다.

작업 트리는 큰 dirty 상태다. 기존 변경 중에는 사용자의 다른 작업도 있을
수 있으므로 관련 파일 외 변경을 되돌리거나 전체 정리하면 안 된다. 커밋과
푸시는 요청받지 않았고 수행하지 않았다.

## 3. 최종 실행 계약

ZZZ는 다음 product path로 실행한다.

```text
C:\windows\system32\steam.exe
Z:\Applications\ZenlessZoneZero\ZenlessZoneZero.exe
-use-d3d12
```

현재 고정 환경은 다음과 같다.

```text
WINE_ENABLE_TIMEOUT_FIX=1
WINEMSYNC=1
CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal
D3DM_MTL4=1
D3DM_ENABLE_METALFX=1
D3DM_SUPPORT_DXR=1
D3DM_VENDOR_ID=0x10de
D3DM_DEVICE_ID=0x2882
D3DM_DEVICE_DESCRIPTION=NVIDIA GeForce RTX 4060
```

최신 프로필에는 Metal HUD 실험을 위해 `MTL_HUD_ENABLED=1`도 기록됐다.
해상도/전체화면은 게임 설정이 소유하며 런처는 `-screen-*` 인자를 추가하지
않는다.

RTX 4060 profile은 게임의 NVIDIA gate를 통과해 DLSS/RT 메뉴를 노출하는
실험 프로필이다. 이 값이 실제 Apple GPU를 NVIDIA 하드웨어로 바꾸거나
Windows의 진짜 DLSS 실행을 뜻하지 않는다. 목표는 GPTK의 NGX/MetalFX
경로를 이용하는 것이다.

## 4. 성공한 기능과 시각 증거

사용자가 실제 게임 UI에서 다음을 확인했다.

- Ray Tracing: Enable
- Ray Tracing Level: Medium
- Super Resolution: DLSS
- DLSS quality selector (예: Balanced)
- 3840×2160 Fullscreen

과거 첨부 이미지에는 위 게임 메뉴와 M5 Pro/64 GB 하드웨어 정보가 함께
보인다. 다만 원본 임시 이미지 파일은 현재 temp 경로에서 사라졌으므로
저장소 문서에 이미지 자체를 복사하지 못했다.

같은 합성 이미지의 런처 영역에 보이는 `DXR: disabled`는 런타임 상태 연동
전의 오래된 UI다. 현재 증거로 사용하면 안 된다. 현 UI/분석기는 capability와
pipeline 상태를 분리한다. 권위 있는 RT 실패 실행은
`enabled — RTXGI pipeline failed`, RTPSO 시도가 없었던 최신 태그 실행은
`enabled — capability verified; pipeline unobserved`로 표시한다.

이미지의 `Golden Gate Beta` APFS 볼륨 화면은 macOS 27 시험 준비 과정의
역사적 기록이다. 현재 권위 있는 OS 상태는 `sw_vers`로 다시 확인한 macOS
27.0 (`26A5388g`)이다.

## 5. DX12, NVAPI, DLSS 메뉴 노출까지의 경과

### 5.1 DX12 selector

`-force-d3d12`는 Unity가 D3D11을 선택해 폐기했다. `-use-d3d12`는 반복
실행에서 다음 증거를 만들었으므로 최종 selector다.

```text
Forcing GfxDevice: Direct3D 12
Version: Direct3D 12 [level 12.1]
d3d12: loaded!
```

D3D11/MoltenVK 모듈이 보조적으로 로드되더라도 Unity `Player.log`가 선택한
renderer가 D3D12이면 이를 fallback으로 오판하지 않는다.

### 5.2 NVAPI Wine 11 pairing 문제

초기 Streamline 실패는 GPU ID 그 자체가 아니라 Wine 11 builtin PE/Unix
module pairing이었다. GPTK 4.0b2의 `nvapi64.dll` PE export name이
`nvapi.dll`이므로 Wine은 `nvapi64.so`를 자동으로 짝짓지 못했다.

Wine runtime staging에 다음 상대 symlink를 함께 두어 해결했다.

```text
lib/wine/x86_64-windows/nvapi.dll -> nvapi64.dll
lib/wine/x86_64-unix/nvapi.so -> nvapi64.so
```

이후 `NvAPI_Initialize=0`, DXGI `VendorId=0x10de`, Streamline DLSS/DLSSG
plugin `310.6.0` 초기화가 확인됐다. 게임/안티치트/공유 게임 DLL은 수정하지
않았다.

### 5.3 GPU profile

RT/DLSS 메뉴 gate를 위해 D3DMetal launch environment에 RTX 4060 profile을
넣었다. 2060을 쓰지 않은 이유는 실험 목적상 더 최신 Ada profile을 쓰고
기능 gate를 넓게 만족시키기 위해서다. 메뉴 노출은 성공했다.

### 5.4 MetalFX 판정 주의

DLSS 메뉴 및 plugin 초기화는 확인됐지만, 현재 분석기의 엄격한 기준에서
`metalFxConversion=false`, `metalFxVerified=false`다. 단순히
`D3DM_ENABLE_METALFX=1`, `nvngx.dll` load 또는 DLSS plugin 버전이 보인다는
이유로 실제 DLSS→MetalFX 변환 성공을 주장하지 않는다.

## 6. RT 검은 배경 조사와 배제된 원인

다음 조건에서도 검은 배경이 동일하게 재현됐다.

- DLSS 활성 상태
- DLSS를 끄고 Native/TAA 사용
- Frame Generation off
- RT Medium
- macOS 27 및 `D3DM_MTL4=1`
- 게임 재설치
- 셰이더/게임 캐시 재생성 또는 백업/삭제 실험
- RT off로 저장 후 다시 활성화

따라서 DLSS가 1차 원인이라는 설명, 오래된 캐시만의 문제, 게임 설치 손상,
macOS 26/Metal 3 경로만의 문제는 배제됐다. 재설치 후에도 현상이 같았고,
불필요해진 캐시/게임 백업은 당시 사용자 요청에 따라 삭제했다.

RT를 켰을 때 초기에 초록색 렌더링/글자 손상이 보였고 이후에는 검은 배경이
주 증상이 됐다. 최신 권위 실행에는 crash/device loss/GPU fault가 없었고
정상 `OnApplicationQuit`가 기록됐다. 별도로 한 번 발생한 시작 crash는
다음 실행에서 재현되지 않았으며 최신 RT 실패 결론의 근거로 쓰지 않는다.

## 7. 권위 있는 최신 RT 실행

Run ID: `1785515763124`

증거 파일:

```text
~/Library/Application Support/Yaagl ZZZ DX12/logs/
  d3dmetal_1785515763124_profile.json
  d3dmetal_1785515763124_wine.log
  d3dmetal_1785515763124_system.log
  d3dmetal_1785515763124_player.log
  d3dmetal_1785515763124_modules.log
  d3dmetal_1785515763124_evidence.json
```

핵심 evidence:

| 항목                       |                                     값 |
| -------------------------- | -------------------------------------: |
| D3DMetal                   |                          exact `4.0b2` |
| selectedRenderer           |                                `d3d12` |
| backendVerified            |                                 `true` |
| DXR capability             |                            `supported` |
| `supportsRayTracing`       |                                    `1` |
| RTPSO failures             |                                 `1247` |
| HRESULT                    |                    `0x80070057` × 1247 |
| RTXGI invalid state object |                                    `1` |
| Metal compile failures     |           `14` (compute 9, fragment 5) |
| MetalIR FP64 unhandled     |                                   `15` |
| no-op PSO                  | `7`: 336, 419, 521, 526, 537, 809, 840 |
| crash/device loss          |                                   없음 |
| 종료                       |               정상 `OnApplicationQuit` |

결정적인 Player.log 순서:

```text
supportsRayTracing = 1
d3d12: could not create a Ray Tracing Pipeline State Object (0x80070057)
d3d12: Dispatching Ray Tracing Shader "RTXGI" failed. Invalid Ray Tracing State Object.
```

FP64와 no-op PSO는 실재하지만, 현재 식별한 네 State Object 거부 분기는
`CompileNewResolvedExports`보다 앞에 있다. 따라서 이들은 현재
`CreateStateObject(E_INVALIDARG)`의 1차 원인이 아니다. State Object를
고친 뒤 RTXGI export 컴파일에 연결돼 다시 나타나는지 확인할 2차 blocker다.

## 8. D3DMetal 4.0b2 역공학 결과

관련 함수/주소:

```text
0x0abec3  StateObjectBuilder::ParseStateObjectInto(...)
0x0b36c4  StateObjectBuilder::ResolveAssociations(...)
0x0b3990  StateObject::exportsHaveMatchingPipelineAndShaderConfigs()
0x1214f4  D3D12StateObject::D3D12StateObject(...)
0x1225ae  InheritPipelineConfigAndShaderConfigFromExports(int*)
0x122afc  CompileNewResolvedExports(...)
```

생성자 경로의 알려진 direct `E_INVALIDARG` store는 네 곳이다.

| 단계                   | instruction |  immediate | 원본 bytes             |         태그 |
| ---------------------- | ----------: | ---------: | ---------------------- | -----------: |
| descriptor/parser      |  `0x0ae4ab` | `0x0ae4ae` | `41 c7 01 57 00 07 80` | `0x8004d001` |
| export-config precheck |  `0x121798` | `0x12179b` | `41 c7 07 57 00 07 80` | `0x8004d002` |
| pipeline inheritance   |  `0x12275f` | `0x122761` | `c7 00 57 00 07 80`    | `0x8004d003` |
| shader inheritance     |  `0x122813` | `0x122815` | `c7 00 57 00 07 80`    | `0x8004d004` |

태그들은 모두 실패 HRESULT다. 명령 길이와 flags 동작을 바꾸지 않으며,
유효하지 않은 State Object를 성공으로 통과시키지 않는다. 다만 호출자가
특정 `E_INVALIDARG` 값을 비교할 가능성이 있으므로 완전히 무관측인 변경은
아니다. 태그 실행에서 raw `0x8004d00N` 전파와 계속된 null/invalid object를
함께 확인해야 한다.

## 9. 태그 framework와 현재 런타임 상태

SHA-256:

```text
pristine binary
f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad

raw tagged before signing
8c085ad4aad5016cabd389fb27e2bc94b82940a6101afa457984725edab4256c

tagged after deterministic ad-hoc signing
9fdcba57a4c47ed7f444ed18bbe3bc6468361a6d43fb40ea178244aec2f7366d
```

작업공간 산출물:

```text
build/d3dmetal-4.0b2-rtxgi-diagnostic/
  D3DMetal.framework.pristine
  D3DMetal.framework.tagged
```

`D3DMetal.framework.tagged`는 네 opcode/tag 검사와
`codesign --verify --deep --strict`를 통과했다.

2026-08-01 최종 재확인 상태:

```text
active:  pristine (f5b56d...)
cache:   pristine (f5b56d...)
source:  failure-tags (9fdcba...)
backup:  missing
in use:  no
```

태그 framework는 실제 실행 한 번을 위해 활성 런타임에 설치됐다가 게임과
Wine 종료 후 즉시 pristine backup으로 복원됐다. cache framework는 설치와
복원 어느 단계에서도 수정되지 않았다. 현재 active/cache SHA와 framework
deep/strict signature를 다시 검증했으며 backup/staging/lock 잔여물과 실행 중
Wine 프로세스가 없다.

## 10. 구현한 코드와 도구

주요 파일:

- `src/wine/d3dmetal.ts`
  - D3DMetal 4.0b2 launch contract
  - RTX 4060/DXR/Metal 4 환경
  - NVAPI aliases
  - pristine/tagged exact hash pair만 허용하는 무결성 예외
- `src/wine/d3dmetal.spec.ts`
  - launch environment, aliases, hash-pair fail-closed 테스트
- `src/diagnostics/d3dmetal.ts`
  - DXR capability와 pipeline health 분리
  - RTPSO/RTXGI/Metal compile/FP64/no-op PSO 분석
  - `stateObjectFailureStage`와 `stateObjectFailureTagCounts`
  - 새 실행 시작 시 stale evidence를 가리는 pending marker
  - RTPSO 실패 0건을 pipeline 성공이 아니라 `pipeline unobserved`로 표시
- `src/diagnostics/d3dmetal.spec.ts`
  - 일반 E_INVALIDARG, 단일 태그, mixed 태그, UI status 테스트
- `src/clients/mhy/nap/program-launch-game.ts`
  - 실제 product-path launch
  - run별 profile/log/module/evidence 수집
  - 태그 거부 stage 로그 출력
- `scripts/d3dmetal-rtxgi-patch.mjs`
  - exact pristine SHA/opcode 검증
  - 네 HRESULT 태그 적용/검사/복원
  - unknown/mixed binary fail-closed
  - truncated input 안전 판정과 같은 디렉터리 atomic replacement
- `scripts/d3dmetal-rtxgi-patch.test.mjs`
  - 원본 네 site와 임의 binary 거부 테스트
- `scripts/d3dmetal-rtxgi-runtime.sh`
  - `status`, `install`, `restore`
  - active/cache/source SHA 검사
  - 실행 중 framework 검사
  - 전체 framework backup/staging 전환
  - transition lock와 stale-lock 회수
  - 전체 framework deep/strict codesign 검증
  - install/restore 단계별 실패 시 transaction rollback
- `docs/d3dmetal-4.0b2-rtxgi-pro-prompt.md`
  - Pro에 전달한 전체 증거 패킷
- `docs/d3dmetal-4.0b2-rtxgi-pro-result.md`
  - Pro 분석의 actionable 결과
- `docs/d3dmetal-computer-use-identity-probe-2026-08-01.md`
  - bundle host의 exec 전 성공과 exec 후 identity 소실 재현
- `build/computer-use-app-host-probe/`
  - 제품에 포함하지 않는 x86_64 AppKit identity 증거 프로브

앱/채널 관련 변경은 `build-app.js`, `package.json`, `src/app.tsx`,
`src/config/index.tsx`, `src/wine/*`, `src/gptk/*`, `src/game-lock/*`,
`src/platform/*`, `src/clients/naposdx12.ts` 등에도 있다. 전체 dirty worktree가
이 문서의 RT 패치만을 뜻하지는 않는다.

## 11. 검증 결과

완료된 검증:

- `node --test scripts/d3dmetal-rtxgi-patch.test.mjs`: 3/3 통과
- 표적 Vitest: 3 files, 24 tests 통과
- TypeScript 검사 통과
- Prettier 및 `git diff --check` 통과
- ESLint: error 0, 기존 warning 9
- 앱 재빌드 통과
- 앱 deep/strict codesign 검증 통과
- tagged framework deep/strict codesign 검증 통과
- runtime 전환 스크립트 `/bin/sh -n` 통과
- `/private/tmp`의 full framework 복제 환경에서
  `pristine -> install tags -> verify backup/cache -> restore pristine`
  전체 흐름 통과
- 실제 private runtime에서 tagged install, product launch, evidence finalization,
  pristine restore와 active/cache signature 재검증 통과
- x86_64 AppKit identity probe에서 exec 전 Computer Use attach 성공과 exec 후
  ASN 교체/`bundleID NULL`/attach timeout 재현
- 재빌드된 실제 런처 Wine 탭에서 Computer Use로
  `DXR: enabled — capability verified; pipeline unobserved` 표시 확인

전체 Vitest 프로그래밍 API 실행에서는 10 files/136 tests 중 122개가
통과했고 14개 실패는 기존 `src/utils/command-builder.spec.ts`의
`osascript -e` 실행 문제였다. 현재 패치 파일과 무관하다.

일반 Vitest가 처음 시작하지 못한 별도 환경 문제도 있었다.
`/etc/hosts`에 기본 `127.0.0.1 localhost` 행이 없어서 `localhost` lookup이
실패했으며 Vite host를 `127.0.0.1`로 지정해 우회했다. 시스템 hosts 파일은
이 작업에서 수정하지 않았다. `src/hosts.ts`의 전체-file rewrite 경로가
원인 후보지만 RT beta2 패치 범위와 별개다.

## 12. Pro 분석 결과

ChatGPT Pro 분석 대화:

<https://chatgpt.com/c/6a6cd924-8818-83e8-bfb1-52e17b0939e1>

16분 8초 분석 결과의 핵심:

1. 네 갈래 태그 실행이 올바른 다음 진단이다.
2. DXR에서 실제로 다른 pipeline/shader config를 `max()`, OR/AND, mask로
   합쳐서는 안 된다.
3. 비교는 override/default/collection 규칙을 해석한 뒤의 **effective
   association**과 canonical tuple에 대해 정확히 해야 한다.
4. 좁게 허용 가능한 교차 표현 equivalence는 tier가 허용할 때
   `PIPELINE_CONFIG(depth)`와
   `PIPELINE_CONFIG1(depth, FLAGS_NONE)`이다.
5. 실제 패치는 태그 binary 위에 쌓지 않고 pristine SHA에서 선택된 한
   branch family만 고쳐야 한다.

태그별 최소 패치 방향:

| 태그   | 방향                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `d001` | 정확한 유효 missing subobject/predicate를 찾고 parser switch만 수정. Store 자체를 우회하지 않음.                                        |
| `d002` | `ResolveAssociations` 또는 `exportsHaveMatching...`의 좁은 leaf에서 canonical effective tuple을 비교. 생성자 failure branch 반전 금지.  |
| `d003` | legacy CONFIG flags=0 canonicalization, stale/superseded source 선택, unset slot 초기화 같은 표현/소스 오류만 수정. 원래 equality 유지. |
| `d004` | API `UINT` zero-extension 또는 winning association source 같은 producer 오류만 수정. payload/attribute의 실제 값이 다르면 거부 유지.    |

상세 hook/cave/guard/success gate는
`docs/d3dmetal-4.0b2-rtxgi-pro-result.md`를 참조한다.

## 13. 실제 태그 실행 결과와 안전 복원

Run ID: `1785521395613`

```text
~/Library/Application Support/Yaagl ZZZ DX12/logs/
  d3dmetal_1785521395613_profile.json
  d3dmetal_1785521395613_wine.log
  d3dmetal_1785521395613_system.log
  d3dmetal_1785521395613_player.log
  d3dmetal_1785521395613_modules.log
  d3dmetal_1785521395613_evidence.json
```

태그 framework를 설치한 뒤 재빌드된 `Yaagl ZZZ DX12.app`으로 실제 product
path를 실행했다. 프로필은 Steam stub, 게임 executable, `-use-d3d12`,
D3DMetal/DXR/MetalFX/RTX 4060 환경을 모두 정확히 기록했다.

| 항목                         | 값                                    |
| ---------------------------- | ------------------------------------- |
| selected renderer            | `d3d12`                               |
| D3DMetal                     | exact `4.0b2`                         |
| `supportsRayTracing`         | `1`                                   |
| 자동 로그인                  | 성공 (`retcode: 0`)                   |
| 마지막 게임 UI 로그          | `Login.SuccessTip pluginui is showed` |
| RTPSO failure                | `0`                                   |
| RTXGI invalid state object   | `0`                                   |
| `CreateStateObject` failure  | `0`                                   |
| raw `0x8004d001`~`004`       | `0`                                   |
| state-object rejection stage | `null`                                |
| 최종 판정                    | capability 확인, RT pipeline 미관측   |

약 22분 동안 프로세스는 살아 있었지만 Player.log는 로그인 성공 UI 이후 더
진행하지 않았다. 실제 게임 창은 LaunchServices에 foreground `wine`, PID
`47212`, `bundleID NULL`로 등록됐다. Computer Use 공개 API는 display name,
app path 또는 bundle ID만 받으며 이 프로세스를 `list_apps()`에서 생략했다.
따라서 게임 창에 입력을 보내 RT Medium 장면으로 진입할 지원 경로가 없었다.

게임 PID에 `TERM`을 한 번 보내 1초 안에 종료했고 `KILL`은 쓰지 않았다.
런처가 evidence를 `pending`에서 위 최종 구조로 마감한 뒤 Wine 사용 중 판정이
해제된 것을 확인하고 restore를 실행했다. 현재 상태는 다음과 같다.

```text
active:  pristine (f5b56d...)
cache:   pristine (f5b56d...)
source:  failure-tags (9fdcba...)
backup:  missing
in use:  no
```

active/cache framework 모두 `codesign --verify --deep --strict`를 통과했다.

## 14. Computer Use blocker와 재개 조건

Wine 창을 지원되는 Computer Use 대상으로 만들기 위해 Pro Architect와 함께
앱 정체성 설계를 검토했다.

Architect 대화:
<https://chatgpt.com/g/g-6a6c2c25638c819193c521156319a9e9-codex-architect/c/6a6ceb82-4a2c-83ee-bdb5-a2337e86074e>

초기 조건부 후보는 기존 런처가 직접 spawn하는 x86_64 AppKit host가 같은
PID에서 외부 Wine loader로 `execve`하는 구조였다. 이 구조는 direct-child
wait status, stdout/stderr, environment와 `wineserver -w` 순서를 보존할 수
있지만 app identity 유지 여부가 hard gate였다.

실제 로컬 프로브 결과:

```text
exec 전: pid 53569, ASN 0x13f13f,
         bundleID com.3shain.yaagl.probe.samepid,
         Computer Use list/get_app_state 성공

exec 후: pid 53569 유지, ASN 0x141141로 교체,
         bundleID NULL, Computer Use attach timeout
```

대화에 첨부된 `Same PID Host Before Exec` 화면은 exec 전 host가 실제로
Computer Use 대상이었던 시각 증거다. 외부 payload로 바뀐 뒤에는 같은 PID도
identity를 유지하지 못했다. 최종 Architect 판정은 `BLOCK`이며 이 설계는
제품 코드에 넣지 않았다. 상세 재현은
`docs/d3dmetal-computer-use-identity-probe-2026-08-01.md`에 있다.

다음 중 하나가 바뀔 때만 태그 실행 경로를 다시 연다.

- Computer Use가 PID/window-level targeting을 공식 지원한다.
- Wine이 실제 게임 window owner에 stable bundle identity를 제공한다.
- 정확한 lifecycle/log 계약을 보존하는 지원 LaunchServices 경로가 허용된다.
- 사용자가 직접 게임 UI를 조작해 RT 장면 진입을 완료한다.

재개 시 최신 run의 `*_evidence.json`에서 우선 다음을 본다.

```json
{
  "stateObjectFailureStage": "...",
  "stateObjectFailureTagCounts": {}
}
```

그리고 `*_player.log`에서 raw `0x8004d001`~`0x8004d004`가 실제로 전파됐는지
확인한다. 현재 run은 이 gate를 통과하지 못했다.

- 태그가 하나로 일관되면 해당 branch family의 runtime values와 full
  disassembly를 추가 수집한다.
- 여러 descriptor에서 서로 다른 태그가 나오면 단일 무조건 패치를 만들지
  않는다.
- 여전히 `0x80070057`만 나오면 네 store inventory 또는 HRESULT propagation이
  불완전하므로 실제 완화 패치로 넘어가지 않는다.
- 태그가 실패인데 State Object가 사용되거나 DispatchRays까지 진행하면
  태그 설계 가정이 깨진 것이므로 즉시 중단한다.

실제 호환 패치 성공 기준:

- `CreateStateObject`가 non-null object와 함께 성공
- `CompileNewResolvedExports` 성공
- RTXGI shader identifier 유효
- 실제 `SetPipelineState1`과 `DispatchRays`
- 검은 배경 제거 및 실제 RT 조명 렌더링
- `could not create a Ray Tracing Pipeline State Object`와
  `Invalid Ray Tracing State Object` 제거
- crash/device loss/GPU fault/new RTXGI no-op PSO 없음
- 실제 canonical field가 다른 negative control은 계속 원래 실패 경로로 거부

## 15. 절대 하지 않을 것

- 게임 EXE, DLL, RTXGI 파일, 안티치트 수정
- proxy DLL/OptiScaler 주입
- GPTK pristine cache 수정
- validation 전체 NOP 또는 failure branch 무조건 반전
- failing HRESULT를 `S_OK`로 변경
- 서로 다른 depth/payload/attribute에 무조건 `max()` 적용
- pipeline flags OR/AND/mask로 강제 일치
- 근거 없이 셰이더 캐시 재삭제, 게임 재설치, OS 재업그레이드, GPU profile
  matrix 반복
- pristine SHA/opcode가 다른 binary에 패치 적용
- dirty worktree의 관련 없는 사용자 변경 되돌리기
- raw tag 없이 실제 D3DMetal compatibility relaxation 선택
- unsupported PID input, Computer Use policy bypass 또는 AppleScript/System
  Events input relay
- same-PID app host, spawning wrapper, Wine tree app-bundle 재배치 반복

## 16. 알려진 부수 문제와 남은 별도 과제

- FP64/Metal compile/no-op PSO는 State Object 수정 후 RTXGI와 상관관계를 다시
  판정할 2차 blocker다.
- `D3DM_MTL4=1`이 설정됐지만 최신 evidence의
  `mtl4BackendEnabled=false`, `mtl4Evidence=[]`다. 이는 MTL4 configured와
  실제 backend positive evidence를 구분한 결과다.
- `metalFxVerified=false`는 엄격한 양성 변환 로그가 아직 없기 때문이다.
- 최신 태그 run의 `dxrPipelineFailed=false`는 성공이 아니라 RTPSO 시도 자체가
  관측되지 않았다는 뜻이다. UI는 이를 `pipeline unobserved`로 표시한다.
- `/etc/hosts`의 localhost 누락과 `src/hosts.ts` 후보는 별도 버그로 관리한다.
- APFS `Golden Gate Beta` 볼륨의 현재 존재/삭제 상태는 이 RT 작업의 성공
  조건이 아니다.

## 17. 관련 문서

- 전체 개발 경과/초기 구현 계획: `IMPLEMENTATION_PLAN.md`
- Pro 입력 증거: `docs/d3dmetal-4.0b2-rtxgi-pro-prompt.md`
- Pro 결과/패치 설계: `docs/d3dmetal-4.0b2-rtxgi-pro-result.md`
- Computer Use identity 프로브:
  `docs/d3dmetal-computer-use-identity-probe-2026-08-01.md`
- 본 인수인계: `docs/zzz-dx12-d3dmetal-rtxgi-handoff-2026-08-01.md`
