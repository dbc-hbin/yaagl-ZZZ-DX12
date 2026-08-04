# ZZZ minimal RT v2 design and adversarial review — 2026-08-04

## Worktree

- Branch: `codex/minimal-rt-v2`
- Path: `.worktrees/minimal-rt-v2`
- Source baseline: the uncommitted minimal-RT implementation was copied from
  `.worktrees/rt`; that worktree was not modified.
- Runtime protocol: `zzz-rt-shim-v2`
- Final shim SHA-256:
  `ae60f06e5ef792dd5646c665e9796f0444ceb9d081039e21b00f450a47c1898f`

## Related documentation

The branch-creation rationale, evidence chronology, v1/v2 correction-scope
comparison, rejected alternatives, implementation map, and runtime acceptance
criteria are documented in:

- `docs/zzz-minimal-rt-v2-branch-rationale-and-evidence-2026-08-04.md`

This document remains the compact implementation and adversarial-review record.

## Decision

Keep the functional shim active for the game process lifetime, but make its
normal play path compile-boundary-only and nearly inert. D3DMetal's persistent
cache remains a performance optimization, never a correctness prerequisite.
The shim contains no frame hook, RT-output observer, source export, worker,
capture protocol, periodic polling, or teardown machinery.

## Runtime architecture

### Loader plane

The dyld callback examines only the image passed to that callback through
`dladdr`. D3DMetal and MetalIR provider bases are published with atomic
compare/exchange; there is no whole-image rescan and no callback mutex. The GOT
slot is changed only after both pinned images are present and the original
provider function matches the expected offset.

### Compile routing

- Non-target `CompileAndLink` caller: return directly to the provider original.
- `0x9a12f` exact lane: read only the IRObject header first. Any source whose
  size is not 26,964 bytes returns directly to the original, avoiding body
  copy, SHA-256, DXC initialization, and decision-cache lookup. The exact
  source SHA uses the pinned replacement and never initializes DXC.
- `0x87ec9` structural lane: copy and hash the bounded source, use the process
  decision cache, and initialize DXC only for a real uncached structural
  candidate.

### Initialization

Exact replacement mapping and DXC initialization use separate one-shot
single-flight gates. A session that only encounters D3DMetal cache hits loads
neither. An exact RT-library replacement does not load DXC.

### Decision cache

A 2,048-entry fixed append-only open-addressing table stores positive and
negative source-digest decisions. Readers are lock-free; transformation remains
single-flight under the transform mutex. Table saturation is a normal cache
miss: transformation still occurs and the current compile still receives the
replacement. Saturation can increase work but cannot silently restore the
broken original shader.

### Scratch memory

The old fixed 64 KiB thread-local aggregate was removed. Each compiler thread
has a grow-only, nothrow scratch allocation sized to the largest source it has
actually observed. Growth does not zero-initialize the buffer before the
bounded `vm_read_overwrite` copy.

### Play I/O

The play profile uses `WINEDEBUG=-all`, creates no D3DMetal Wine log sink, and
does not start runtime diagnostics. The diagnostic profile retains the full
logging/evidence contract.

### Launch validation

The first validation in an app session retains full SHA-256 checks for
D3DMetal, shim, provider, DXC, and replacement, plus strict codesign and x86_64
Mach-O verification. File identities are captured before and after validation
using device, inode, size, nanosecond modification time, and nanosecond change
time. Any change during validation fails the result. A later launch in the same
app session reuses the validation only when paths and all file identities are
byte-identical, reducing the unchanged path to one `stat` subprocess.

## Adversarial review findings fixed

1. **32-entry positive-cache saturation changed correctness.** The previous
   `kPositiveFull` state skipped transformation and could submit a future broken
   shader unchanged. Removed; full tables only lose memoization.
2. **Negative cache was far below the observed workload.** The latest run had
   424 unique source digests. A 32-entry table would leave hundreds uncached and
   permit repeated DXC work. Replaced with one 2,048-entry decision table.
