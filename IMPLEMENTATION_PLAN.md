# YAAGL ZZZ GPTK 4.0b2 DX12/MetalFX 구현 계획

기준 YAAGL 커밋: `ca78abc29c2fc236261d088c6907d28cab6e9476`

## 2026-08-02 현재 상태와 재개 계획

권위 있는 최신 실행은 `1785640852138`이며 직전 실행은 `1785640790322`다.
목표는 여전히 **실제 ZZZ 도시
장면에서 RT가 정상 렌더링되는 것을 좌표 기반 UI와 스크린샷으로 확인하는 것**이며,
흰색/평면 배경은 실패다. 최신 두 실행은 게임 크래시가 아니다. game PID
`54922`, `55487`에서 유효 ACK까지 생성됐지만 런처가 존재하지 않는
`/usr/bin/test`를 반복 호출했고, 10초 timeout 뒤 Wine tree를 종료했다.
ARM/capturing/instance/city screenshot/terminal은 생성되지 않았다. 따라서 RT
성공은 아직 0회이며 두 실행은 소비된 실패 시도다. 자동 재시도하지 않는다.

### 재개 순서: 게임 진입 복구가 최우선

ACK/lsof/ARM은 진단 수단이지 게임 실행 허가 장치가 아니다. 현재 구현은 진단
게이트 실패가 `terminateAndConfirmD3DMetalWineTree()`로 이어져 실제 목표를
차단한다. 다음 세션은 이 결합을 제거해 capture 준비·검증 실패를 evidence로
기록하면서 게임은 계속 실행되도록 만든다. `/usr/bin/test`를 `/bin/test`로
수정하는 것은 필요하지만 충분하지 않으며, 기존 fail-closed 구조를 그대로
재승인하지 않는다.

구현 및 검증 순서는 다음과 같다.

1. ACK wait/authority/ARM 실패와 Wine tree termination의 결합을 제거한다.
2. 진단 실패를 구조화된 evidence와 사용자에게 보이는 오류로 남기되 launch는
   지속한다.
3. repository의 absolute host command 경로를 전수 검사한다.
4. production `command-builder`를 통과한 `/bin/test`, `/bin/ps`,
   `/usr/sbin/lsof`, `/usr/bin/stat`, `/bin/realpath`, `/bin/sync` smoke test를
   실제 macOS에서 수행한다.
5. TypeScript/native tests, build, codesign, bundle-installed equality를 통과한다.
6. 게임은 실행하지 않고 사용자에게 다음 실행 직전 상태를 인계한다.
7. 사용자 승인 후 city run에서 screenshot과 RTPSO/MetalIR evidence를 확보한다.
8. renderer/D3DMetal patch를 설계·구현하고 반복한다.

### 보존된 ACK-first 진단 설계 (launch-blocking 적용은 폐기)

아래는 당시 Architect가 `CLEAR`로 확정한 ACK-first 증거 설계의 역사적
기록이다. exact ACK/vnode 관측 논리는 진단 내부에서 재사용할 수 있지만,
그 실패로 게임을 종료하는 launch-blocking 적용은 폐기한다. vnode
후속 계약도 Architect `VNODE-CONTRACT: CLEAR`, Critic
`ARCHITECTURE-CRITIQUE: OKAY`로 해소되어 구현은 승인됐다. 빌드·설치·런타임
실행은 별도 검토 전에는 하지 않는다. 현재 설계의 필수 불변조건은 ACK 검증
자체, 단일 ACK, PID 존재,
ACK 직후와 ARM 직전의 동일한 PID/start identity, 그리고 두 시점의 정확한
`/usr/sbin/lsof -n -P -p PID -F0pcfDintn`의 exact vnode/module 증거다.
`ps.args` 게임 후보는 보조 관측으로만 남긴다.

완료된 staged sequence:

1. `src/diagnostics/d3dmetal.ts`: ACK-first로 대기 경로를 바꾼다. 유효 ACK를
   먼저 수집하고 중복이면 `lsof` 전에 fail-closed한다. ACK PID에 직접
   `ps -p PID -o pid=,lstart=`와
   `/usr/sbin/lsof -n -P -p PID -F0pcfDintn`을 적용한다. normalized
   exact game executable vnode, `D3DMetal.framework`, `d3d12.dll`을 모두
   요구한다. configured path의 symlink component, `(deleted)`, 상대경로,
   alternate hard link는 거부한다. lsof가 보고한 symlink alias는 canonical
   expected path와 exact vnode로 해소될 때만 허용한다. 기존 `ps.args` 후보
   parser는 보조 진단으로만 유지한다.
2. `src/diagnostics/d3dmetal.spec.ts`: 후보 목록에 없는 유효 ACK가 exact
   lsof로 승인되는지, helper/steam ACK 거부, duplicate ACK의 선행 거부,
   PID 소멸·start identity 변경·PID 재사용·ARM 직전 vnode/module 소실,
   NUL field framing, hex device/decimal inode bigint, configured symlink 거부,
   accepted symlink alias, hard-link alias 거부, 반복 mapping collapse,
   path/vnode 충돌과 삭제 표기를 각각 검증한다.
3. `src/clients/mhy/nap/program-launch-game.ts`: 사전 `ps` 후보 대기를
   제거하고 ACK 대기를 즉시 시작한다. ACK 직후와 ARM 직전에 PID/start
   identity 및 lsof를 재검증하고, 모든 조건이 byte-level ACK/nonce/run
   binding과 함께 통과할 때만 ARM한다. 이때 추가된 “하나라도 실패하면 게임을
   종료한다”는 결합은 최신 실제 실행으로 부적합 판정됐으며 제거 대상이다.

### 2026-08-02 폐기된 실행 직전 체크포인트

아래 상태는 두 실제 실행 전의 기록이며 **현재 실행 승인이 아니다.**
ACK-first/five-vnode 구현, 런처 통합, 전체 테스트, native fixtures, 앱 빌드,
transactional resources/sidecar 설치, 해시·codesign 검증, Architect/Critic
implementation review와 최종 `RUN-OKAY-ONE`을 모두 완료했다.

- 최종 manifest SHA:
  `fae670f732eb6da6c14a38b06f6d582c72b9ce4ff5113839bb926e52a282a1a1`
- resources bundle=installed:
  `130eeef953bc3cf69c77b620feebf9a3bdbe5fdce2c8cf8007864be7e9d34188`
- full Vitest `11/182`, TypeScript, native, late-load, build, codesign PASS
- 당시 게임 실행은 0회였지만 이후 `1785640790322`, `1785640852138` 두 번이
  실행됐으므로 permit은 폐기됐다.

이 체크포인트를 근거로 앱을 재실행하지 않는다. 현재 재개 순서는 문서 최상단의
“게임 진입 복구가 최우선” 절만 따른다.

### 역사적 계획 및 상태 기록

아래 내용은 이전 구현 단계와 과거 실행의 역사적 기록이다. 현재 재개 판단이나
실행 승인은 문서 최상단의 게임 진입 복구 계획과 최신 handoff를 우선한다.

## 현재 상태 요약 (2026-07-31, historical)

이 절은 컨텍스트가 압축된 뒤에도 이 문서만으로 작업을 이어갈 수 있도록 유지한다.

