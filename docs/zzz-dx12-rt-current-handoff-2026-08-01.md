# ZZZ DX12 / D3DMetal Ray Tracing 현재 인수인계

최종 갱신: 2026-08-02 KST

이 문서는 다음 세션의 권위 있는 재개 지점이다. 이전 문서와 실험 로그는
근거 자료로 남아 있지만, 현재 상태와 다음 순서는 이 문서를 우선한다.

## 1. 최종 목표

Zenless Zone Zero를 Mac의 YAAGL D3DMetal DX12 경로로 반복 실행·검증하고,
로그·minidump·Ghidra 증거와 Architect/Critic 검토를 거친 최소 패치를
구현·빌드·설치하여 **ray tracing이 실제 게임 장면에서 정상 렌더링되게 한다.**

다음은 완료가 아니다.

- DX12 또는 DXR capability가 노출되는 것
- 게임 설정에 Ray Tracing 메뉴가 보이는 것
- BVH build/refit HUD가 보이는 것
- RT state object 또는 셰이더 하나만 성공하는 것
- 크래시 없이 실행되는 것

완료 조건은 실제 도시 장면에서 사용자가 RT 기여를 눈으로 확인하고, 관련
RT 셰이더/PSO가 실패하지 않으며, 게임이 안정적으로 유지되는 것이다.

## 2. 현재 권위 상태

실제 RT 성공은 아직 없다. 도시 장면의 배경이 하얗고 평면적으로 변했고,
사용자 확인에서도 RT 기여가 보이지 않았다. `supportsRayTracing = 1`, DX12
진입, 유효한 passive capture ACK만으로 성공을 선언하지 않는다.

현재 직접 막힘은 RT가 아니라 **런처에 추가한 capture authority 안전 게이트가
게임을 강제 종료하는 회귀**다. 이 게이트는 RT를 고치지 않으며, 실제 도시
렌더링과 D3DMetal 실패 관측이라는 목표를 가로막았다. 다음 세션은 보안 계약을
확장하거나 더 복잡하게 만들지 말고, 먼저 정상적인 게임 진입을 복구해야 한다.

2026-08-02 사용자가 직접 시작한 run `1785640790322`와 `1785640852138`은 모두
게임과 capture dylib가 정상 기동해 유효 ACK를 생성했다. 그러나 ACK 열거 코드가
macOS에 존재하지 않는 `/usr/bin/test`를 호출했다. 실제 실행 파일은
`/bin/test`다. `exec()`가 exit 127을 throw했고, 대기 루프는 원인을
`acknowledgement unreadable`로 뭉개 10초 동안 반복했다. timeout 뒤
`terminateAndConfirmD3DMetalWineTree()`가 wineserver와 게임을 종료했다. 따라서
두 종료는 게임/D3DMetal 크래시가 아니라 **YAAGL 런처가 만든 종료**다.

더 중요한 설계 교정은 다음과 같다.

- 목표는 게이트의 완전성이 아니라 실제 city render 진입과 RT 수정이다.
- capture 증거 수집 실패가 게임 자체를 종료하게 만들지 않는다.
- ACK/ARM/lsof는 진단 수단이며 제품 실행의 선행 권위가 아니다.
- 진단이 실패하면 명확히 기록하고 게임을 계속 실행시켜 도시 화면과 D3DMetal
  로그를 확보한다. 단, capture dylib 자체가 게임 안정성을 훼손한다는 직접
  증거가 있으면 그때만 해당 진단 모드를 끈다.
- 다음 세션에서 `/usr/bin/test`를 `/bin/test`로 한 줄 고치는 것만으로 기존
  fail-closed 구조를 승인하지 않는다. 먼저 launch-blocking 결합 자체를 제거하거나
  best-effort/observational로 재설계한다.

### 2.1 마지막 설치 빌드의 식별자와 현재 판정

- diagnostics source:
  `7646438f533572c08cdb8aed60cf4a592a806892d5ab17eefe8bd81427a10d90`
- diagnostics spec:
  `f9ef08ca7ba7721e536e863985730d47f99b591a0e9bc623d141495e93280d79`
- launcher source:
  `a0abec234aaa30148bcff9d023a435bf51ecbfa83f83cfc3ea1b12032a338499`
- native source:
  `25a03c1de797e40eb962f305e9ba3a4f3699610b6872e748db06697d4c151a5d`
- manifest:
  `fae670f732eb6da6c14a38b06f6d582c72b9ce4ff5113839bb926e52a282a1a1`
- `resources.neu` bundle=installed:
  `130eeef953bc3cf69c77b620feebf9a3bdbe5fdce2c8cf8007864be7e9d34188`
- 이 빌드 당시 TypeScript PASS, Vitest `11 files / 182 tests` PASS, native contract PASS,
  late-load both orders PASS, app build PASS, deep/strict codesign PASS.
- 앱을 실행하지 않고 resources/sidecar만 transactional install했고 교체 전
  백업은 휴지통에 복구 가능하게 보존했다.
