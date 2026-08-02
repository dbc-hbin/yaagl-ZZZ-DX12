# D3DMetal 4.0b2 IR-link null / CompileRT fallback 진단

## 최신 crash 결론

- Run: `1785577222984`
- Crash: `Crash_2026-08-01_094105817`
- Exception: `EXCEPTION_ILLEGAL_INSTRUCTION`, thread `0x200`
- Address: `0x218edff28`
- Active signed hash:
  `bf9a75b515d549b43943793e3c00000206dadbd8e086946f3e786a697746023a`
- `0x218edff28 - 0x123f28 = 0x218dbc000`

Wine log와 minidump ExceptionStream이 같은 illegal-instruction 주소를 직접
보존했다. 설치된 바이트도 `0x123f26 = 75 04 0f 0b eb fc`였으므로 이번 실행은
`D3DMStageCache::CompileRTFunction`의 null 반환을 확정한다. dump의 일반 thread
context RIP가 ntdll인 것은 crash handler 진입 뒤 secondary context다.

## Ghidra 결과

`CompileRTFunction(0x996d8)`은 fresh lambda `0x99ec4` 또는 cache-hit
`ValueWrapper::getValue(0x9a286)`의 값을 반환한다. Fresh lambda의 유일한 정상
null 생산자는 다음이다.

```text
0x9a12a call IRCompilerAllocCompileAndLink
0x9a12f test rax,rax
0x9a132 jz 0x9a23b
0x9a23b cleanup
0x9a24b xor ebx,ebx
0x9a24d return null
```

cache-hit 경로는 wrapper `+0x78` 값을 그대로 반환하므로 이전 null을 전파할 수
있다.

## 새 artifact

- Mode: `noop-fix+ir-link-null-with-compile-rt-fallback`
- Pristine SHA:
  `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`
- Raw SHA:
  `12e278f9bc3004529603a3efba0c1f670aa97bbfbd007c14189a8288884d251b`
- Signed SHA:
  `db27ff847589670c701937392a63c0f9411b3411c77df224d6d066bae44deecb`

Pristine에서 기존 no-op PSO fix와 다음 두 분기만 한 번에 패치한다.

| 역할 | RVA | 원본 | 진단 | trap |
| --- | ---: | --- | --- | ---: |
| fresh link null | `0x9a132` | `0f 84 03 01 00 00` | `75 04 0f 0b eb fc` | `0x9a134` |
| outer fallback | `0x123f26` | `0f 84 c1 00 00 00` | `75 04 0f 0b eb fc` | `0x123f28` |

두 span 내부로 향하는 incoming edge는 없다. 이전 association, dynamic-cast,
status-store trap은 포함하지 않는다.

## 다음 실행 판정

- matching hash + `D3DMetal+0x9a134`: fresh
  `IRCompilerAllocCompileAndLink`가 null 반환.
- matching hash + `D3DMetal+0x123f28`: fresh-link null branch가 관측되지 않은
  `CompileRTFunction` null. `cached/unmodelled propagation`으로만 기록한다.
- clean 또는 secondary-only: inconclusive.
- hash/RIP mismatch: invalid.

한 번 실행한 뒤 dump를 보존하고 즉시 no-op-only로 복구한다.

## 검토·검증

- Architect: `CLEAR`.
- Critic: exact no-op recipe/raw hash/signing 절차 보완 후 `OKAY`.
- patcher: 22/22.
- app hash-pair tests: 6/6.
- TypeScript, shell syntax, framework/app codesign: 통과.