- 브랜치 `work/zzz-gptk-dx12`, 워크트리 `/Users/hanbinnoh/Documents/yaagl-dx12`. 커밋·푸시는 하지 않는다.
- DX12 backend는 **완료**다. 현재 기준 수동 실행 `1785495734965`에서 `backendVerified=true`다. DX12 채널의 정확한 게임 인자는 `ZenlessZoneZero.exe -use-d3d12`이며 해상도·전체화면 인자를 추가하지 않는다.
- NVAPI/Streamline 차단은 **해결**됐다. 원인은 GPU identity가 아니라 Wine 11 builtin module pairing이었다. 아래 “NVAPI unixlib pairing 원인 규명과 해결”이 확정 결과다.
- 해상도와 전체화면은 **게임 설정 전용**이다. DX12 채널은 런처의 해상도 UI를 숨기고 외부 디스플레이를 탐지·마이그레이션하지 않는다. 최신 prefix에는 게임이 저장한 fullscreen mode `1`, width `3840`, height `2160`이 있고 최신 `Player.log`에도 3840×2160 상태가 나타난다.
- 최신 수동 실행에서 FFX upscaler/frame generation과 Streamline DLSS/DLSSG 런타임은 정상 로드됐지만, 사용자가 확인한 게임 그래픽 메뉴에는 **DLSS와 FSR 옵션이 모두 나타나지 않았다**. 따라서 현재 병목은 DLL/plugin load가 아니라 게임 측 capability/UI gate다.
- MetalFX는 **미판정**이다. `metalFxFailure=false`, `metalFxConversion=false`, `metalFxVerified=false`다. DLSS 메뉴가 노출되지 않아 게임이 DLSS를 요청하도록 설정할 수 없는 상태다.
- 남은 순서는 읽기 전용 정적 분석으로 DLSS/FSR 공통 UI gate를 식별 → 안전한 런타임 관측으로 gate를 검증 → 옵션이 정상 노출될 때만 게임 UI에서 DLSS/FSR 비교와 MetalFX 판정을 진행하는 것이다.
- 이 역사적 시점에는 격리 런처와 `aria2c` sidecar가 실행 중이었다. 2026-08-02
  최신 확인에서는 Yaagl/Wine/game 프로세스가 모두 없다.
- 폐기된 경로: `VideoPciVendorID`/`VideoPciDeviceID` GPU spoofing, `-force-d3d12` selector, OptiScaler/proxy DLL/hook, DXMT 주입, MoltenVK 강제 구성.

### 고정 좌표

| 항목         | 값                                                               |
| ------------ | ---------------------------------------------------------------- |
| 격리 앱      | `/Users/hanbinnoh/Documents/yaagl-dx12/Yaagl ZZZ DX12.app`       |
| Bundle ID    | `com.3shain.yaagl.nap.os.dx12`                                   |
| Support 경로 | `~/Library/Application Support/Yaagl ZZZ DX12`                   |
| 공유 게임    | `/Applications/ZenlessZoneZero`                                  |
| Wine tag     | `11.0-1-crossover-signed-experimental` (`wine-11.0`)             |
| GPTK         | 4.0b2, `~/Library/Application Support/Yaagl ZZZ DX12/gptk/4.0b2` |
| 채널         | `naposdx12`                                                      |
| 검증 환경    | M5 Pro, 64 GB, macOS 26.6, 외부 S32B80P 3840×2160 @ 60Hz         |

### 건드리지 않는 것

- 기존 `/Applications/Yaagl ZZZ OS.app`과 `~/Library/Application Support/Yaagl ZZZ OS`.
- 공유 게임 폴더의 `ZenlessZoneZero.exe`, `vulkan-1.dll`, `sl.*.dll`, `nvngx*.dll`, `amd_fidelityfx*.dll`.
- 외부에서 마운트된 `/dev/disk7`, `/dev/disk8`. 이 작업이 만든 mount만 detach한다.
- 게임/안티치트 프로세스 attach·injection·debugger.

## 목표

- 글로벌 ZZZ만 지원하는 독립 앱 `/Users/hanbinnoh/Documents/yaagl-dx12/Yaagl ZZZ DX12.app`을 만든다.
- 번들 ID는 `com.3shain.yaagl.nap.os.dx12`, 데이터 경로는 `~/Library/Application Support/Yaagl ZZZ DX12`로 격리한다.
- 기존 `/Applications/Yaagl ZZZ OS.app`과 `~/Library/Application Support/Yaagl ZZZ OS`는 수정하거나 복제하지 않는다.
- `/Applications/ZenlessZoneZero` 게임 데이터만 공유하고, 별도의 깨끗한 Wine prefix를 만든다.
- backend 완료 조건은 실제 플레이 진입과 GPTK 4.0b2 D3DMetal을 통한 DX12 사용이다. MetalFX/DLSS 변환과 전체 v1 완료는 별도 게이트로 두며, 명시적인 양성 런타임 증거가 생길 때까지 검증 완료로 표시하지 않는다.

## GPTK 및 Wine 구성

- Apple GPTK 런타임은 소스와 앱 번들에 포함하지 않는다.
- 첫 실행 시 `~/Downloads/Game_Porting_Toolkit_4.0_beta_2.dmg`를 자동 탐색하고, 실패하면 사용자가 `.dmg`를 선택하게 한다.
- 외부 GPTK DMG와 내부 `Evaluation environment for Windows games 4.0 beta 2.dmg`를 모두 지원한다.
- DMG는 `hdiutil`로 읽기 전용 마운트하며 모든 종료 경로에서 해제한다.
- 현재 외부에서 마운트된 `disk7`/`disk8`은 이 작업이 소유한 mount가 아니므로 detach하지 않는다. 자동 cleanup은 해당 실행이 직접 만든 mount만 대상으로 한다.
- `redist/lib`, D3DMetal/D3D12/NVAPI/NGX 파일, 코드 서명, `D3DMetal.framework` 버전 `4.0b2`를 검증한다.
- 검증한 런타임은 새 Application Support의 `gptk/4.0b2`에 라이선스와 SHA-256 manifest를 포함해 캐시하고 원본 DMG 경로는 저장하지 않는다.
- Wine은 `11.0-1-crossover-signed-experimental`만 사용한다.
- 기존 prefix를 복제하지 않고 `wineboot -u` 후 Windows 10인 독립 prefix를 만든다.
- Wine 추출본에 GPTK의 `external` 및 D3D 파일을 overlay하고, staging 검증을 통과한 뒤 최종 Wine 경로로 전환한다.
- MetalFX 준비의 권위 있는 계약은 로컬 Apple GPTK 4.0 beta 2 공식 README(`/Volumes/Evaluation environment for Windows games 4.0 beta 2/Read Me.rtf`)로 한정한다. 문서대로 `nvngx-on-metalfx.so/.dll`을 `nvngx.so/.dll`로 이름을 바꾸고 `nvngx.dll`, `nvapi64.dll`을 prefix `windows/system32`에 복사하며, macOS 26에서 `D3DM_ENABLE_METALFX=1`을 사용한다.
- Apple 문서가 요구하지 않는 NVIDIA Global GUID, `nvlddmkm` GUID, NGXCore `FullPath` 레지스트리 값은 ZZZ D3DMetal 설치·실행·검증 계약에 포함하지 않는다. 공유 `setNVExtension`의 기존 비-D3DMetal 채널 동작은 범위 밖이므로 그대로 보존한다.
- Steam 32/64 stub 및 `lsteamclient.dll`만 멱등적으로 설정한다.
- GPTK 4.0b2의 `nvapi64.dll`은 PE export name이 `nvapi.dll`이므로 Wine 11의 builtin pairing 규칙을 만족하지 못한다. 따라서 Wine staging 트리에 상대 symlink 두 개를 함께 만든다: `lib/wine/x86_64-windows/nvapi.dll -> nvapi64.dll`, `lib/wine/x86_64-unix/nvapi.so -> nvapi64.so`. 원본 바이너리는 수정하지 않으며 해시 검증도 유지한다.
- DXMT 주입, MoltenVK 강제 구성, 과거 `WINEDLLPATH_PREPEND`, 기존 prefix 복제는 사용하지 않는다. Wine/GPTK의 probe 또는 helper 경로에서 관찰되는 부수적인 DLL 로드는 활성 renderer 선택과 구분한다.

## ZZZ 실행 계약