- ACK namespace, raw ACK, PID+UID+lstart, five exact vnode, initial/prearm/
  postarm ledger, capturing 매-poll ACK 검사까지 런처에 연결됐지만, 실제 제품
  실행에서는 `/usr/bin/test` 경로 오류로 ACK 이후 진행하지 못했다.
- `program-launch-game.ts`에는 argv candidate 권위 import/use가 없다.

이 해시들은 재현용 식별자이지 실행 승인 증거가 아니다. 두 실제 실행으로 기존
`RUN-OKAY-ONE` 전제와 `run_authorized=true`, `attempt_consumed=false` 표기는
폐기됐다. 현재 재실행은 승인되지 않았고, 다음 세션은 먼저 launcher kill
regression을 수정·검증한 뒤 사용자에게 실행 가능 여부를 명시해야 한다.

## 3. 현재 디스크·런타임 상태

| 항목 | 현재 값 |
| --- | --- |
| 저장소 | `/Users/hanbinnoh/Documents/yaagl-dx12` |
| 브랜치 | `work/zzz-gptk-dx12` |
| 앱 | `/Users/hanbinnoh/Documents/yaagl-dx12/Yaagl ZZZ DX12.app` |
| Support | `/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12` |
| 게임 | `/Applications/ZenlessZoneZero` |
| Wine | `11.0-1-crossover-signed-experimental` |
| D3DMetal | GPTK `4.0b2`, x86_64/Rosetta |
| 활성 진단 모드 | `metal-ir-capture-v2` passive capture |
| capture dylib SHA-256 | `c6458a73e40409aa4a67f965090f05e1e36e8feb0933cf1e9e11b2a50b2518bc` |
| D3DMetal SHA-256 | `4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851` |
| provider SHA-256 | `75974d49ad4dd1bdf17ab3cd666ae7cac43e7f7a5760237699ab33ecd3d31daf` |
| control helper SHA-256 | `a3d850dc35643a322ba93f9db3a7882b4b8c0bd1b22f6526a93bb85dbfcc0077` |
| historical replacement DXIL SHA-256 | `c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717` |
| 실행 중 앱/게임/Wine | 없음 |
| git stage/commit/push | 하지 않음 |

capture dylib, D3DMetal, provider, helper의 source/bundle/installed identity는
각각 위 exact SHA를 기준으로 재검증됐다. 앱도 현재 source로 다시 빌드됐고
deep/strict codesign 및 bundle/installed resources·sidecar equality가 통과했다.

워크트리는 큰 dirty 상태다. 관련 없는 사용자 변경을 되돌리지 않는다.

## 4. 최신 실행과 런처 강제 종료 회귀

### 4.1 run `1785631799629`

세션 루트:

```text
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785631799629_metal_ir_session
```

정확히 하나의 ACK가 생성되었고 identity는 다음과 같다.

```text
pid=29660
ack=acks/ack-29660-931ba6e469b0f3b2bfa9ae15f0904376.json
capture_sha256=c6458a73e40409aa4a67f965090f05e1e36e8feb0933cf1e9e11b2a50b2518bc
d3dmetal_sha256=4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851
provider_sha256=75974d49ad4dd1bdf17ab3cd666ae7cac43e7f7a5760237699ab33ecd3d31daf
configured_offset=0x87ec9
got_readback=true
protection_restored=true
```

Player.log은 `Direct3D 12 [level 12.1]`과 `supportsRayTracing = 1`을
확인했다. 하지만 `ARM`, `capturing`, instance/capture artifact, terminal
artifact는 없었고 런처는 `v2 capture control gate was never armed`로 끝났다.
도시 진입과 스크린샷도 수행하지 않았다. 정리 후 Yaagl/Wine/game 프로세스는
없다.

### 4.2 run `1785640790322`와 `1785640852138`

사용자가 직접 실행한 두 번의 시도다.

| run | game PID | ACK | 결과 |
| --- | ---: | --- | --- |
| `1785640790322` | `54922` | `ack-54922-9383730773710dc94e8177b4655389b0.json` | ACK 후 런처가 Wine tree 종료 |
| `1785640852138` | `55487` | `ack-55487-b35c649d3e930959fabf984697080d70.json` | 동일 |

두 ACK 모두 schema 2, mode `metal-ir-capture-v2`, UID 501, 현재 run/token/
attempt, exact capture/D3DMetal/provider SHA, `configured_offset=0x87ec9`,
`got_readback=true`, `protection_restored=true`를 가졌다. Wine/module 로그는
`ZenlessZoneZero` 프로세스와 D3DMetal 관련 파일이 로드되는 정상 초기화 경로를
보여 준다. 새 crash dump나 게임 자체 fatal 근거는 확인되지 않았다.

세션에는 `attempt-*`와 ACK만 있고 ARM, controls, instance terminal, capture
artifact, authority ledger는 없다. `neutralinojs.log`에서 ACK 발견 뒤 다음
명령이 반복된다.

```text
/usr/bin/test ! -L .../acks/ack-55487-....json
```