3. **Both caller offsets shared the generic DXC path.** Split the exact RT
   library lane from the structural shared-pipeline lane.
4. **Exact replacement initialized DXC first.** Exact mapping and DXC now have
   independent lazy gates.
5. **The fixed TLS snapshot cleared 64 KiB per compiler thread/call path.**
   Replaced with grow-only, uninitialized, per-thread scratch.
6. **The dyld callback rescanned every loaded image after every addition.**
   Replaced with O(1) supplied-image resolution and a macOS fixture proving that
   `dladdr` maps a registered Mach-O header to its image base.
7. **Callback image publication initially relied on a mutex/loader behavior.**
   Replaced with release/acquire atomic publication, removing callback blocking
   and making provider/D3DMetal visibility explicit.
8. **Runtime-validation memoization initially used second-resolution times.**
   Strengthened to macOS nanosecond `%Fm` and `%Fc` identities.
9. **The changed contract still used the v1 mode name.** Bumped both launcher
   and native contract to `zzz-rt-shim-v2` so mixed artifacts remain inert.
10. **Play still wrote Wine output despite diagnostics being disabled.**
    Removed the play log sink and set Wine debug output to `-all`.

## Residual risks

### Launcher policy — WATCH

Shim validation failure remains fail-open: the launcher logs the error and
continues through direct D3DMetal. This preserves the existing no-launch-block
product constraint, but it means an absent or invalid shim can expose a future
cache miss to the original broken compiler path. This is a policy tradeoff, not
hidden technical protection.

### Exact caller scope — WATCH

For pinned D3DMetal 4.0b2, evidence assigns the known 26,964-byte exact source
to `0x9a12f`, while all observed structural transforms occur at `0x87ec9`.
Therefore non-exact `0x9a12f` inputs bypass generic DXC processing. A future
game build that introduces a new structural defect specifically at that caller
would require a shim update.

### One-shot initialization — WATCH

A transient replacement/DXC initialization failure is not retried in the same
process. Prelaunch validation makes identity failures unlikely, but runtime
resource exhaustion could leave that process on the original path.

### Bounded cache — ACCEPT

More than 2,048 unique decisions do not break correctness, but uncached repeated
misses can perform DXC work again and cause compilation stutter.

### Runtime evidence — REQUIRED

No game process was launched as part of this implementation. Static, unit,
build, artifact, architecture, and signing checks passed, but user-visible
correctness and frame-time equivalence still require one controlled cold-cache
city run and previously unvisited combat traversal.

## Verification completed

```text
pnpm run test:metal-ir
  PASS decision cache collision/lookup/saturation
  PASS dyld supplied-image callback
  PASS UNORM structural proof
  PASS InjectCache ownership proof
  PASS translation single-flight/cache-hit proof

pnpm run typecheck
  PASS

pnpm run test:rt
  PASS 4 files, 77 tests

pnpm run build:clients
  PASS

pnpm run test:rt-artifacts
  PASS ae60f06e5ef792dd5646c665e9796f0444ceb9d081039e21b00f450a47c1898f

codesign --verify --deep --strict "Yaagl ZZZ DX12.app"
  PASS

codesign --verify --strict sidecar/runtime/libyaagl-zzz-rt-shim.dylib
  PASS

file sidecar/runtime/libyaagl-zzz-rt-shim.dylib
  Mach-O 64-bit dynamically linked shared library x86_64

git diff --check
  PASS
```

## Runtime acceptance gate

The branch is ready for a controlled runtime trial, not for an unqualified
release. Accept only after the pinned app and runtime identities are confirmed
and one manual run demonstrates:

1. cold or isolated D3DMetal shader cache reaches the city without black,
   yellow, white, or overexposed world output;
2. a combat area not used during prior repair work renders correctly;
3. no FP64 error-19, no no-op PSO, and no RTPSO/state-object regression in a
   separate diagnostic comparison run;
4. warm-cache frame time and traversal stutter are not measurably worse than
   clean main under the same route and settings;
5. no shim or DXC work occurs on ordinary steady-state frames.