- `naposdx12` 채널은 글로벌 ZZZ 외 게임이나 서버를 노출하지 않는다.
- 결과 앱이 공식 YAAGL DXMT 업데이트로 바뀌지 않도록 launcher self-update는 비활성화하고, 게임 설치 및 업데이트 기능은 유지한다.
- Steam과 timeout 설정은 토글이 아닌 불변 조건으로 둔다.
- 게임은 항상 `C:\windows\system32\steam.exe <ZenlessZoneZero.exe> -use-d3d12` 형태로 실행한다. `-use-d3d12`는 실행 `1785456322875`의 권위 있는 Unity renderer 증거로 확정됐으며 `-force-d3d12`로 되돌리지 않는다.
- 고정 환경은 `WINE_ENABLE_TIMEOUT_FIX=1`, `WINEMSYNC=1`, `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal`, `D3DM_ENABLE_METALFX=1`, `D3DM_SUPPORT_DXR=0`이다. macOS 26에서 `D3DM_MTL4`는 강제하지 않는다. `CX_ACTIVE_GRAPHICS_BACKEND`는 NVIDIA GPU 위장이 아니라 CrossOver Wine에 활성 backend를 알려 WDDM 2.7 hardware scheduling capability를 노출하는 1단계 A/B 변수다.
- 공유 게임 폴더의 `vulkan-1.dll`, DLSS/FSR/Streamline DLL, 실행 파일을 이동하거나 교체하지 않는다.
- 기존 YAAGL 또는 `ZenlessZoneZero.exe`가 실행 중이면 설치·업데이트·실행을 차단한다. 정규화한 게임 경로별 PID lock을 사용하고 실제 프로세스가 없는 stale lock만 회수한다.
- 실행별 Wine 출력, D3DMetal unified log, 해당 실행의 Unity `Player.log`, Wine/GPTK 버전, launch profile과 가능하면 실행 중 live module snapshot을 동일한 run ID로 저장한다.

## 2026-07-31 실행 증거와 확정된 renderer 판정 기준

- 기준 실행 `1785439931612`에서 `-force-d3d12`는 최종 argv까지 전달됐지만 Unity `Player.log`가 Direct3D 11을 선택했다. 이 selector는 폐기한 상태를 유지한다.
- 실행 `1785456322875`는 정확한 argv `C:\windows\system32\steam.exe Z:\Applications\ZenlessZoneZero\ZenlessZoneZero.exe -use-d3d12`와 고정 환경 `WINE_ENABLE_TIMEOUT_FIX=1`, `WINEMSYNC=1`, `D3DM_ENABLE_METALFX=1`, `D3DM_SUPPORT_DXR=0`으로 타이틀/로그인 화면까지 도달했다.
- 같은 실행의 Unity `Player.log`는 `Forcing GfxDevice: Direct3D 12`, `d3d12: loaded!`, `Direct3D 12 [level 12.1]`을 기록했다. live `lsof`는 GPTK `D3DMetal.framework`, GPTK `d3d12.dll`, `nvngx.dll`, `dxgi.dll` 로드를 확인했다.
- 같은 module snapshot에는 `d3d11.dll`과 MoltenVK도 부수적으로 나타났다. 따라서 “D3D11/MoltenVK 모듈이 한 번이라도 로드되면 활성 DX12가 아니다”라는 기존 전제는 폐기한다. Unity `Player.log`의 renderer 초기화 결과를 활성 renderer의 권위 있는 출처로 삼고, module load는 backend 구성과 probe/helper 활동을 보여 주는 보조 진단으로만 사용한다.
- 재확인 실행 `1785457881424`도 같은 정확한 argv와 고정 환경을 사용했고 로그인 UI까지 도달했다. fresh `Player.log`는 `Forcing GfxDevice: Direct3D 12`, `d3d12: loaded!`, `Direct3D 12 [level 12.1]`을 기록했으며, live `lsof`는 GPTK `D3DMetal.framework/Versions/A/D3DMetal`, GPTK `d3d12.dll`, `nvngx.dll`, `dxgi.dll`을 확인했다. 부수적인 `libMoltenVK`/`d3d11` 로드는 observation으로만 남긴다.
- 실행 `1785457881424`의 evidence JSON은 exact version true, `selectedRenderer=d3d12`, `launchProfileVerified=true`, `d3dMetal=true`, `d3d12=true`, `d3d12Module=true`, `nvngx=true`, `dxmt=false`, `backendVerified=true`, `metalFxVerified=false`, `verified=false`를 기록했다. 보호된 공유 게임 해시와 `/etc/hosts`는 불변이고 vulkan backup은 없으며 lock은 해제됐다.
- alias 수정 전 실행들의 `NvApi is not supported: 0xfffffffe`, `[streamline] error: not supported on your device.`, `DLSS is not requested or failed to load.`는 당시 실패 증거이며 현재 상태가 아니다. 원인은 GPU identity가 아니라 Wine 11의 builtin module pairing 규칙이었다. 아래 “NVAPI unixlib pairing 원인 규명과 해결”을 참조한다.
- 실행 `1785461305869`부터 위 오류 문자열이 모두 사라졌고 Streamline이 DLSS/DLSSG plugin을 정상 초기화했다. 현재 기준 실행 `1785495734965`도 같은 결과를 유지한다. 다만 native FFX upscaler `3.1.5`, frame generation `3.1.6`, GPTK 파일/해시, `nvngx.dll` load, `D3DM_ENABLE_METALFX=1`, DLSS plugin 초기화는 준비·가용성 증거일 뿐 DLSS→MetalFX 변환의 양성 증거는 아니다.
- 기존 격리 앱/support 경로, GPTK import/cache/manifest, signed Wine의 transactional install, D3DMetal overlay, Apple 문서에 따른 NVNGX 파일 배치, Steam/timeout, lock·integrity, per-run diagnostics, analyzer/evidence 분리와 `-use-d3d12` 변경은 유효한 완료 작업으로 보존한다. selector 탐색 매트릭스로 돌아가지 않는다.

### NVAPI unixlib pairing 원인 규명과 해결

2단계 정적 분석과 독립 probe로 실패 지점을 함수 단위까지 확정했다. 게임/안티치트에 attach하거나 게임 파일을 수정하지 않고, 별도로 컴파일한 임시 Windows probe만 같은 Wine/prefix/환경에서 실행했다.

- `Player.log`의 `NvApi is not supported: 0x%x`는 Streamline이 아니라 `UnityPlayer.dll`이 출력한다. 문자열 file offset은 `0x1b10918`이고 xref는 `0x180542c39`의 초기화 호출 결과를 그대로 인쇄한다. `0xfffffffe`는 Apple PE `nvapi64.dll`의 DWARF enum으로 확인한 `NVAPI_LIBRARY_NOT_FOUND(-2)`이며, Unity는 `nvapi64.dll` 로드 실패 시 `0x180015633`에서 이 값을 직접 합성한다.
- 독립 probe 결과 `LoadLibraryW("nvapi64.dll")`은 Win32 오류 `1114 (DLL initialization failed)`로 실패했다. Apple PE의 `DllMain`은 `0x180001065`에서 `__wine_init_unix_call`을 호출하고, 그 내부는 `NtQueryVirtualMemory(class=1000)`으로 Unix-side handle을 얻는다. 이 호출이 `STATUS_DLL_NOT_FOUND(0xc0000135)`를 반환하는 것을 probe로 직접 관측했다.
- Wine 로그의 `find_builtin_dll looking for "nvapi.dll" for file L"...\\nvapi64.dll"`이 원인을 지목한다. Wine 11은 builtin PE와 Unix library를 파일명이 아니라 PE export directory의 `Name`으로 짝짓는다. GPTK 4.0b2의 `nvapi64.dll`은 export name이 `nvapi.dll`이므로 제공된 `nvapi64.so`와 자동으로 연결되지 않는다. CrossOver 26.3.0 공개 소스에도 이 불일치를 보정하는 alias/rename patch는 없다.
- 해결책은 GPTK 원본 바이너리를 변조하지 않고 Wine 런타임 트리에 pairing alias 두 개를 함께 두는 것이다: `lib/wine/x86_64-windows/nvapi.dll -> nvapi64.dll`, `lib/wine/x86_64-unix/nvapi.so -> nvapi64.so`. Unix alias만 추가하면 효과가 없다. PE alias가 먼저 발견돼야 Wine이 `.dll`을 `.so`로 치환해 Unix library 경로를 등록한다.
- 임시 Wine 복제본 A/B에서 baseline은 `NtQueryVirtualMemory(class=1000)`이 `0xc0000135`였고, 두 alias를 함께 둔 뒤에는 `status=0`, `NvAPI_Initialize=0`, `NvAPI_Unload=0`이 됐다. 같은 조건에서 D3DMetal DXGI adapter의 `VendorId`가 `0x1002`에서 `0x10de`로 바뀌었다. 즉 GPU identity는 위장 대상이 아니라 NVAPI 초기화 성공의 결과다. `DeviceId=0x66af`와 `AMD Compatibility Mode` 문자열은 그대로다.
- 따라서 3단계 `VideoPciVendorID`/`VideoPciDeviceID` 실험은 효과 근거 없음으로 폐기한다. GPU 이름/PCI ID spoofing은 구현·검증 계약에 넣지 않는다.