이 시스템에는 `/usr/bin/test`가 없고 `/bin/test`만 있다. 따라서 명령은 exit
127이며 `enumerateD3DMetalCaptureAcknowledgements()`가 `stat`, raw ACK parse,
PID-specific authority snapshot에 도달하지 못했다. 약 10초 뒤 런처가
`wineserver -k`를 실행했고, 이후 `v2 capture control gate was never armed`가
기록됐다. 사용자에게는 게임이 조용히 꺼진 것으로 보였다.

테스트가 이 문제를 놓친 이유도 보존한다. protocol/parser 및 주입된 mock 기반
Vitest는 통과했지만, 설치 앱에서 정확한 macOS executable path를 호출하는
real-product smoke test가 없었다. 따라서 이전의 “빌드 완료/실행 가능” 판단은
철회한다.

### 4.3 다음 세션의 설계 교정

기존 ACK-first/five-vnode 설계는 진단 증거의 신뢰도를 높이려다 게임 실행을
진단 성공에 종속시켰다. 다음 세션은 다음 순서를 지킨다.

1. `program-launch-game.ts`에서 ACK/lsof/ARM 실패가
   `terminateAndConfirmD3DMetalWineTree()`로 이어지는 결합을 제거한다.
2. 진단 준비 실패를 로그/evidence에 보존하되 게임은 계속 실행한다.
3. `/usr/bin/test` 같은 host command 경로를 전수 검사하고 실제 설치 앱과 같은
   command builder를 사용하는 macOS smoke test를 추가한다.
4. 게임을 자동 실행하지 않고 빌드·설치·서명·명령 smoke test까지만 끝낸다.
5. 사용자 승인 뒤 한 번 실행한다. 좌표 클릭으로 도시까지 빠르게 진입하고
   흰색/평면 배경 여부를 스크린샷으로 판정한다.
6. 도시 진입 후 D3DMetal/MetalIR/RTPSO 실패를 수집하고, 그 증거로 renderer
   patch를 설계한다. 이것이 본 작업의 중심 루프다.

### 4.4 진단 권위 검증을 유지할 경우의 불변조건

- 현재 run/token/attempt/schema에 귀속된 유효 ACK가 정확히 하나여야 한다.
- ACK PID의 생존과 ACK 직후 `pid + lstart`를 기록한다.
- `lsof -Fn`으로 game, capture, D3DMetal, provider, d3d12의 five exact vnode를
  확인한다.
- 실제 명령은 `/usr/sbin/lsof -n -P -p PID -F0pcfDintn`이며 NUL-delimited
  `t=REG`, hex `D`, decimal `i`, absolute `n`을 byte-level로 파싱한다.
- configured path의 모든 lexical component는 symlink가 아니어야 하고 leaf는
  direct regular file이어야 한다. 기대 identity는 `realpath + stat(bigint)`의
  canonical path, `st_dev`, `st_ino`다.
- authority는 canonical 또는 canonical로 해소되는 symlink spelling과 exact
  `(device,inode)`의 결합만 허용한다. path-only/vnode-only fallback은 없다.
  alternate hard link, deleted/unreachable path, distinct-vnode conflict는 실패다.
- 같은 accepted vnode의 반복 mapping은 collapse하며 descriptor/order/count는
  권위 identity가 아니다.
- ACK PID가 `ps.args` 게임 후보에 없다는 이유만으로 탈락시키지 않는다.
- ARM 직전에 PID/UID/start identity와 five exact vnode를 다시 확인한다.
- 중복, 소실, 불일치, PID 재사용이면 fail-closed하고 ARM하지 않는다.
- ACK부터 ARM까지의 결과와 binding을 immutable authority ledger로 남긴다.
- ARM 직전 expected-path preflight와 PID-specific `lsof`를 캐시 없이 다시
  실행하고 normalized artifact/canonicalPath/device/inode/REG 집합이 같아야 한다.

### 4.3 UI 및 브라우저 운영 규칙

Wine 접근성 자동화는 사용하지 않는다. capture 준비 뒤 Computer Use의
스크린샷/좌표 클릭으로, 중간 화면을 매번 확인하지 않고 간격을 둔 빠른
반복 클릭으로 도시 장면까지 진입한다. 도시 장면에서 배경을 한 번 확인하고,
STOP 및 terminal/restoration 검증 뒤 `Command+F4`로 게임을 종료한다.
실패한 run은 자동 재시도하지 않는다.

Architect/Critic 맥락 보존을 위해 브라우저 탭은 여러 개 유지할 수 있으나
무한히 늘리지 않는다. 오래된 탭은 맥락이 더 이상 필요 없을 때부터 정리하고,
검토 직후 즉시 닫지는 않는다.

## 5. 이전 functional/FP64 실험의 결정적 증거 (역사적 기록)

### 5.1 실행 식별자

```text
run stem: 1785592905467
mode: metal-ir-unorm-fix-v1
```

로그:

```text
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785592905467_metal_ir_probe.log
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785592905467_wine.log
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785592905467_player.log
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785592905467_system.log
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/d3dmetal_1785592905467_evidence.json
```

### 5.2 성공한 정확한 셰이더 치환

실제 probe 증거:

```text
probe target-entry caller=D3DMetal offset=0x9a12f sink=null
probe source-sha256=02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869
probe replacement-sha256=c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717
probe original-object=0x7fec40a460c0
probe replacement-object=0x7fec40af2070
probe error-code=0x0
probe target-result=0x7fec40a19470
probe replacement-compile-succeeded
probe target-races=0x0
probe rolled-back
```

이 결과는 다음을 증명한다.

- exact D3DMetal caller/GOT hook가 실제 게임에서 발화했다.
- 원본과 replacement가 서로 다른 provider-native `IRObject`였다.
- 원본 `CompileAndLink`를 replacement 인자로 정확히 한 번 호출했다.
- error 0, non-null result로 실제 MetalIR compile/link가 성공했다.
- 동시 진입이 없었고 GOT가 원복됐다.

### 5.3 제품 결과

- 게임은 도시 로딩까지 크래시 없이 진행했다.
- 사용자가 화면을 직접 확인했으며 **ray tracing은 보이지 않았다.**
- 사용자가 확인 후 직접 게임을 종료했다.
- 따라서 이번 종료는 크래시가 아니다. 새 `crash.dmp`가 없고
  `OnApplicationQuit`가 기록된 것은 수동 종료와 일치한다.
- 다음 세션에서 이번 종료를 replacement 수명 문제나 post-success crash로
  재분류하지 않는다.

### 5.4 남은 직접 실패

같은 run의 `system.log`와 evidence가 기록한 결과:

```text
MetalIR Unhandled FP64: 14
  compute: 9
  fragment: 5
no-op PSO: 7
  IDs: 350, 433, 452, 522, 634, 650, 667
```

주요 시각은 23:07:33–23:07:53 KST다. 성공한 exact shader 하나 외에 다른
셰이더가 계속 error 19/`Unhandled FP64 usage`로 실패해 graphics/RT 그래프가
끊겼다. 현재 RT 비가시의 가장 강한 직접 원인이다.

23:08:10의 `Unsupported: Failed to create commited resource`도 기록됐지만,
수동 종료와 분리하고 다음 수집 run에서 재현 여부를 관찰한다. 이것만으로
주원인이라고 단정하지 않는다.

## 6. 역사적 FP64 원인과 replacement 제작 증거

### 5.1 원본 캡처

이전 read-only `metal-ir-dxil-v2` 실행 `1785588990038`에서 exact 실패
DXIL을 안전하게 캡처했다.

```text
file: d3dmetal_1785588990038_fp64.dxil
size: 26964
SHA-256: 02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869
error: 0x13 = Unhandled FP64 usage
```

### 5.2 공식 DXC 분석

Microsoft DirectXShaderCompiler v1.9.2607로 disassemble한 결과 binary64는
다음 UNORM24 정규화 그래프 네 개뿐이었다. `ExecuteTrace` 두 개,
`ExecuteTrace_SortRay` 두 개다.

```llvm
uitofp i32 (value & 0xFFFFFF) to double
fmul fast double by 1/(2^24-1)
fptrunc double to float
```

float-only 교체:

```llvm
uitofp i32 to float
fdiv float by 16777215.0f
fadd float result, 0.0f
```

모든 16,777,216 입력을 `-fno-fast-math -ffp-contract=off`로 비교했고 bit
불일치가 0이었다. endpoint, 범위, finite, monotonic도 통과했다.

### 5.3 replacement

```text
file: sidecar/diagnostics/zzz-rt-unorm-float.dxil
size: 17720
SHA-256: c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717
```

공식 DXC API로 assemble하고 `dxv.exe`로 validate/sign했다. 현재 exact
replacement는 검증된 자산이므로 폐기하지 않는다. 다만 다른 hash에 재사용하면
안 된다.

## 7. 현재 구현

핵심 파일:

- `native/metal-ir-capture/metal-ir-capture.cpp`
- `native/metal-ir-capture/tests/unorm24-equivalence.cpp`
- `native/metal-ir-capture/tests/provider-object-lifetime-proof.cpp`
- `scripts/build-metal-ir-capture.sh`
- `tools/dxil-assemble.cpp`
- `sidecar/diagnostics/zzz-rt-unorm-float.dxil`
- `src/wine/d3dmetal.ts`
- `src/clients/mhy/nap/program-launch-game.ts`
- `src/diagnostics/d3dmetal.ts`

현재 `metal-ir-unorm-fix-v1`은 다음 fail-closed 계약을 가진다.

- replacement size/hash를 CommonCrypto로 검증한다.
- exact caller와 source object layout/size/hash만 허용한다.
- provider의 `IRObjectCreateFromDXIL`로 replacement object를 만든다.
- 원본 compiler/vector를 유지하고 arg3만 replacement로 바꾼다.
- 원본 `CompileAndLink`를 한 번만 호출하고 결과를 그대로 반환한다.
- `IRError`와 replacement object를 provider API로 정확히 파괴한다.
- mismatch는 원본 object/sink를 그대로 forward한다.
- active-call drain 후 GOT를 원복한다.

