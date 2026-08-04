# ZZZ minimal RT v2 branch rationale and evidence — 2026-08-04

## Executive summary

`codex/minimal-rt-v2` exists to make the already-proven minimal RT correction
safe and cheap enough to remain resident for an entire normal gameplay session.
It is not a new renderer experiment and it does not intentionally broaden the
shader correction set relative to minimal RT v1.

The branch was created because the evidence leaves two requirements that cannot
both be met by either clean main or minimal RT v1:

1. a clean launch with a warm D3DMetal/Metal cache can render correctly, but it
   cannot guarantee that a future shader cache miss will not reintroduce the
   overexposed or missing-world failure;
2. keeping the functional shim resident covers future misses, but the original
   minimal implementation still performed avoidable work and had a bounded-cache
   saturation behavior that could silently stop correcting a later shader.

Minimal RT v2 therefore preserves the same verified transformations while
reducing the normal path to caller classification and an original-function
call, splitting exact and structural correction lanes, removing diagnostic and
log I/O, and making cache capacity affect performance only—not correctness.

## Branch identity and isolation

- Branch: `codex/minimal-rt-v2`
- Worktree: `.worktrees/minimal-rt-v2`
- Runtime protocol: `zzz-rt-shim-v2`
- Final shim SHA-256:
  `ae60f06e5ef792dd5646c665e9796f0444ceb9d081039e21b00f450a47c1898f`
- Baseline: the uncommitted minimal RT implementation in `.worktrees/rt`
- Isolation rule: `.worktrees/rt` was copied as the functional baseline and was
  not modified, so v1 remains available as a direct behavioral comparison.

A separate branch was necessary to keep three distinct references:

| Reference | Purpose |
| --- | --- |
| `main` | Clean, no-shim comparison path and cache-behavior discriminator |
| minimal RT v1 (`.worktrees/rt`) | Proven functional correction baseline |
| minimal RT v2 | Same correction semantics with lower overhead and corrected cache behavior |

This separation prevents a performance rewrite from erasing the last known
functional implementation and allows byte/code-path comparisons between v1 and
v2 without reconstructing an older working state.

## Product problem that forced the branch

The user-visible failure was not merely a launch failure. ZZZ could enter the
city with DX12, Metal 4, DXR capability and RT activity while the world was
black, yellow, flat, or overexposed. UI and character rendering surviving did
not constitute RT correctness.

The desired production property is stronger than “the current cache works”:

> A new shader compilation encountered later in the city, in previously unseen
> combat, or after a game/runtime update must still pass through the verified
> correction path without making every frame pay diagnostic or translation cost.

That property requires a functional compile-boundary shim to remain available
for the process lifetime. A one-time cache seeder or clean-main-only release
cannot provide it under the current evidence.

## Evidence chain

### 1. D3DMetal capability and state-object success were not enough

Prior runs reached DX12 level 12.1, reported `supportsRayTracing=1`, and showed
DispatchRays/BVH activity while the world output was still wrong. Earlier
handoffs also record large RTPSO/state-object failure populations before the
producer-side no-op fix. The no-op fix stopped one crash/failure class but did
not by itself establish visually correct RT.

Relevant repository evidence:

- `docs/zzz-dx12-d3dmetal-rtxgi-handoff-2026-08-01.md`
- `docs/d3dmetal-4.0b2-separated-noop-and-rt-boundary-2026-08-01.md`
- `docs/zzz-dx12-rt-current-handoff-2026-08-01.md`

Conclusion: renderer selection, advertised DXR support, successful state-object
creation, and RT dispatch counters are necessary evidence but not sufficient
visual correctness evidence.

### 2. Structural shader correction caused a material rendering breakthrough

Run `1785668553122` executed `metal-ir-unorm-fix-v2` and observed 18 compiler
inputs:

- 11 successful `structural_unorm24` transformations;
- 3 unhandled FP64 inputs;
- 4 no-match inputs.