구현은 `src/wine/d3dmetal.ts`의 `D3DMETAL_NVAPI_RUNTIME_ALIASES`로 고정했다. `overlayD3DMetalRuntime`이 staging 트리에 상대 symlink를 만들고, `validateD3DMetalWine`이 실행 전마다 alias의 정확한 target을 검사한다. 원본 GPTK 파일 해시 검증은 그대로 유지된다.

#### Wine 11 pairing 규칙의 근거 위치

CrossOver 26.3.0 공개 소스(`crossover-sources-26.3.0.tar.gz`, SHA-256 `ac99c8ca4b3848f3e81784135f023df266b61c2345726ea55a50b3e030dd6872`) 기준 경로다. 임시 추출본은 삭제됐으므로 재확인이 필요하면 다시 내려받는다.

| 단계                   | 위치                                                                                 | 동작                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| export name 추출       | `server/mapping.c:741`, `:954`, `:987`                                               | builtin/fake PE일 때만 `IMAGE_EXPORT_DIRECTORY.Name`을 읽는다                                    |
| 전달                   | `server/mapping.c:1579` → `dlls/ntdll/unix/virtual.c:3270`, `:3307`                  | `ANSI_STRING exp_name`으로 복원                                                                  |
| 분기                   | `dlls/ntdll/unix/virtual.c:3513`, `:3530` → `dlls/ntdll/unix/loader.c:1644`, `:1675` | `find_builtin_dll(nt_name, exp_name, …)`                                                         |
| 이름 결정              | `dlls/ntdll/unix/loader.c:1521`, `:1538`, `:1551`, `:1562`, `:1570`                  | `exp_name`이 있으면 요청 basename을 **무시**한다. `looking for "nvapi.dll"` 로그가 여기서 나온다 |
| 후보 탐색              | `loader.c:1595`, `:1208`, `:1220`                                                    | `x86_64-windows/nvapi.dll` → `x86_64-unix/nvapi.dll.so` 순                                       |
| 실패 경고              | `loader.c:1626`                                                                      | `cannot find builtin library`                                                                    |
| 성공 시 Unix 경로 등록 | `loader.c:1628`                                                                      | PE alias를 찾으면 `.dll`을 `.so`로 치환                                                          |
| 실제 dlopen            | `dlls/ntdll/unix/virtual.c:868`, `:849`, `:857`                                      | Unix call 시점에 `__wine_unix_call_funcs`를 찾는다                                               |

왜 `nvapi.so` 하나만으로는 안 되는가:

| 배치                                     | 결과                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `nvapi64.dll` + `nvapi64.so` (GPTK 원본) | 실패. 로더는 `nvapi.dll`을 찾는다                                                             |
| `nvapi.so`만 추가                        | 실패. PE alias가 없어 독립 SO 후보 `nvapi.dll.so`를 찾는다                                    |
| `nvapi.dll.so`만 추가                    | 실패. 독립 builtin SO는 `__wine_spec_nt_header`를 요구하고 GPTK `libd3dshared.dylib`에는 없다 |
| **`nvapi.dll` + `nvapi.so` 둘 다**       | **성공.** 실측 확인                                                                           |

CrossOver의 관련 변경은 세 개뿐이며 어느 것도 이 불일치를 보정하지 않는다: prefix에 `nvapi64.dll` fake DLL을 만드는 `CW HACK 22435`(`loader/wine.inf.in:735`, `:741`), D3DMetal PE의 Unix call을 허용하는 `__wine_unix_call` export(`dlls/ntdll/loader.c:4015`, `dlls/ntdll/ntdll.spec:1772`), 검색 디렉터리만 앞에 넣는 `prepend_dll_path()`(`dlls/ntdll/unix/loader.c:365`).

#### Apple GPTK NVAPI shim 구조

| 항목       | 값                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PE         | `gptk/4.0b2/lib/wine/x86_64-windows/nvapi64.dll`, SHA-256 `05eedf19e75c6b4c0dce918577aa6ca3fe5da79d04e42145cf66f498fad3556a`               |
| Unix       | `x86_64-unix/nvapi64.so` → `../../external/libd3dshared.dylib`, SHA-256 `1582e7ceef7f495df4bebf7f06a49aef130233f8a2e9a8971e35affafeb76ec0` |
| PE export  | `nvapi_Direct_GetMethod`(RVA `0x10d0`), `nvapi_QueryInterface`(RVA `0x1120`) 단 두 개                                                      |
| 소스 경로  | `/Library/Caches/com.apple.xbs/Sources/D3DMetalDLLsBase/D3D4Mac/nvapi/nvapi.c`                                                             |
| 메서드 표  | `nvapi_pe_table` @ `0x180006000`, 24바이트 × 110개 = `0xa50`                                                                               |
| Initialize | `NvAPI_Initialize_wrap` @ `0x180001260` → Unix dispatcher op `0x2b`                                                                        |

Streamline이 실제로 요구하는 NVAPI ID와 GPTK 표의 대조 결과다. 표준 함수는 모두 존재하므로 "GPTK에 함수가 없어서 실패"가 아니었다.

| ID           | 함수                                  | GPTK 표            |
| ------------ | ------------------------------------- | ------------------ |
| `0xad298d3f` | private/optional probe                | 없음 (없어도 진행) |
| `0x0150e828` | `NvAPI_Initialize`                    | 있음               |
| `0x33c7358c` | `NvAPI_CallStart`                     | 있음               |
| `0x593e8644` | `NvAPI_CallReturn`                    | 있음               |
| `0xd22bdd7e` | `NvAPI_Unload`                        | 있음               |
| `0xe5ac921f` | `NvAPI_EnumPhysicalGPUs`              | 있음               |
| `0x2926aaad` | `NvAPI_SYS_GetDriverAndBranchVersion` | 있음               |
| `0xadd604d1` | `NvAPI_GetLogicalGPUFromPhysicalGPU`  | 있음               |
| `0x842b066e` | `NvAPI_GPU_GetLogicalGpuInfo`         | 있음               |
| `0xd8265d24` | `NvAPI_GPU_GetArchInfo`               | 있음               |

ZZZ Streamline은 `sl.common.dll`(SHA-256 `9d39bf058d0dc64677fd4fab28c02b0564e16764bfdbe775d8dc5b759489cbb2`) 기준 `v2.11.1-rc0`이다. `0x180046196` 부근의 vendor 검사는 NVIDIA(`0x10de`)·Intel(`0x8086`)·AMD(`0x1002`) **허용 목록**이며 NVIDIA 전용 gate가 아니다. 특정 DeviceId 거부 비교도 없다. 이것이 GPU spoofing을 폐기한 직접 근거다.

#### 재확인 방법

원인 재현이 필요하면 임시 Windows probe를 다시 만든다. 게임을 실행하지 않고 같은 Wine·prefix·환경만 사용한다. 툴체인은 `/opt/homebrew/bin/x86_64-w64-mingw32-gcc`(mingw-w64 14.0.0)를 썼고 `-municode`는 붙이지 않는다(`main` 사용).