단, 병렬 수명 감사에서 **미관측 잠재 위험**이 발견됐다. provider proof의
replacement `IRObject`는 borrowed bytes/`owns=0`이고, 현재 훅은
`CompileAndLink` 반환 직후 object를 destroy하고 worker가 mapping을 unmap할 수
있다. 실제 이번 run에서 UAF나 크래시는 없었지만 원 caller는 결과의
`GetMetalLibBinary`/`GetReflection` 소비 뒤 input을 파괴하므로, 현재 훅이
수명을 앞당길 가능성은 남는다. 따라서 exact functional mode를 반복 검증용
production fix로 간주하지 말고, 다음 run은 replacement object/mapping이 없는
passive capture mode로 전환한다. `g_d3dmetal` publish도 release/acquire atomic
계약으로 정리해야 한다.

Ghidra/정적 오프셋:

```text
D3DMetal call: +0x9a12a, bytes e8 4f 62 2d 00
return/caller: +0x9a12f
stub: +0x37037e, bytes ff 25 1c de 13 00
GOT: +0x4ae1a0
provider CompileAndLink: +0x92fe30
provider IRObjectCreateFromDXIL: +0x931b40
provider IRObjectDestroy: +0x931b80
provider object vtable: +0x14940e0
```

기존 no-op PSO 안정화 framework의 검증된 signed SHA
`4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851`도
런타임 기반에 유지돼 있다.

## 8. 검증 완료 항목

현재 소스 기준 통과: TypeScript, Vitest **11 files / 178 tests**, native
contract tests, late-load fixture, installed production constructor/STOP,
app build, deep/strict codesign. 실제 게임 RT 성공은 포함되지 않는다.

```sh
./scripts/build-metal-ir-capture.sh --test
pnpm exec tsc --noEmit
pnpm exec vitest run src/wine/d3dmetal.spec.ts src/diagnostics/d3dmetal.spec.ts
YAAGL_CHANNEL_CLIENT=naposdx12 node build-app.js
codesign --verify --deep --strict --verbose=2 'Yaagl ZZZ DX12.app'
```

추가로 provider object lifecycle proof가 실제 provider constructor/vtable/borrowed
bytes/type/ownership/destructor를 확인했다. App/source/runtime의 dylib와
replacement 해시도 일치한다.

## 9. 다음 작업: authority mapping 패치 후 재검토

Architect/Critic follow-up에서 vnode alias/device-inode semantics를 확정한
뒤에만 ACK-first authority mapping을 구현한다. 구현 후 전체 테스트·빌드·설치
identity를 재검증하고, 새 Architect/Critic run gate 없이는 게임을 실행하지
않는다. 권위 gate가 통과한 다음에만 좌표 기반 도시 진입과 단일 배경
스크린샷을 수행한다.

## 10. 역사적 다음 작업: bounded multi-capture

목표는 아직 functional rewrite를 넓히는 것이 아니라, 남은 error-0x13
DXIL의 **고유 집합을 안전하게 수집**하는 것이다.

권장 설계:

1. 현재 exact functional mode는 보존하고 별도 진단 mode
   `metal-ir-multicapture-v1`을 만든다.
2. 원본 `CompileAndLink`를 입력 변경 없이 정확히 한 번 호출한다.
3. 후보 호출의 입력 `IRObject_DXIL` metadata를 검증하고 **원본 호출 전**
   private slot에 읽기 전용 복사한다. 호출 후 input metadata는 다시 읽지 않는다.
4. 원 caller의 sink가 null인 후보에서만 private `IRError**`를 사용해 code를
   읽고 정확히 한 번 destroy한다. `IRErrorGetPayload`는 호출하지 않는다.
5. 반환 `IRError` code가 `0x13`일 때만 pre-call private copy를 publish한다.
6. SHA-256+length 사전 필터 뒤 byte-for-byte 비교로 중복을 확정하고 파일명에
   순번·size·SHA를 기록한다.
7. capture cap을 고정한다. 병렬 검토의 보수적 시작안은 unique 16개,
   shader당 64 KiB, 총 1 MiB, log record 32개다. 실제 원본 size 분포가 이
   상한을 넘는다면 cap을 조용히 늘리지 말고 omission metadata를 남긴 뒤
   Architect에 재검토시킨다. 수명 감사의 대안은 8 slots × 1 MiB이며 최종
   수치는 Architect/Critic에서 선택한다.
8. render thread에서는 고정 private buffer로만 복사하고 파일 publish/hash
   목록 관리는 worker에서 수행한다.
9. 원본 `IRObject*`, compiler, arguments, result identity를 변경하지 않는다.
10. unreadable/invalid object, cap 초과, allocator 실패, race, GOT mismatch에서
   즉시 fail-closed하고 원본 동작을 유지한다.
11. quota 전환 시 먼저 Draining으로 새 claimant를 막고, private-copy claimant와
    active wrapper가 끝난 뒤 GOT를 원복한다. bounded buffers는 process exit까지
    유지해 `munmap` race를 피한다.
12. city 안정화 또는 time/cap 도달 뒤 GOT를 원복하고 active calls가 0이 될
   때까지 기다린다.
13. 각 capture에 caller offset, stage를 알 수 있으면 stage, size, SHA,
    error code, result-null, occurrence count, 가능하면 PSO ID를 manifest로
    남긴다. cap 초과는 `capture-budget-exhausted`, omitted count/stage count로
    기록하며 원본 compile 결과를 바꾸지 않는다.

