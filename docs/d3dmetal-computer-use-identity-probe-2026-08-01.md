# D3DMetal 태그 실행용 Computer Use 앱 정체성 프로브

검증일: 2026-08-01 (Asia/Seoul)

## 결론

현재 macOS 27.0 환경에서 외부 Wine executable로 `execve`한 프로세스는
PID가 유지돼도 원래 앱 bundle identity를 유지하지 않는다. 따라서 작은
AppKit host를 `.app` 안에 두고 같은 PID에서 Wine으로 교체하는 설계는 실제
Wine 게임 창을 지원되는 Computer Use 대상으로 만들 수 없다.

이 결과로 다음 product-path 변형은 폐기한다.

- AppKit host가 외부 Wine loader로 `execve`하는 임시 `.app`
- 외부 Wine loader를 가리키는 `CFBundleExecutable` symlink
- bundle wrapper가 Wine child를 spawn하는 구조
- `open -n -W` 또는 `NSWorkspace`로 기존 direct-child 실행을 대체하는 구조
- Wine tree를 앱 bundle 안으로 복사하거나 재배치하는 구조

현재 직접 Wine 실행, stdout/stderr 로그, 실제 exit status, evidence `finally`,
`wineserver -w`, 가역 framework transaction은 그대로 유지한다.

## 프로브 설계

프로브 산출물:

```text
build/computer-use-app-host-probe/
  SamePIDProbe.app/Contents/MacOS/SamePIDProbe
  external/ExternalPayload
  src/host.m
  src/payload.m
```

두 실행 파일은 모두 `x86_64` Mach-O이고 ad-hoc signing과 strict codesign
검증을 통과했다. Host는 LaunchServices의 `open`이나 `NSWorkspace`를 쓰지
않고 셸에서 직접 자식으로 실행했다.

실행 순서:

```text
direct child SamePIDProbe
  -> NSApplication 초기화
  -> bundle 안 host 창 표시
  -> SIGUSR1
  -> 같은 PID에서 bundle 밖 ExternalPayload로 execve
  -> payload가 새 AppKit 창 표시
```

## 관측 결과

### exec 전

```text
pid:       53569
ASN:       0x0-0x13f13f
bundle ID: com.3shain.yaagl.probe.samepid
window:    Same PID Host Before Exec
```

- Host 내부 `NSBundle.mainBundle.bundleIdentifier`가 예상 bundle ID를 반환했다.
- `lsappinfo`가 같은 bundle ID를 가진 foreground app으로 등록했다.
- Computer Use `list_apps()`가 정확한 bundle ID를 반환했다.
- Computer Use `get_app_state()`가 host 창과 접근성 트리를 읽었다.
- 대화에 첨부된 `Same PID Host Before Exec` 화면은 이 단계의 시각 증거다.

### 외부 payload로 exec 후

```text
pid:       53569 (유지)
code type: X86-64 (translated)
ASN:       0x0-0x141141 (교체)
name:      ExternalPayload
bundle ID: NULL
```

- Payload 내부 `NSBundle.mainBundle.bundleIdentifier`는 `<none>`이었다.
- `lsappinfo`는 기존 ASN을 유지하지 않고 새 ASN과 `bundleID NULL`로
  재등록했다.
- Computer Use가 원래 bundle ID로 새 payload 창을 읽으려 하자 timeout됐다.
- 프로브는 `TERM`으로 정상 종료했고 잔여 프로세스가 없음을 확인했다.

즉 PID 연속성은 Computer Use app identity 연속성을 보장하지 않는다.

## Pro Architect 검토

대화:
<https://chatgpt.com/g/g-6a6c2c25638c819193c521156319a9e9-codex-architect/c/6a6ceb82-4a2c-83ee-bdb5-a2337e86074e>

초기 검토는 direct-spawned same-PID host를 유일한 조건부 후보로 두되,
bundle identity가 실제 Wine 창까지 유지돼야 한다는 hard gate를 요구했다.
위 프로브 결과를 전달한 뒤 최종 판정은 `BLOCK`이었다.

현재 제약 아래에는 다음 세 조건을 동시에 만족하는 설계가 없다.

1. 실제 Wine process의 direct-child supervision과 exit/log 계약 유지
2. 실제 게임 window owner가 stable bundle ID 보유
3. 지원되는 Computer Use selector만 사용

## 재개 조건

다음 중 하나가 바뀔 때만 이 설계를 다시 연다.

- Computer Use가 PID 또는 window-level targeting을 공식 지원
- Wine이 실제 게임 window owner에 stable macOS bundle identity를 제공
- LaunchServices 기반의 다른 supervision contract가 허용됨
- Wine runtime의 공식/지원되는 app packaging이 허용됨

그 전에는 wrapper/bundle 변형을 더 반복하지 않는다. Raw
`0x8004d001`~`0x8004d004`가 없으므로 D3DMetal 호환성 완화 패치도 계속
보류한다.
