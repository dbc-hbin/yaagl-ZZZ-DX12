# ZZZ D3DMetal DX12 RT: Pro reasoning packet (2026-08-02)

## Objective

Make Zenless Zone Zero ray tracing render correctly in the real city scene on the YAAGL GPTK 4.0b2 D3DMetal DX12 path. Choose the next major technical direction from the attached current source, runtime evidence, D3DMetal binary, screenshots, and prior architecture notes. Do not treat DX12 capability, DLL loading, HUD `Dispatch Rays`, or an installed interposer as visual RT success.

## Current verified boundary

- The city scene is still visually wrong: the character and HUD render, while the environment is a flat teal/blue silhouette with missing materials and lighting.
- `1785606381178` is the decisive passive-interposition run. The game instance recorded 11 wrapper entries, all from the expected D3DMetal image, with `original_calls=11` and one caller offset: decimal `556745` / `0x87ec9`.
- GOT diagnostics showed one matching D3DMetal slot, original target in `libmetalirconverter.dylib`, successful patch attempt, and wrapper readback. Therefore the interposition/provider/symbol/slot-write path worked.
- That run still used configured offset `0x9a12f`, so it produced no exact matches or DXIL payloads. Current source changes the sole configured offset to the observed `0x87ec9`, but this build has not yet reached a game run.
- `1785607215461` is not a graphics run. It stopped before game launch because the Application Support `resources.neu` still embedded the previous expected dylib hash. The app bundle and `dist/Yaagl/resources.neu` already embed the current hash; `build-app.js` uses `rsync -u`, allowing the runtime support copy to remain stale.
- Current dylib and source contract SHA-256: `a097e6aa7d6f4c0d07f2934f5ad47456f2b1d21a27c4500f06bea12440082e5f`.
- Native passive/GOT tests pass; TypeScript and 45 focused Vitest tests pass. These tests prove the diagnostic contract, not RT correctness.

## Important run interpretation

- `1785598935495`: real city run, flat/invalid scene, FP64 compile failures and no-op PSOs. Its old shared capture manifest and `metalIrDiagnosticPass=true` are not valid payload evidence.
- `1785604878418`: real city run, flat/invalid scene; process isolation improved but authoritative game manifest was lost at shutdown.
- `1785606381178`: real city run, flat/invalid scene; generation checkpoints preserve the game process evidence and prove the actual wrapper caller is `0x87ec9`; no payload because configured offset was stale.
- `1785607215461`: pre-launch hash mismatch only; exclude from RT/DX12 conclusions.

## Known contradictions and missing evidence

- Historical documents contain stale capture hashes and older FP64/no-op-PSO counts. Prefer the attached run files and current source.
- `D3DM_SUPPORT_DXR=1` is used in the actual RT diagnostic runs even where an older plan mentions `0`.
- There is no valid captured DXIL payload yet. The current `0x87ec9` build is intended to obtain it.
- No minidump belongs to the four listed runs.
- Ghidra conclusions are represented by notes and addresses, not a project export. The pristine loaded D3DMetal binary is attached so binary claims can be checked.
- The FP64 compile failures are correlated with the broken scene but are not yet proven to be the root cause of missing RT contribution.

## Decision requested

Reason deeply over the complete attachment and return a concrete, evidence-ordered architecture for reaching correct visual RT, not merely a better diagnostic harness.

1. Decide whether the immediate next experiment should finish the `0x87ec9` passive raw-DXIL capture, pivot to direct Ghidra/binary instrumentation at `IRCompilerAllocCompileAndLink` / `CompileRTFunction` / RT state-object association, or pursue another route.
2. Separate the likely causes of the flat teal city into RTPSO/association failure, FP64 Metal compilation failure, missing non-RT material/lighting passes, and presentation/compositing failure. Specify the cheapest decisive evidence for each branch.
3. State the exact smallest patch sequence, abort conditions, and evidence gates. Functional mutation is allowed only after the failing payload/call path is identified.
4. Identify any flaw in the current `0x87ec9` capture design that could corrupt the game, miss the actual failing payload, or confuse activity with success.
5. If a binary or DXIL transformation is ultimately required, describe the exact transformation proof obligations and rollback/validation loop.

## Constraints

- Real product path and real city-scene screenshots are authoritative.
- Preserve game files and anti-cheat state; only YAAGL/runtime support sidecars may change.
- D3DMetal/GPTK framework remains pristine unless a separately reviewed reversible diagnostic copy is explicitly required.
- Pre-call snapshot only, original function exactly once, no post-call IR object access.
- Every run must preserve artifact identity, process isolation, raw payload hashes, and a failure-qualified aggregate result.
- Do not claim success until city materials/lighting and RT contribution are visibly correct and the run remains stable.