Compared with the preceding run, the city changed from mostly black/yellow to
rendered world geometry and materials. FP64 error-19 failures fell from 12 to 3,
and the recorded no-op PSOs fell to zero. The frame remained overbright, so this
run was a functional breakthrough rather than final correctness.

Source: `docs/zzz-dxr-v2-run-1785668553122.md`.

Conclusion: the structural transformation repaired real shared world/material
passes. This was not a fake HRESULT success or a renderer-selection artifact.

### 3. The final diagnostic success required only two new structural corrections

Run `1785772242093` pinned:

- D3DMetal 4.0b2/no-op-fix identity;
- valid GPTK DXC and MetalIR provider identities;
- combined functional/RT-observer mode;
- DX12, Metal 4 and DXR launch flags.

Its evidence records zero RTPSO failures, zero RTXGI invalid-state-object
failures, zero CreateStateObject failures, zero Metal compilation failures and
zero unhandled FP64 events. The profile exited successfully, although the
separate diagnostic lifecycle manifest was incomplete and therefore must not be
used as a terminal-protocol success claim.

The compiler log contains 477 observations. Only two sources were newly selected
for structural UNORM correction in that run:

- `6465cc633571a21ecdbbbbbb8919b529804308c1373f0cbc5fbbfb53dbc3120a`,
  20,616 -> 23,616 bytes, five graphs, caller `0x87ec9`;
- `7ec91d750cd49b8e0980d42f9e7832970f089191610869f6fc0d3302d61d80a4`,
  18,888 -> 21,852 bytes, five graphs, caller `0x87ec9`.

Sources:

- `naposdx12/logs/d3dmetal_1785772242093_profile.json`
- `naposdx12/logs/d3dmetal_1785772242093_evidence.json`
- `naposdx12/logs/d3dmetal_1785772242093_metal_ir_probe.log`

Conclusion: correct output does not require rewriting every RT shader. A small
number of shared compile products can unblock global lighting/material/RT
composition, while hundreds of other inputs correctly remain original.

### 4. Clean main success proved persistent reuse, not shim dispensability

Run `1785773575569` launched with the clean D3DMetal environment and RTX 5060
spoof, but no `YAAGL_RUNTIME_MODE`, no inserted shim and no MetalIR replacement
or DXC environment. It exited successfully. Manual observation reported correct
city output and later correct output in combat that had not been entered during
the weekend work. The HUD showed real RT workload counters.

Machine-verifiable source:

- `naposdx12/logs/d3dmetal_1785773575569_profile.json`

Manual-only observations:

- visually correct city under clean main;
- visually correct previously unvisited combat;
- Dispatch Rays/Ray Query/BVH HUD activity.

These observations are intentionally labeled manual because the clean profile
contains no diagnostic capture that can prove which persistent cache object was
hit.

Conclusion: the likely model is reuse of a small shared pipeline/library set or
another persistent compiled layer, not per-scene precompilation of every RT
shader. It does **not** prove that all future cache misses are safe without the
shim.

### 5. The observed workload invalidated the v1 cache sizing assumption

The final diagnostic run contained 424 unique source digests: 422 that remained
original and two that were transformed. Minimal RT v1 kept separate 32-entry
positive and negative arrays.

For the known run, the number of positive transformations remained below 32, so
v1 and v2 correct the same observed shaders. However:

- most no-match decisions could not remain memoized in a 32-entry negative
  cache, permitting repeated DXC disassembly/analysis;
- when the v1 positive table reached 32 entries, `kPositiveFull` caused a new
  source to skip transformation and flow to original D3DMetal.

The second behavior made capacity a correctness boundary. It was unacceptable
for long sessions or future content even though it had not yet been triggered
by the known 11-transform maximum run.

Conclusion: v2 did not need a broader transform predicate; it needed a decision
cache whose saturation could never disable correction.