probe가 확인해야 할 것은 세 가지다.

1. `LoadLibraryW("nvapi64.dll")`의 성공 여부와 실패 시 `GetLastError`.
2. `LoadLibraryExW(..., DONT_RESOLVE_DLL_REFERENCES)`로 매핑한 뒤 `NtQueryVirtualMemory(handle=-1, base, class=1000, &out, 8, &len)`의 NTSTATUS. 이것이 pairing 성공 여부를 직접 보여 준다.
3. `nvapi_QueryInterface`로 위 표의 ID를 조회하고 `NvAPI_Initialize()` 반환값.

DXGI 쪽 확인은 `CreateDXGIFactory1` → `EnumAdapters1` → `GetDesc1`로 `VendorId`/`DeviceId`/`Description`을 읽고 `D3D12CreateDevice` 후 다시 NVAPI를 로드하는 순서로 한다. Wine 실행 시 환경은 launch profile과 동일하게 맞추고 `D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST`의 변수를 `/usr/bin/env -u`로 제거한다.

판정 기준:

```text
실패(수정 전): NtQueryVirtualMemory(class=1000) status=0xc0000135, LoadLibrary 오류 1114
성공(수정 후): status=0x00000000, NvAPI_Initialize=0, NvAPI_Unload=0, adapter vendor=0x10de
```

### 실행 `1785461305869` 결과

- 고정 argv와 환경(`WINE_ENABLE_TIMEOUT_FIX=1`, `WINEMSYNC=1`, `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal`, `D3DM_ENABLE_METALFX=1`, `D3DM_SUPPORT_DXR=0`)을 유지한 채 alias만 추가했다.
- fresh `Player.log`는 `Forcing GfxDevice: Direct3D 12`, `d3d12: loaded!`, `Direct3D 12 [level 12.1]`을 기록했고 로그인 화면까지 도달했다.
- `NvApi is not supported`, `[streamline] error: not supported on your device.`, `DLSS is not requested or failed to load.`, `DLSSG is not requested or failed to load.`가 모두 사라졌다. 대신 `[streamline] DLSS version: 310.6.0`, `[streamline] DLSSG version: 310.6.0`이 나타났다.
- evidence JSON: `selectedRenderer=d3d12`, `launchProfileVerified=true`, `backendVerified=true`, `metalFxFailure=false`(이전 실행들은 모두 true), `metalFxConversion=false`, `metalFxVerified=false`, `verified=false`.
- 판정: Streamline 초기화 gate는 해결됐고 DLSS plugin은 로드된다. 다만 최신 수동 실행에서는 로그인 후 그래픽 메뉴에도 DLSS와 FSR이 모두 없었다. 따라서 이제 `metalFxVerified`의 선행 조건은 단순 로그인이 아니라 게임 측 공통 capability/UI gate 규명과 정상적인 옵션 노출이다.
- 보호 파일 해시 불변: `ZenlessZoneZero.exe` `92b88fea…`, `Plugins/x86_64/vulkan-1.dll` `8df991e6…`, `sl.common.dll` `9d39bf05…`, `sl.dlss.dll` `7779f3c6…`, `sl.dlss_g.dll` `dae3f24a…`. `.bak` 파일 없음.

#### 실행별 비교

| run ID          | 변수                              | selectedRenderer | NVAPI    | Streamline             | metalFxFailure | backendVerified |
| --------------- | --------------------------------- | ---------------- | -------- | ---------------------- | -------------- | --------------- |
| `1785439931612` | `-force-d3d12`                    | **d3d11**        | 실패     | 거부                   | true           | false           |
| `1785456322875` | `-use-d3d12`                      | d3d12            | 실패     | 거부                   | true           | true            |
| `1785457881424` | 동일 재확인                       | d3d12            | 실패     | 거부                   | true           | true            |
| `1785460061723` | `CX_ACTIVE_GRAPHICS_BACKEND` 추가 | d3d12            | 실패     | 거부                   | true           | true            |
| `1785461305869` | **NVAPI alias 추가**              | d3d12            | **성공** | **DLSS/DLSSG 310.6.0** | **false**      | true            |
| `1785462853546` | 과거 `-screen-*` 실험(폐기)       | d3d12            | **성공** | **DLSS/DLSSG 310.6.0** | **false**      | true            |
| `1785495345134` | 과거 외부 4K 인자 실험(폐기)      | d3d12            | **성공** | **DLSS/DLSSG 310.6.0** | **false**      | true            |
| `1785495734965` | **`-use-d3d12`만, 인게임 4K 설정** | d3d12            | **성공** | **DLSS/DLSSG 310.6.0** | **false**      | true            |

### 실행 `1785462853546` 내장 디스플레이 기준 결과

- 이 실행은 `-screen-*` 인자 효과를 확인한 과거 실험이며 현재 실행 계약이 아니다. 당시 profile은 `C:\windows\system32\steam.exe Z:\Applications\ZenlessZoneZero\ZenlessZoneZero.exe -use-d3d12 -screen-width 3456 -screen-height 2234 -screen-fullscreen 1`과 고정 환경 다섯 개를 기록했다.
- fresh `Player.log`는 `Forcing GfxDevice: Direct3D 12`, `d3d12: loaded!`, `Direct3D 12 [level 12.1]`, `[streamline] DLSS version: 310.6.0`, `[streamline] DLSSG version: 310.6.0`을 기록한다.
- evidence JSON은 `selectedRenderer=d3d12`, `launchProfileVerified=true`, `d3dMetal=true`, `d3d12=true`, `d3d12Module=true`, `nvngx=true`, `dxmt=false`, `metalFxFailure=false`, `backendVerified=true`를 기록한다.
- 로그인 전이라 `metalFxConversion=false`, `metalFxVerified=false`, 전체 `verified=false`다. 이는 backend 실패가 아니라 실제 DLSS 요청이 아직 없다는 뜻이다.

#### Player.log 변화

수정 전:

```text
[streamline] init flags=0x9 …
NvApi is not supported: 0xfffffffe
[ffx] Upscaler Version: 3.1.5
[ffx] FrameGen Version: 3.1.6
[streamline] error: not supported on your device.
[streamline] error: Result::eErrorFeatureFailedToLoad
[streamline] error: DLSS is not requested or failed to load.
[streamline] error: DLSSG is not requested or failed to load.
Renderer: AMD Compatibility Mode (ID=0x66af)
```

수정 후:

```text
[streamline] init flags=0x9 …
[ffx] Upscaler Version: 3.1.5
[ffx] FrameGen Version: 3.1.6
[streamline] DLSS version: 310.6.0
[streamline] DLSSG version: 310.6.0
Renderer: AMD Compatibility Mode (ID=0x66af)
```

`Renderer` 문자열은 D3DMetal이 만드는 값이므로 바뀌지 않는다. probe로 읽은 DXGI `VendorId`는 `0x10de`다. Unity가 `Vendor:` 필드를 비워 두므로 `Player.log`만으로는 vendor를 판정할 수 없다.

#### 증거 파일 위치

`~/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_<runId>_{profile.json,wine.log,system.log,player.log,modules.log,evidence.json}`. `1785462853546`은 내장 디스플레이 기준의 이전 실행이다. live `Player.log` 원본은 `wineprefix/drive_c/users/crossover/AppData/LocalLow/miHoYo/ZenlessZoneZero/Player.log`다.

### 실행 `1785495734965` 인게임 4K 및 업스케일러 메뉴 기준 결과

