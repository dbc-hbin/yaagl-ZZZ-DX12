# D3DMetal 4.0b2 CreateFunction null-origin 진단

## 결론

최신 crash `Crash_2026-08-01_091438385`의 최종 Wine 예외는 secondary access
violation이지만, exception context의 `R8`과 stack에 보존된 주소를 loaded
D3DMetal base로 normalize하면 `+0x1234ab`이다. 이 위치는
`CompileNewResolvedExports`에서 첫 `E_INVALIDARG`를 쓰는 store A이며, 유일한
직접 predecessor는 `CreateFunction` 결과가 null일 때의 분기다.

Ghidra가 pristine GPTK 4.0b2의 `D3D12StateObject::CreateFunction`
`[0x123ba0,0x1240e8]`를 분석한 결과 null 결과의 원인은 세 개다.

| 조건 | 원본 분기 | 원본 바이트 | trap RIP |
| --- | ---: | --- | ---: |
| resolved Subobject 포인터 null | `0x123bf0` | `0f 84 d8 00 00 00` | `0x123bf2` |
| `StateObjectBuilder::Function` dynamic_cast null | `0x123c11` | `0f 84 b7 00 00 00` | `0x123c13` |
| `D3DMStageCache::CompileRTFunction` null | `0x123f26` | `0f 84 c1 00 00 00` | `0x123f28` |

각 6바이트 분기는 다음 fail-closed 바이트로 교체한다.

```text
75 04 0f 0b eb fc
```

non-null이면 `JNZ`가 원래 fallthrough `site+6`으로 간다. null이면 `UD2`가
실행되고, 예외 처리기가 RIP를 `site+4`로 진행시켜도 `EB FC`가 같은 UD2로
되돌린다. 따라서 null을 성공 경로로 흘리는 bypass가 없다. Ghidra reference
검사에서 세 덮어쓰기 span의 내부 byte를 향하는 incoming edge는 없었다.

## Artifact 계약

- pristine SHA-256:
  `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`
- raw patched SHA-256:
  `08177292775335e288fc5b05e6aa569d442f84b960a8792842de539032b15599`
- signed patched SHA-256:
  `bf9a75b515d549b43943793e3c00000206dadbd8e086946f3e786a697746023a`
- mode: `noop-fix+create-function-null-traps`
- framework:
  `build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.noop-fix-create-function-null-traps`

기존 no-op PSO fix와 세 trap은 한 번에 pristine에서 생성된다. 이전 store
A/B/C trap과 final-return trap은 포함하지 않는다. framework와 새 앱 모두
deep/strict codesign 검증을 통과했다.

## 한 번의 실행 판정표

| 관측 | 판정 |
| --- | --- |
| matching loaded hash + `D3DMetal+0x123bf2` | resolved Subobject null |
| matching loaded hash + `D3DMetal+0x123c13` | Function dynamic_cast null |
| matching loaded hash + `D3DMetal+0x123f28` | CompileRTFunction null; 내부 이유는 아직 미확정 |
| secondary Wine 예외만 있고 trap provenance 없음 | inconclusive |
| clean run | 해당 실행에서 경로 미관측; null 부재의 증거 아님 |
| 다른 RIP, hash/byte mismatch | invalid run |

한 번 실행해 dump와 log를 수집한 뒤 즉시 다음으로 복구한다.

```sh
scripts/d3dmetal-rtxgi-runtime.sh restore
scripts/d3dmetal-rtxgi-runtime.sh install-noop-fix
```

## 검토와 검증

- private Architect: 설계 `WATCH`; exact byte/SHA guard와 loaded-image 검증 요구.
  완료 후 UI가 본문을 숨겨 최종 pass 증거로는 사용하지 않았다.
- private Critic: 최초 `ITERATE`로 UD2 뒤 NOP의 fail-open 위험을 지적;
  `EB FC` 수정과 manifest 증거 제출 후 최종 `OKAY`.
- patcher Node tests: 20/20.
- `src/wine/d3dmetal.spec.ts`: 6/6.
- TypeScript `--noEmit`, shell syntax, framework/app codesign: 통과.
