# D3DMetal 4.0b2 inheritance-result diagnostic

## Decision

The parser-phase run trapped at the final `CreateStateObject` failure edge with
`EAX=0x80070057`; its parser-result trap did not fire. The parser therefore
passed. The previously tested direct store at export failure target `0x121798`
also did not fire, so repeating the export predicate experiment would not add
new information.

The next unresolved boundary is the status check immediately after
`InheritPipelineConfigAndShaderConfigFromExports`.

## Binary design

The pristine code is:

```asm
0x121723  call InheritPipelineConfigAndShaderConfigFromExports
0x121728  cmp  dword ptr [r15], 0
0x12172c  jne  0x12179f
0x12172e  mov  rax, [rbp]
```

The comparison and short branch occupy exactly six bytes:
`41 83 3f 00 75 71`. They are replaced with
`e9 6e df 24 00 90`, an unconditional jump to `0x36f69b` plus one NOP.

The 13-byte cave thunk is:

```text
41 83 3f 00 74 02 0f 0b e9 86 20 db ff
```

It reproduces the original comparison. Zero resumes at `0x12172e`; nonzero
executes `UD2` at `D3DMetal+0x36f6a1`. The final failure-only return trap remains
at `D3DMetal+0x36f8a2`.

## Outcome map

- `D3DMetal+0x36f6a1`: inheritance published a nonzero status. Instrument the
  inheritance routine's per-export decisions next.
- `D3DMetal+0x36f8a2` with `EAX=0x80070057` and the expected wrapper stack:
  inheritance passed; the remaining producer is `CompileNewResolvedExports` or
  a later base-constructor exit before `CreatePipelines`.
- Any other RIP or attribution mismatch: inconclusive, including a competing
  no-op graphics PSO crash.

The diagnostic is mutually exclusive with the no-op PSO fix because the final
return trap occupies the same `0x36f89a` cave. Restore the no-op fix immediately
after the first captured run.

## Artifacts

- Pristine SHA-256: `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`
- Raw SHA-256: `d493673906c4414712d7774621184ca7e7257ca9d6d2431f4a85d75c42e1b43b`
- Signed SHA-256: `699547e5c3f2f503705e6bc5809a2d21dbd2fc3d53461c07b4c8e9249bb695a3`
- Runtime command: `scripts/d3dmetal-rtxgi-runtime.sh install-inheritance-trap`

## Verification and installation

- Patcher tests: 16/16 passed.
- D3DMetal Vitest suite: 6/6 passed.
- TypeScript and runtime shell syntax: passed.
- Artifact and installed framework deep/strict codesign: passed.
- `Yaagl ZZZ DX12.app` rebuilt at 2026-08-01 17:43:06 +0900 and verified.
- Active runtime: `state-object-inheritance-result-trap`.
- Pristine backup and GPTK cache: pristine.
- D3DMetal was not loaded by any process at installation time.