- 이것이 현재 권위 있는 수동 실행이다. profile arguments는 정확히 `Z:\Applications\ZenlessZoneZero\ZenlessZoneZero.exe`, `-use-d3d12` 두 개이며 `-screen-width`, `-screen-height`, `-screen-fullscreen`은 없다.
- fresh `Player.log`는 `Forcing GfxDevice: Direct3D 12`, `d3d12: loaded!`, `Direct3D 12 [level 12.1]`, FFX upscaler `3.1.5`, FFX frame generation `3.1.6`, Streamline DLSS/DLSSG `310.6.0`을 기록했다.
- module snapshot은 GPTK D3DMetal framework와 GPTK `d3d12.dll`/`dxgi.dll`, `nvapi64.dll`/`nvngx.dll`, Streamline DLSS/DLSSG DLL, AMD FidelityFX loader/upscaler/frame-generation DLL이 모두 로드됐음을 확인했다.
- evidence JSON은 `selectedRenderer=d3d12`, `launchProfileVerified=true`, `backendVerified=true`, `metalFxFailure=false`, `metalFxConversion=false`, `metalFxVerified=false`, `verified=false`다.
- 사용자가 게임 그래픽 메뉴를 직접 확인했지만 DLSS와 FSR 선택지가 모두 나타나지 않았다. 이는 한쪽 vendor plugin의 load 실패보다는 두 선택지를 함께 숨기는 게임 측 capability/UI gate가 더 유력하다는 증거다.
- `Renderer: AMD Compatibility Mode (ID=0x66af)`, 빈 `Vendor:` 필드, `supportsRayTracing = 0`이 관측됐다. 이 중 어느 하나가 공통 gate의 확정 원인이라고 단정하지 않는다. 특히 ray tracing 미지원만으로 FSR 메뉴까지 사라지는 것은 설명되지 않는다.
- prefix `user.reg`에는 게임이 저장한 `Screenmanager Fullscreen mode=1`, width `3840`, height `2160`이 있다. `Player.log`에도 3840×2160 상태가 나타난다. 이 값들은 런처 인자가 아니라 게임 자체 설정의 결과다.
- 첨부된 화면은 YAAGL 런처이므로 게임 렌더링, 인게임 4K, DLSS/FSR 메뉴의 시각 증거로 사용하지 않는다.

현재 기준 증거 파일은 `~/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785495734965_{profile.json,wine.log,system.log,player.log,modules.log,evidence.json}`이다. live `Player.log` 원본은 `wineprefix/drive_c/users/crossover/AppData/LocalLow/miHoYo/ZenlessZoneZero/Player.log`지만 로그인/session 관련 내용이 있으므로 그래픽 관련 줄만 제한적으로 조회한다.

#### 남은 MetalFX 판정 절차

1. `GameAssembly.dll`, IL2CPP metadata, 그래픽 UI asset/config를 읽기 전용으로 조사해 DLSS와 FSR을 함께 숨기는 조건 후보를 찾는다.
2. 후보를 현재 로그와 대조하고, 필요하면 게임 파일을 수정하지 않는 read-only probe 또는 한 변수 런타임 관측으로 검증한다.
3. 게임 UI에 DLSS/FSR이 정상 노출되기 전에는 설정 파일 강제 변경이나 기능 활성화를 시도하지 않는다.
4. 옵션이 정상 노출되면 인게임 3840×2160 전체화면을 유지하고 DLSS만 선택한 새 실행에서 `metalFxConversion` 양성 신호를 찾는다. Frame Generation과 DXR은 off로 둔다.
5. 신호가 없으면 확인된 Apple 로그 문구가 analyzer 패턴과 다른지 먼저 검사한다. 실제 변환 문구도 없다면 MetalFX는 false로 유지한다.

현재 analyzer는 `(converting|converted) … DLSS … to MetalFX` 또는 `DLSS -> MetalFX` 패턴만 양성으로 인정한다(`src/diagnostics/d3dmetal.ts`). 실제 Apple 로그 문구가 다르면 그 문구를 확인한 뒤 analyzer 패턴을 확장한다. 확인 없이 패턴을 넓히지 않는다.

#### FSR 3.1 비교 조건

게임 내장 FSR은 런처·레지스트리·로그만으로 현재 설정을 판독할 수 없다. `[ffx] Upscaler Version`과 `amd_fidelityfx_*_dx12.dll` 로드는 가용성 증거일 뿐 활성 증거가 아니다. 따라서 UI 스크린샷을 상태 증거로 쓴다.

두 실행에서 출력 해상도와 나머지 옵션을 동일하게 두고 업스케일러만 바꾼다.

| 항목             | 기준 실행            | 비교 실행     |
| ---------------- | -------------------- | ------------- |
| 해상도           | 3840×2160 Fullscreen | 동일          |
| 업스케일러       | Native/TAA           | FSR 3 Quality |
| Frame Generation | Off                  | Off           |
| DXR              | Off                  | Off           |
| FPS 제한·VSync   | 동일                 | 동일          |

### Retina 및 해상도 기준 (2026-07-31 최종 계약)

- 출력 해상도와 전체화면은 ZZZ 인게임 그래픽 설정이 유일하게 소유한다. DX12 런처는 디스플레이를 탐지하지 않고, 저장값을 마이그레이션하지 않으며, 해상도 UI나 전체화면 UI를 노출하지 않는다.
- DX12 실행 argv는 게임 실행 파일과 `-use-d3d12`만 허용한다. `-screen-width`, `-screen-height`, `-screen-fullscreen` 등 추가 화면 인자는 profile 검증에서 거부한다.
- 과거 `1785462853546`, `1785495345134`의 `-screen-*` 실험은 DX12와 NVAPI 회귀가 없음을 확인한 역사적 기록일 뿐 현재 계약이나 비교 기준으로 사용하지 않는다.
- 최신 실행 `1785495734965`의 prefix `user.reg`에는 게임이 저장한 fullscreen mode `1`, width `3840`, height `2160`이 있다. 이 값과 `Player.log`의 3840×2160 상태를 인게임 설정 결과로만 해석한다.
- Retina 자체는 Wine/macOS 표시 경로의 기존 옵션으로 유지할 수 있지만 DX12 런처가 특정 해상도와 결합하거나 외부 모니터를 기준으로 자동 변경하지 않는다.
- 최종 업스케일러 비교 전 인게임 UI에서 3840×2160 전체화면을 다시 확인한다. 런처 화면은 게임 출력 해상도의 증거로 사용하지 않는다.

### NVIDIA 레지스트리 조사 결론

- live prefix에는 legacy NVIDIA Global GUID, `nvlddmkm` GUID, NGXCore `FullPath` 값이 없었고, disposable Wine prefix에서는 동일한 `reg` 문법이 정상 동작했다.
- 임시 source 변경으로 세 값을 launch 전에 추가·조회했을 때 여섯 작업은 모두 성공했고 게임도 다시 DX12/login에 도달했다. 그러나 `nvngx`/게임 실행 뒤 세 값은 모두 사라졌으며 동일한 NVAPI/Streamline 오류가 유지됐다.
- Apple GPTK 4.0 beta 2 공식 README는 위 NVNGX 파일 이름 변경·system32 복사·`D3DM_ENABLE_METALFX=1`을 완전한 실험적 MetalFX 설정으로 안내하며 NVIDIA registry key를 요구하지 않는다. 레지스트리 값이 없던 실행 `1785456322875`도 이미 DX12/login에 성공했다.
- 따라서 해당 레지스트리의 존재나 지속성은 Apple 계약, DX12 backend 조건, 입증된 MetalFX 해결책이 아니다. 이를 spoof하거나 강제로 복구하지 않으며 MetalFX 성공을 주장하지 않는다.

### CrossOver 26 공개 소스 조사와 순차 실험 계획

