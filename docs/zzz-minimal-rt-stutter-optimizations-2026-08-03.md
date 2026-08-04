# ZZZ minimal RT stutter work - 2026-08-03

## Scope

This change is intended to reduce avoidable CPU contention and diagnostic
activity in the minimal RT build without changing the verified shader
translations, D3DMetal caller boundaries, RT flags, GPU spoof, or rendered
output.

Runtime frame-time improvement has not yet been measured. The implementation
and static behavior are verified; a repeatable cold city run is still required
to quantify the user-visible effect.

## Native translation synchronization

### Previous behavior

The original minimal shim held one busy-spin cache lock while it performed the
entire DXC path:

1. cache lookup;
2. DXIL disassembly;
3. structural Metal-IR transformation;
4. DXIL assembly;
5. provider IR object creation;
6. cache insertion.

Every concurrent compiler thread spun until the transformation completed. The
first DXC initialization also had an attempted-before-lock race: a concurrent
first-use caller could observe initialization in progress as a permanent
failure and submit its original FP64 shader.

### Current behavior

The shim now uses three bounded synchronization responsibilities:

- `RuntimeInitializationGate` performs one sleeping, single-flight runtime
  initialization. Concurrent first-use callers wait for the same result.
- `g_cacheMutex` protects only short positive and negative cache operations.
- `g_transformMutex` serializes DXC use because the process-global DXC COM
  objects are not assumed to be thread-safe.

A structural cache miss now follows this sequence:

1. short cache lookup without the transform mutex;
2. immediate return for positive, negative, or full-cache results;
3. sleeping wait for the transform mutex;
4. second cache lookup after acquiring the mutex;
5. one DXC transformation if the result is still a miss;
6. short cache insertion.

This allows an unrelated cache hit to complete while a miss is being
translated and prevents duplicate transformation after a waiting thread wakes.
Initialization and translation exceptions fail closed inside the shim. The
outer CompileAndLink wrapper then invokes the original D3DMetal function with
the original object; exceptions from the original function are not swallowed.

## Minimal play profile

The minimal build uses one `D3DMetalRuntimeProfile` source of truth. The default
profile is `play`:

- RT shim validation and injection remain enabled;
- Player.log, unified log, module snapshot, launch-profile, and runtime-evidence
  collection are disabled;
- periodic `ps` and `lsof` polling is not started;
- `WINEDEBUG` is `fixme-all,err-unwind`;
- the settings UI does not poll or display historical evidence as if it came
  from the current run.

DXR, Metal 4, and MetalFX are therefore shown as configured with runtime
diagnostics disabled, rather than reusing a stale `d3dmetal_*_evidence.json`
file from an earlier diagnostic build.

The profile also defines the diagnostic contract (`+timestamp,+loaddll` and
runtime verification enabled), so logging and evidence collection cannot drift
into separate modes. The full diagnostic implementation remains on `dev`.

## Preserved renderer contract

This change does not:

- alter UNORM24, signed UNORM16-times-two, or InjectCache translation;
- remove the city/shared CompileAndLink caller or the RT-function caller;
- change source hashes, transform predicates, or fail-closed graph ownership;
- add asynchronous shader compilation;
- introduce a persistent disk shader cache;
- modify game files or the user-supplied GPTK runtime.

## Behavioral tests

`translation-synchronization-proof` uses the same header as the production
shim and verifies:

- two simultaneous initializers execute the initializer exactly once;
- the second initializer waits and receives the successful result;
- failed or throwing initialization fails closed and is not retried;
- two simultaneous misses transform once;
- an unrelated cache hit completes while another transformation is blocked.

The runtime-profile tests verify:

- minimal play diagnostics are disabled;
- minimal D3DMetal logging is reduced;
- stale evidence is not represented as current verification;
- the full diagnostic profile still maps to verbose logging and verification.

## Verification

Executed from `.worktrees/rt`:

```text
pnpm run test:metal-ir
  PASS: UNORM structural proof
  PASS: InjectCache ownership proof
  PASS: translation synchronization proof

pnpm run typecheck
  PASS

pnpm run test:rt
  PASS: 3 files, 74 tests

npm run build:clients
  PASS: Yaagl ZZZ DX12.app rebuilt

pnpm run test:rt-artifacts
  PASS: source and application bundle contain the pinned shim
  SHA-256: 2b6863475ad8af11f62bd3b64681d7e4aa23c606d8009ff9a6d80b8dbe23b0bf
```

## Remaining runtime verification

Use the full `dev` diagnostic build for the next controlled cold city run. The
minimal build cannot prove frame-time improvement because it intentionally does
not collect the necessary runtime observations. The release decision should
compare the same route and settings before and after this change and confirm
that visual output, FP64 error count, and no-op PSO count do not regress.