## What v1 and v2 correct

### Same correction semantics

Both versions implement the same functional correction set:

1. one exact 26,964-byte source
   `02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869`
   is replaced by the pinned 17,720-byte DXIL object;
2. the known InjectCache source
   `843be9c95dd09b3e4da739d67b91257495fb746da91b57eb52f859e682dd55ff`
   uses the exact InjectCache transform;
3. other sources are transformed only when `transformUnorm24Only` proves the
   bounded structural UNORM24 graph predicate;
4. no-match and unhandled-FP64 sources remain original;
5. provider compile errors are not masked.

Therefore the expected correction count for the same input sequence is the same
between v1 and v2. In known evidence:

- early functional v2 diagnostic run: 11 transformed inputs;
- final successful diagnostic run: two transformed unique inputs;
- exact special sources known in code: two fixed SHA-specific cases, plus an
  open-ended structural predicate for future matching inputs.

The 2,048-entry v2 decision table is not a target shader count. It stores both
positive and negative decisions.

### Deliberate routing difference

V1 sent both verified caller offsets through the same snapshot, SHA, runtime
initialization and generic selection path.

V2 assigns evidence-specific roles:

```text
non-target caller
  -> original CompileAndLink immediately

caller 0x9a12f (exact lane)
  -> read IRObject header
  -> size != 26,964: original immediately
  -> size == 26,964: snapshot + SHA
  -> exact SHA: lazy exact replacement
  -> otherwise original

caller 0x87ec9 (structural lane)
  -> snapshot + SHA
  -> decision-cache lookup
  -> negative: original
  -> positive: cached transformed IR object
  -> miss: lazy DXC initialization + bounded transform
```

All observed structural transforms in the decisive runs came from `0x87ec9`.
The known exact RT-library replacement belongs to `0x9a12f`. This split removes
work without changing the known correction result.

## Rejected architectures

### Clean-main-only production

Rejected because a warm cache proves only the current cache state. It provides
no correction path for a later miss and can silently return to overexposed or
missing-world output.

### One-time “seed all RT shaders” bootstrap

Rejected because a short city entry cannot prove all current or future game
content has been compiled. The evidence instead supports a small shared-pipeline
model, and later content can still introduce a new source.

### Always-on diagnostic shim

Rejected because source export, RT observers, module polling, verbose logging,
large manifests and lifecycle machinery are unnecessary for normal gameplay.
They would add I/O, synchronization and failure surfaces unrelated to the
functional correction.

### Runtime self-unhook after city entry

Rejected because later shaders can appear after the city, D3DMetal may retain
transformed IR objects and cache-flush timing is not proven. The safe lifecycle
is to keep the small functional wrapper and transformed object storage resident
until process exit.

### Broaden all FP64 to float

Rejected because the successful transform is structural and bounded. Broad
numeric rewriting would change shader semantics and contradict the evidence-first
constraint.

## Design goals

1. Preserve byte/function-level correction behavior from v1.
2. Keep a correction path available for every later CompileAndLink miss.
3. Make ordinary steady-state frames execute no shim work.
4. Make non-target compile calls return to D3DMetal immediately.
5. Avoid DXC initialization until a genuine structural miss.
6. Ensure cache capacity can increase work but can never disable correction.
7. Keep the production artifact free of diagnostic capture and export machinery.
8. Validate exact runtime identities without repeating all expensive checks on
   every launch in the same app process.
9. Preserve a clean main comparison path and a v1 functional baseline.

## Non-goals

- No change to game files, anti-cheat files or original game assets.
- No GPTK cache editing or prebuilt cache distribution.
- No asynchronous shader compilation.
- No fake HRESULT/state-object success.
- No renderer-selection or GPU-spoof change as part of v2.
- No new structural transform predicate.
- No promise that unknown future D3DMetal or game builds are automatically
  compatible with pinned offsets and identities.

## Implemented architecture

### Loader plane