- 2026-07-31 기준 CodeWeavers 공식 소스 페이지와 `crossover-sources-26.3.0.tar.gz`를 확인했다. 공개 묶음은 Wine 11.0, DXVK, vkd3d 등 FOSS 구성요소이며 CrossOver 앱 UI와 게임별 proprietary database는 포함하지 않는다. 공식 소스 아카이브 SHA-256은 `ac99c8ca4b3848f3e81784135f023df266b61c2345726ea55a50b3e030dd6872`다.
- 공개 Wine의 `wine.inf.in`에는 D3DMetal용 `nvapi64.dll`/`nvngx.dll` fake-DLL 항목이 있고, Apple GPTK의 실제 NVAPI/NGX shim이 그 이름을 차지한다. CrossOver 공식 문서는 DLSS 토글을 “DLSS powered by MetalFX”로 설명한다.
- `VideoPciVendorID`/`VideoPciDeviceID`는 공개 Wine의 `wined3d` 설정에서만 소비된다. 현재 ZZZ DX12 경로의 adapter는 Apple D3DMetal `dxgi.dll`이 만들며 GPTK 바이너리는 `AMD Compatibility Mode`를 보고한다. 공개 소스와 GPTK 바이너리에서 이 PCI override가 D3DMetal adapter에 연결된 증거는 없다.
- 공개 CrossOver Wine은 `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal`일 때 WDDM 2.7의 `HwSchEnabled`, `HwSchSupported`, `HwSchEnabledByDefault`를 보고한다. 현재 YAAGL Wine 바이너리에도 이 코드가 있지만 기준 실행 profile에는 환경 변수가 없었다.

순서는 다음과 같이 한 변수씩 고정한다.

1. **1단계 — backend 표식 A/B — 완료(부분 실패):** `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal`만 추가한 실행 `1785460061723`은 DX12를 유지했지만 NVAPI/Streamline 오류를 해결하지 못했다. 이 변수는 고정 환경으로 유지한다.
2. **2단계 — 읽기 전용 실패 인터페이스 식별 — 완료:** 실패 지점은 DXGI vendor gate가 아니라 Wine 11의 builtin module pairing이었다. 위 “NVAPI unixlib pairing 원인 규명과 해결”이 확정된 결과다.
3. **3단계 — prefix-only GPU identity A/B — 폐기:** 중단 조건 충족. Streamline의 vendor allowlist는 NVIDIA/Intel/AMD를 모두 허용하며, alias 수정만으로 `VendorId`가 `0x10de`로 자연히 바뀌었다. spoofing은 필요하지 않다.
4. **4단계 — 게임 UI gate 규명(진행 중):** 최신 실행에서 DLSS와 FSR이 모두 숨겨졌으므로 `GameAssembly.dll`, IL2CPP metadata, 그래픽 UI asset/config를 읽기 전용으로 조사한다. runtime/plugin load 성공과 UI 노출을 구분한다.
5. **5단계 — DLSS 요청 실행:** 공통 UI gate를 안전하게 해소해 게임이 옵션을 정상 노출한 뒤, 인게임에서 DLSS(Super Resolution)를 켜고 같은 고정 profile로 재실행해 `metalFxConversion` 양성 신호를 찾는다.
6. **비교 경로:** 옵션이 정상 노출된 뒤 게임 내장 FSR 3.1 Super Resolution을 frame generation 없이 비교한다. OptiScaler/proxy DLL/hook는 안티치트와 공유 게임 무결성 경계를 침범하므로 이 매트릭스에 포함하지 않는다.

각 단계에서는 한 변수만 바꾸며 이전 단계의 evidence 판정이 끝나기 전 다음 단계로 넘어가지 않는다. 어느 단계에서도 진짜 NVIDIA DLSS 실행을 주장하지 않으며 목표는 GPTK의 DLSS→MetalFX 변환이다.

### 실행별 증거 수집

1. launch 시작 전에 기존 Unity `Player.log`의 identity/mtime을 기록하고, 종료 후 이번 실행에서 새로 생성·변경된 log만 run ID별 diagnostics 경로로 복사한다. stale 또는 다른 실행의 `Player.log`를 증거로 사용하지 않는다.
2. run ID 아래에 launch profile, Wine log, D3DMetal unified log, per-run `Player.log`, runtime evidence JSON을 묶는다. profile에는 정확한 Steam argv, 허용된 환경, Wine tag, GPTK manifest/version/hash 상태, 게임 경로와 보호 파일 해시를 남긴다.
3. D3DMetal unified log가 header만 제공할 수 있으므로 게임이 살아 있는 동안 PID가 확인된 프로세스의 `lsof` module snapshot을 같은 run ID로 best-effort 수집한다. backend 검증에 필요한 GPTK framework/DLL load를 다른 로그로 확인할 수 없으면 이 snapshot 부재 시 검증을 보류한다. snapshot 수집을 위해 게임/안티치트에 attach하거나 inject하지 않는다.
4. 수집 실패는 실행 실패와 구분해 기록하되, 필수 증거가 없으면 `backendVerified` 또는 `metalFxVerified`를 추정해 true로 만들지 않는다.

### renderer 및 기능 판정

1. per-run `Player.log` parser는 Unity renderer 초기화 줄을 구조적으로 판독해 `d3d12`, `d3d11`, `moltenvk`, `unknown`, `conflict` 중 하나의 `selectedRenderer`를 만든다. `Forcing GfxDevice: Direct3D 12`와 `Direct3D 12 [level …]`처럼 일관된 D3D12 초기화가 있어야 `d3d12`로 판정하며, 누락·상충·stale log는 검증 실패로 둔다.
2. `backendVerified`는 같은 실행에서 모두 만족할 때만 true다: `selectedRenderer=d3d12`; `-use-d3d12`를 포함한 정확한 Steam launch profile과 고정 환경; Wine `11.0-1-crossover-signed-experimental`; signed/hash-checked GPTK 4.0b2 manifest와 runtime integrity; GPTK D3DMetal 및 D3D12 활성 load 증거; 보호 파일 해시 불변; DXMT가 활성 backend라는 증거 없음.
3. `d3d11.dll`, MoltenVK, `nvngx.dll`, `dxgi.dll` 등의 module presence는 각각 별도 observation으로 보존한다. `selectedRenderer=d3d12`인 실행에서는 부수적인 D3D11/MoltenVK module presence만으로 `backendVerified`를 false로 만들지 않는다. 반대로 `Player.log`가 Direct3D 11 또는 MoltenVK를 renderer로 선택했거나 DXMT 활성 초기화를 기록하면 fallback으로 판정해 false로 둔다.
4. `metalFxVerified`는 DLSS 요청이 MetalFX로 실제 변환·실행됐음을 보여 주는 명시적인 양성 runtime 신호가 같은 run ID에 있을 때만 true다. 환경 변수, 설치 파일/해시, `nvngx` load, 단순 `MetalFX` 문자열, FFX 버전은 단독 또는 조합으로도 충분하지 않다. unsupported/not requested/failed 메시지가 있거나 양성 신호가 없으면 false다.
5. 전체 `verified`는 `backendVerified && metalFxVerified`를 유지한다. 따라서 실행 `1785456322875`는 DX12 backend의 유효한 양성 증거지만 MetalFX 및 전체 검증은 false로 남는다.

### 안티치트 및 무결성 경계

- 후속 검증 실행은 확정된 `-use-d3d12`와 고정 profile을 유지한다. 게임 파일·그래픽 설정 파일·DLL·실행 파일·안티치트 구성·prefix의 Steam/timeout 설정을 수정하지 않는다.
- 안티치트를 비활성화·우회하거나 debugger/injector/hook를 연결하지 않으며, unsigned Wine 교체, DLL override, DXMT/DXVK 주입, MoltenVK 강제 설정으로 성공 조건을 완화하지 않는다.
- 정적 바이너리 조사는 읽기 전용으로만 수행하고 실행 중인 게임 또는 안티치트 프로세스에 attach하지 않는다. 이 경계를 요구하는 진단 또는 대체 경로는 사용하지 않는다.

### 구현 순서와 종료 기준