같은 run에서 RT 실행 단계도 별도 계수로 관측한다.

```text
CreateStateObject
  -> BuildRaytracingAccelerationStructure (BLAS/TLAS)
  -> DispatchRays
  -> output UAV/composite
```

- `CreateStateObject` 0회면 shader/PSO 단계에서 중단된 것이다.
- state object 성공 후 BVH 0회면 acceleration-structure/resource 경로를 본다.
- BVH 성공 후 `DispatchRays` 0회면 command recording/binding을 본다.
- `DispatchRays` 성공 후 화면만 비가시면 UAV/barrier/composite를 본다.

이 계수는 DXIL capture와 섞어 성공을 추정하지 않는다. 우선순위는 원본
semantics를 바꾸지 않는 SHA/stage/error 수집이며, RT 단계 관측은 안전한 기존
로그나 별도 fail-closed 계측으로 추가한다.

그 다음 순서:

1. 실제 도시 run에서 고유 실패 DXIL을 캡처한다.
2. 각 blob을 공식 DXC로 disassemble하고 `dxv.exe`로 원본 validity를 확인한다.
3. Ghidra의 `AIRBuilder::patchFP64Operations`/error-19 경로와 대조한다.
4. 각 shader의 모든 binary64 graph를 분류한다.
5. UNORM24처럼 의미 보존이 증명되는 패턴만 개별 replacement로 생성한다.
6. 각 source/replacement size/hash 매핑을 정적 manifest로 만든다.
7. 모든 replacement를 official validator와 pattern-specific exhaustive/property
   test로 검증한다.
8. Architect/Critic 게이트 뒤에만 multi-hash functional mode를 만든다.
9. 도시 장면에서 FP64 failure/no-op PSO 수, BVH activity, RT 시각 결과,
   안정성을 함께 판정한다.

일반적인 “모든 double을 float로 치환”은 금지한다. 셰이더별 의미 증명이
없는 broad rewrite, converter error branch 우회, fabricated success는 하지 않는다.

## 9. 실제 product path 자동 검증 절차

빌드:

```sh
cd /Users/hanbinnoh/Documents/yaagl-dx12
YAAGL_CHANNEL_CLIENT=naposdx12 node build-app.js
```

`build-app.js`가 PTY에서 조용해도 `node build-app.js`와 `pnpm exec neu build`
프로세스가 끝날 때까지 기다린다. 앱 번들 해시와 codesign을 확인한다.

실행:

```sh
open '/Users/hanbinnoh/Documents/yaagl-dx12/Yaagl ZZZ DX12.app'
```

Computer Use 접근성으로 런처의 `게임 실행` 버튼을 누른다. 접근성이 실패하면
스크린샷/좌표를 사용한다. 현재 창은 CG bounds `X=16,Y=36,W=1280,H=730`였고
버튼의 검증된 global logical 좌표는 약 `(1021,684)`이다.

게임은 Wine 접근성 앱 목록에 나타나지 않는다. 실제 ZZZ PID를 찾고:

```applescript
tell application "System Events" to set frontmost of first process whose unix id is PID to true
```

그 뒤 타이틀 `게임 시작` global logical 좌표 `(656,715)`를 클릭한다. Wine을
먼저 frontmost로 만들지 않으면 클릭이 뒤의 Yaagl 런처로 전달되므로 주의한다.

창은 fullscreen logical `1312x848`, Retina backing `2624x1696`이었다. 접근성
스크린샷이 안 되면 `CGWindowListCopyWindowInfo`로 window ID를 찾고
`screencapture -x -l WINDOW_ID`로 캡처한다.

런처가 `게임 파일 패치 중`에서 멈추면 stale `wineserver`와 `wine reg query
HKEY_CURRENT_USER\\Software\\miHoYo\\ZenlessZoneZero`를 확인한다. 이번 세션에는
이전 run의 stale wineserver가 registry query를 5분 이상 막았다. 정확한 PID만
종료한 뒤 런처 흐름이 재개됐다. broad kill은 하지 않는다.

## 10. 로그와 minidump

run별 로그는 Support의 `logs/d3dmetal_<run>_*`다. 활성 renderer는 Player.log의
다음 문자열을 권위 있게 본다.

```text
Forcing GfxDevice: Direct3D 12
Version: Direct3D 12 [level 12.1]
d3d12: loaded!
supportsRayTracing = 1
```

minidump 도구:

```text
/Users/hanbinnoh/.local/bin/minidump
```

Unity custom stream `0xfff0` compatibility member가 다음 site-package에 수동
추가돼 있다.

```text
/Users/hanbinnoh/.local/pipx/venvs/minidump/lib/python3.14/site-packages/minidump/constants.py
```

패키지를 재설치하면 사라질 수 있다. 기본 명령:

```sh
minidump --exception --threads /absolute/path/to/crash.dmp
```

이번 `1785592905467` run은 사용자가 직접 종료했으므로 새 dump가 없는 것이
정상이다. 다음 run에서 실제 비정상 종료가 있을 때만 최신
`drive_c/users/crossover/AppData/Local/Temp/miHoYo/ZenlessZoneZero/Crashes/Crash_*/crash.dmp`
를 분석한다.