The dylib remains inert unless `YAAGL_RUNTIME_MODE=zzz-rt-shim-v2`. The dyld
callback examines only the supplied Mach-O image with `dladdr`; it does not
rescan all loaded images. D3DMetal and provider bases are published atomically.
When both are available, the shim verifies and swaps the pinned GOT slot.

This limits helper-process cost to one `dladdr`, path comparisons and atomic
loads per image addition until installation. Processes without D3DMetal never
initialize DXC or the replacement.

### Compile fast paths

The wrapper first calculates the D3DMetal caller offset. Non-target calls invoke
the original provider function immediately. The exact RT caller checks source
size before body copying or hashing. The structural caller performs bounded
snapshot and digest work because the source content determines whether a
transformation is required.

### Split initialization

Two independent single-flight gates exist:

- exact replacement mapping/object creation;
- DXC runtime initialization.

An exact replacement no longer pays DXC startup. A session served entirely by
D3DMetal's persistent cache initializes neither gate.

### Decision cache

The v2 process cache is a fixed 2,048-entry open-addressing table containing
full source SHA-256 values and either positive transformed-object pointers or
negative no-transform decisions.

- lookup is lock-free;
- entries are append-only and release/acquire published;
- transformation remains serialized because process-global DXC COM objects are
  not assumed thread-safe;
- a waiting transform caller rechecks the cache to prevent duplicate work;
- full table means “not memoized,” never “do not transform.”

### Object and memory lifetime

Source snapshots use per-thread grow-only scratch sized to the largest observed
source rather than a fixed 64 KiB aggregate reset. Transformed output mappings
and borrowed provider IR objects are retained until process teardown because
D3DMetal may retain them beyond the immediate wrapper call.

### Normal play profile

The play profile:

- keeps functional shim validation and injection;
- uses `WINEDEBUG=-all`;
- creates no Wine log sink for D3DMetal play;
- disables Player.log/system/module/runtime-evidence collection;
- starts no periodic `ps` or `lsof` polling.

The diagnostic profile remains available separately for controlled evidence
runs.

### Launch validation cache

The first launch in an app process still validates SHA-256 for D3DMetal, shim,
provider, DXC and replacement, then verifies shim codesign and x86_64 Mach-O
identity. The file set is fingerprinted before and after validation using path,
device, inode, size and nanosecond mtime/ctime. A changed identity fails the
validation. Subsequent launches reuse the result only for an identical
fingerprint, reducing the unchanged path to one `stat` process.

## Implementation map

| File | Responsibility |
| --- | --- |
| `native/zzz-rt-shim/zzz-rt-shim.cpp` | v2 mode, loader publication, caller routing, lazy initialization, transformation and object lifetime |
| `native/zzz-rt-shim/decision-cache.hpp` | lock-free append-only positive/negative decision table |
| `native/zzz-rt-shim/tests/decision-cache-proof.cpp` | collision, positive/negative lookup and saturation semantics |
| `native/zzz-rt-shim/tests/image-callback-proof.cpp` | macOS dyld callback/header-to-image resolution proof |
| `native/metal-ir-capture/translation-synchronization.hpp` | reusable single-flight initialization/transform synchronization contract |
| `native/metal-ir-capture/tests/translation-synchronization-proof.cpp` | concurrent initializer, miss and unrelated-hit behavior |
| `scripts/build-zzz-rt-shim.sh` | production flags, dead-strip, forbidden diagnostic strings and native proofs |
| `src/wine/d3dmetal.ts` | v2 protocol/SHA pin, environment contract and runtime validation |
| `src/wine/d3dmetal-validation-cache.ts` | nanosecond file-identity validation memoization |
| `src/wine/d3dmetal-runtime-profile.ts` | play versus diagnostic logging/evidence policy |
| `src/clients/mhy/nap/program-launch-game.ts` | validation, injection and no-log play launch |
| `src/wine/*.spec.ts` | protocol, profile, environment and validation-cache tests |