1. **완료:** diagnostics 경로에 per-run fresh `Player.log`와 live module snapshot을 추가하고, analyzer/evidence schema에서 `selectedRenderer`, exact profile/runtime integrity, module observations, `backendVerified`, `metalFxVerified`를 분리했다.
2. **완료:** D3D11/MoltenVK module-absence를 backend 조건에서 제거하고 Unity renderer/profile/runtime gate로 교체했으며, MetalFX는 명시적인 양성 변환 신호만 허용하도록 보수적으로 판정한다. 실행 `1785457881424`에서 DX12 backend success와 MetalFX false를 재확인했다.
3. **완료:** 임시 NVIDIA registry 조사 때문에 추가된 ZZZ D3DMetal install/launch의 registry set/query 호출과 ZZZ 전용 registry 테스트·refactor를 source에서 제거했다. 공유 `setNVExtension`과 기존 비-D3DMetal YAAGL/DXMT 채널의 legacy 동작은 유지했다.
4. **완료:** registry cleanup 뒤 10개 test file의 126개 test, TypeScript, format, lint(0 errors/기존 warnings 9개), app build를 통과했다. 삭제된 3개 테스트는 제거된 임시 registry 계약 전용이다.
5. **완료:** `CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal`을 고정 환경에 추가했고 실행 `1785460061723`으로 그 효과 범위를 확정했다.
6. **완료:** NVAPI unixlib pairing alias를 `D3DMETAL_NVAPI_RUNTIME_ALIASES`로 구현하고 overlay/검증 계약에 넣었다. 실행 `1785461305869`에서 NVAPI 초기화 성공과 Streamline DLSS/DLSSG plugin 로드를 확인했다. 검증 기준선은 10개 test file의 127개 test 통과, `tsc` 통과, format 통과, lint 0 errors/기존 warnings 9개, app build 통과다.
7. **완료:** Retina와 커스텀 해상도의 전체화면 여부를 분리해 `createZzzScreenArguments`와 ZZZ 설정 UI로 구현했다. 실행 `1785462853546`에서 3456×2234 전체화면 profile, DX12 backend, NVAPI/Streamline 초기화가 함께 유지됨을 확인했다.
8. **완료:** 위 변경 뒤 10개 test file의 **128개 test**, `tsc`, format, lint(0 errors/기존 warnings 9개), app build를 통과했다.
9. **완료:** 외부 주 디스플레이의 물리 픽셀을 자동 선택하고 이전 자동 기준값만 안전하게 마이그레이션하도록 구현했다. 런처 UI와 실행 `1785495345134`에서 3840×2160 전체화면, Retina, DX12 backend, NVAPI/Streamline 초기화가 함께 유지됨을 확인했다.
10. **완료:** 위 변경 뒤 11개 test file의 **133개 test**, `tsc`, format, lint(0 errors/기존 warnings 9개), ZZZ DX12 app build를 통과했다.
11. **남은 작업:** 로그인 후 게임 UI에서 3840×2160 전체화면을 확정하고 DLSS 실행으로 `metalFxVerified`를 판정한다. 그때까지 MetalFX와 전체 `verified`는 false로 유지한다. 이후 같은 출력·Frame Generation off·DXR off 조건에서 Native/TAA와 FSR 3 Quality를 비교한다.

## 타입 및 상태

- `WineDistributionAttributes.renderBackend`를 `"dxmt" | "d3dmetal"`로 확장한다.
- GPTK schema version, D3DMetal version, 필수 파일 SHA-256, import 시각을 담는 `GptkRuntimeManifest`를 추가한다.
- D3DMetal Wine 설치는 유효한 GPTK manifest를 필수 입력으로 받고 모든 설정이 성공한 뒤에만 `wine_state=ready`를 기록한다.
- 로그인 뒤 upscaling 품질/성능을 비교해야 한다면 게임이 기본 제공하는 ZZZ FSR 3.1을 가장 안전한 비교 경로로 사용한다. 이는 MetalFX 검증을 대신하지 않으며 DXR 및 DLSS/FSR frame generation 활성화는 범위에서 제외한다.
- OptiScaler는 proxy DLL/hook injection을 사용하는 별도 고위험 실험이다. 안티치트 호환성과 공유 게임 DLL/EXE 무결성 계약에 충돌하므로 main 구현·검증 경로에서 제외하고 게임 폴더에 주입하지 않는다.

## 검증 및 완료 조건

- Vitest로 DMG 탐색/선택, 버전 및 파일 검증, 취소와 실패 시 mount cleanup, manifest 손상 감지, staging 원자성, stale lock 회수, 확정된 실행 명령과 고정 환경, D3DMetal 경로의 DXMT 미호출을 검사한다.
- diagnostics 테스트는 다음을 포함한다: run ID별 fresh `Player.log`/module 경로; stale log 거부; D3D12/D3D11/MoltenVK/unknown/conflict renderer parsing; D3D12 선택과 부수적인 `d3d11.dll`·MoltenVK load가 함께 있어도 정확한 profile/runtime 증거가 있으면 backend true; 실제 D3D11/MoltenVK fallback, DXMT 활성, profile/env/version/hash 불일치는 backend false; 증거 누락은 false.
- MetalFX 테스트는 `D3DM_ENABLE_METALFX=1`, GPTK/NVNGX 파일과 module load, 일반 `MetalFX` 문자열 및 현재의 unsupported/not-requested/failed 로그만으로는 false임을 확인한다. 명시적인 DLSS→MetalFX runtime 변환 fixture에서만 true이며, 전체 `verified`는 backend와 MetalFX가 모두 true일 때만 true다.
- `pnpm exec vitest run`, `pnpm exec tsc`, `pnpm run lint`, `pnpm run format-check`, `YAAGL_CHANNEL_CLIENT=naposdx12 node build-app.js`를 통과시킨다.
- NVAPI alias 테스트는 `D3DMETAL_NVAPI_RUNTIME_ALIASES`의 정확한 두 항목과 `assertD3DMetalRuntimeAliasTarget`의 target 불일치 거부를 검사한다. `validateD3DMetalWine`은 alias 부재와 잘못된 target을 모두 실패로 처리해야 한다.
- 현재 기준선은 11개 test file, **133개 test 통과**, `tsc` 통과, format 통과, lint 0 errors/기존 warnings 9개, build 통과다. 외부 주 디스플레이 네이티브 해상도 자동 선택 구현 뒤 이 값으로 갱신됐다.
- 생성 앱과 Git 추적 파일에 Apple의 GPTK framework/DLL/SO가 포함되지 않았음을 검사한다.
- 현재 GPTK 4.0 beta 2 DMG로 새 prefix를 구성하고 기존 ZZZ 폴더를 연결해 실제 플레이 공간까지 진입한다. 실행별 fresh `Player.log`에서 Unity Direct3D 12 선택을 확인하고, exact profile/runtime integrity와 GPTK D3DMetal/D3D12 활성 load 증거를 결합해 backend를 판정한다.
- module snapshot의 D3D11/MoltenVK observation은 기록하되 활성 fallback과 동일시하지 않는다. `Player.log`가 D3D11/MoltenVK를 선택하거나 DXMT 활성 증거가 있으면 backend 검증은 실패한다.
- MetalFX 및 전체 완료는 동일 실행에서 명시적인 DLSS→MetalFX 양성 runtime 증거를 확인할 때까지 false다. 현재 기준 실행 `1785495345134`도 로그인 전이라 이 조건을 충족하지 않으며 registry/GPU spoofing은 acceptance condition이 아니다.
- 실행 전후 공유 게임 그래픽 DLL 해시가 같고 기존 YAAGL 앱과 support 경로에 쓰기가 없어야 한다.

## 전제

- v1 대상은 Apple Silicon, macOS 26 이상이며 1차 검증 환경은 M5 Pro, 64 GB, macOS 26.6이다.
- 새 prefix에서는 HoYo 로그인이 다시 필요하다.
- 안티치트 호환성은 Wine `11.0-1 Crossover signed experimental`, Steam stub, `WINE_ENABLE_TIMEOUT_FIX=1`의 결합을 유지한다.
- 게임 또는 안티치트 업데이트 후에는 고정 Wine, Steam stub, timeout patch를 각각 재검증하며 다른 backend로 자동 fallback하지 않는다.