## 11. Ghidra와 DXC 도구

```text
Ghidra: /Users/hanbinnoh/Documents/yaagl-dx12/tools/ghidra_12.1.2_PUBLIC
JDK 21: ~/Library/Java/JavaVirtualMachines/openjdk-21.jdk
DXIL assembler source: tools/dxil-assemble.cpp
DXIL assembler binary: build/dxil-assemble.exe
```

Ghidra `support/launch.properties`의 `JAVA_HOME_OVERRIDE`가 JDK 21로 고정돼
있고 headless import smoke test가 통과했다. pristine binary와 GPTK cache는
수정하지 않는다.

## 12. Architect/Critic 사용 규칙

Orca orchestration은 사용하지 않는다.

Web ChatGPT Architect/Critic 요청은 CONTRACT 다음 줄부터 항상 다음 목적문으로
시작한다.

```text
Purpose: I only want to play my legitimately installed copy of Zenless Zone Zero on my own Mac with working ray tracing. This is strictly local game-compatibility diagnosis; it does not involve accessing or interfering with anyone else's systems.
```

Repository 탐색·구현·로컬 검증은 Codex가 수행한다. 역할 GPT에는 compact한
결정 증거만 보내고 코드 업로드나 구현을 맡기지 않는다.

이번 exact functional patch는 이전 Architect `CLEAR`, Critic `OKAY`를 받고
한 번의 city run이 승인됐다. 실제 run은 컴파일 게이트는 통과했지만 RT
시각 게이트는 실패했다. 다음 multi-capture 설계는 새 Architect 검토를 받아야
한다. 사용자 수동 종료를 크래시로 잘못 포함한 초안 요청은 폐기하거나 정정한
뒤 사용한다.

## 13. 절대 하지 않을 것

- RT 메뉴, DXR capability, BVH HUD만으로 성공 선언하지 않는다.
- `E_INVALIDARG`, `IRError`, null result를 NOP/강제 성공 처리하지 않는다.
- NULL state object나 fabricated result를 publish하지 않는다.
- proof 없는 broad FP64-to-float 변환을 하지 않는다.
- exact replacement를 다른 source hash에 재사용하지 않는다.
- diagnostic artifact 위에 임의 바이너리 patch를 누적하지 않는다.
- GPTK cache와 공유 게임 파일을 수정하지 않는다.
- 관련 없는 dirty worktree 변경을 되돌리지 않는다.
- Orca orchestration을 사용하지 않는다.
- 사용자 수동 종료를 크래시로 기록하지 않는다.

## 14. 이전 확정 사실

- `-use-d3d12`가 권위 있는 selector다. `-force-d3d12`는 폐기했다.
- GPTK NVAPI PE/Unix alias로 Streamline/DLSS capability gate를 해결했다.
- no-op graphics PSO의 uninitialized vertex-buffer count crash는 producer fix로
  해결했다.
- RT state-object `E_INVALIDARG`는 parser/inheritance/store 우회 문제가 아니라
  `CompileRTFunction`/MetalIR compile failure까지 추적됐다.
- `IRCompilerEnableFP64Emulation`은 이미 1이었다. 강제 enable 가설은 반증됐다.
- error 19/`0x13`은 `Unhandled FP64 usage`다.
- Ghidra에서 `AIRBuilder::patchFP64Operations`와 code-19 sites를 확인했다.

세부 과거 증거는 다음 문서에 남아 있다.

- `docs/zzz-dx12-d3dmetal-rtxgi-handoff-2026-08-01.md`
- `docs/d3dmetal-4.0b2-compile-export-store-traps-2026-08-01.md`
- `docs/d3dmetal-4.0b2-create-function-null-traps-2026-08-01.md`
- `docs/d3dmetal-4.0b2-inheritance-result-diagnostic-2026-08-01.md`
- `docs/d3dmetal-4.0b2-ir-link-null-fallback-2026-08-01.md`
- `docs/d3dmetal-4.0b2-separated-noop-and-rt-boundary-2026-08-01.md`
- `docs/d3dmetal-4.0b2-state-object-trap-2026-08-01.md`
- `docs/d3dmetal-4.0b2-vertex-count-guard-2026-08-01.md`

## 15. 2026-08-02 패시브 실런 결과

수정된 패시브 브리지를 실제 제품 경로로 실행한 run은
`1785598935495`다. 사전 profile과 실제 shell command에서 다음을 확인했다.

- `YAAGL_RUNTIME_MODE=metal-ir-capture-v1`
- 설치된 capture dylib가 `YAAGL_DYLD_INSERT_LIBRARIES`로 전달됨
- `YAAGL_METAL_IR_REPLACEMENT` 부재
- probe에 설치 marker 9개
- `-use-d3d12`, Direct3D 12 level 12.1, MTL4, `supportsRayTracing=1`