## Correctness and failure semantics

### Preserved pass-through behavior

- non-target calls invoke original D3DMetal without inspection;
- invalid/unreadable IRObject input invokes original D3DMetal;
- no-match and unhandled-FP64 inputs invoke original D3DMetal;
- transformation or assembly failure invokes original D3DMetal;
- original provider exceptions are not swallowed by the shim.

### Intentional fail-open boundaries

Two boundaries remain fail-open:

1. launcher validation failure logs the error and launches without the shim;
2. one-shot native replacement/DXC initialization failure causes the current
   process to use original D3DMetal and is not retried.

These preserve the existing no-launch-block policy, but they are not equivalent
to guaranteed RT correctness. They remain explicit WATCH items.

### Capacity semantics

Decision-cache saturation does not use original output as a shortcut. A new
matching source is still transformed and used for the current compile. Only the
ability to reuse that result later is lost.

## Expected overhead model

| Situation | v2 work |
| --- | --- |
| Ordinary frame | No wrapper execution, no hash, no cache lookup, no DXC |
| Non-target CompileAndLink | Caller offset checks, original function call |
| `0x9a12f`, non-26,964-byte input | Header read and size check, original call |
| `0x9a12f`, exact source | Snapshot, SHA, lazy replacement creation once |
| `0x87ec9`, known negative | Snapshot, SHA, lock-free decision hit, original call |
| `0x87ec9`, known positive | Snapshot, SHA, lock-free decision hit, transformed object |
| `0x87ec9`, new matching source | Snapshot, SHA, serialized DXC transform once |
| Warm app relaunch with unchanged artifacts | One multi-file `stat`, cached validation result |

The branch does not claim zero startup or shader-miss cost. It minimizes
continuous gameplay cost while preserving miss correction.

## Verification performed

The following passed in `.worktrees/minimal-rt-v2`:

```text
pnpm run test:metal-ir
  PASS decision-cache collision/lookup/saturation
  PASS dyld supplied-image callback
  PASS UNORM structural proof
  PASS InjectCache ownership proof
  PASS initialization/translation single-flight

pnpm run typecheck
  PASS

pnpm run test:rt
  PASS 4 files, 77 tests

pnpm run build:clients
  PASS

pnpm run test:rt-artifacts
  PASS ae60f06e5ef792dd5646c665e9796f0444ceb9d081039e21b00f450a47c1898f

codesign --verify --strict sidecar/runtime/libyaagl-zzz-rt-shim.dylib
  PASS

codesign --verify --deep --strict "Yaagl ZZZ DX12.app"
  PASS

git diff --check
  PASS
```

These checks prove build, pinning, synchronization contracts, cache saturation
semantics, loader callback assumptions and artifact identity. They do not prove
actual game output or frame-time equivalence.

## Remaining runtime acceptance

The branch remains WATCH until a controlled runtime comparison confirms:

1. an isolated/cold D3DMetal shader-cache run reaches the city with correct
   world output;
2. previously unvisited combat remains correct;
3. a diagnostic comparison reports no FP64 error-19, no no-op PSO and no
   RTPSO/CreateStateObject regression;
4. warm-cache frame time and traversal stutter are within measurement noise of
   clean main under the same route and settings;
5. no structural transform or DXC work appears during ordinary steady-state
   frames;
6. the exact `0x9a12f` lane and structural `0x87ec9` lane both activate when
   deliberately exercised under the pinned runtime.

## Final branch statement

`codex/minimal-rt-v2` is not intended to correct more known shaders than v1.
Its purpose is to preserve the same verified correction capability for future
cache misses while removing avoidable loader, compile, logging and validation
overhead and eliminating the v1 cache-capacity correctness failure. Clean main
remains the no-shim reference; v1 remains the functional baseline; v2 is the
production-oriented candidate pending controlled runtime validation.