도시에는 진입했지만 배경이 평면적인 청록색 silhouette로 손상됐고 정상
재질/조명이 보이지 않았다. HUD의 `Dispatch Rays 1`, `Build BVH 1`,
`Refit BVH 7`은 활동 증거일 뿐 RT 성공으로 판정하지 않는다. system log에는
FP64 compile failure 11개(Compute 9, Fragment 2)와 no-op PSO 350/433이
남았다. 실행은 사용자가 종료했고 launch exit code는 0이다.

현재 패시브 manifest는 `complete=true`, `records=[]`, `payload_bytes=0`였다.
이 결과는 target 부재를 증명하지 않는다. 9개 주입 프로세스가 같은 manifest
경로를 공유했고, exact caller-offset 이전 waterfall이 없으며, raw DXIL을 파일로
내보내지 않았고, parser가 empty complete를 diagnostic pass로 잘못 판정했기
때문이다.

Architect `CLEAR`와 Critic `OKAY`를 받은 다음 패치는 다음으로 고정됐다.

- 프로세스 인스턴스별 격리된 manifest와 launcher-side aggregation
- 64개 distinct caller offset과 명시적 overflow를 포함한 bounded waterfall
- 기존 pre-call snapshot의 atomic raw DXIL export
- `lifecycleValid`, `targetObserved`, `payloadValid`, `analysisReady` 분리
- `metalIrDiagnosticPass = analysisReady`; empty target/payload는 반드시 false
- original exactly once, post-call IRObject 접근 금지, 기능성 FP64 patch 금지

다음 city run은 이 결합 패치의 native/TypeScript 테스트, 앱 빌드·설치·해시
검증이 모두 끝난 뒤에만 수행한다. 시작 화면은 좌표를 간격을 두고 연타해
빠르게 통과하고, 도시 배경 스크린샷 한 장을 확인한 뒤 `Command+F4`로 종료한다.

## 16. 다음 세션 시작 체크리스트

1. 이 문서를 먼저 읽고 목표를 그대로 유지한다.
2. 최신 두 종료를 게임 크래시로 분류하지 않는다. run은 `1785640790322`,
   `1785640852138`이고 원인은 `/usr/bin/test` + launch-blocking gate다.
3. `git status`, app/source/runtime hash, 실행 중 Wine/ZZZ 프로세스를 확인한다.
4. 기존 Architect/Critic의 `RUN-OKAY-ONE`은 소비·폐기된 것으로 처리한다.
5. capture authority 실패가 게임 종료를 유발하는 구조부터 제거한다. 단순 경로
   치환만 하고 재실행하지 않는다.
6. 정확한 host command를 실제 command builder로 실행하는 macOS smoke test,
   TypeScript/native 테스트, 앱 build/sign/install verification을 완료한다.
7. 여기서 멈추고 사용자에게 다음 한 번의 실행 준비 상태를 보고한다.
8. 승인되면 screenshot/좌표 클릭으로 도시까지 진입한다. 매 화면을 계속
   확인하지 말고 간격을 둔 반복 클릭을 사용한다.
9. 도시 배경을 판정하고 RT 실패 로그/DXIL을 확보한 뒤 STOP/terminal 정리를
   수행하고 `Command+F4`로 빠르게 종료한다.
10. 공식 DXC/Ghidra로 failing blob을 분석해 의미 보존 renderer/D3DMetal patch를
    만들고 다시 빌드한다.
11. 실제 RT가 보일 때까지 city run -> evidence -> patch 루프를 반복한다.

이 문서가 현재 작업의 최종 인수인계이며, 목표 상태는 아직 **미완료**다.

## 17. 2026-08-02 Pro 결정 반영 — launch authority 분리

Pro Architect는 최신 `1785650786622` 도시 run의 14개 FP64 error-19와 no-op
PSO를 가장 강한 직접 원인으로 판정했다. renderer 기능 패치는 계속 **BLOCK**이며,
다음 관찰은 exact `0x87ec9` pre-call raw-DXIL 하나만 대상으로 한다.

이번 반영에서는 먼저 도시 진입 계약을 구조적으로 우선했다.

- launch-time capture는 prepared ticket이 없으면 반드시 `unavailable`이고,
  일반 `wine.exec2`만 실행한다. ACK/ARM/lsof 또는 Wine-tree terminate 경로는
  ticket 부재 상태에서 선택될 수 없다.
- D3DMetal 진단 디렉터리/사전 profile 준비가 실패해도 게임 launch를 중단하지
  않고 진단만 `unavailable`로 남긴다.
- native wrapper의 방어 실패는 `std::terminate()` 대신 null 결과로 pass-through
  실패를 나타낸다. 관찰자는 프로세스 종료 권한을 갖지 않는다.
- capture dylib 재빌드 SHA-256은
  `5989efb471e8eaa247304b6b4622398d2b0cf3468048c13ede229cf68cfb89d0`다.

아직 남은 구현은 false 상태인 prepared-ticket predicate를 실제 one-way,
self-draining observer로 대체하는 일이다. 이 작업이 끝나기 전에는 capture
injection을 재활성화하지 않는다. 다음 앱 실행은 도시 진입을 위한 normal
D3DMetal run이며, capture 상태가 실행·종료·게임 결과에 영향을 주어서는 안 된다.
