# D3DMetal 4.0b2 next RT parser-phase diagnostic design

## Objective

Narrow the native RT `CreateStateObject` rejection from the current
pre-`CreatePipelines` region to one of two regions in one controlled game run:

1. `ParseStateObjectInto` publishes a nonzero status, or
2. parsing passes and a later export, inheritance, resolved-export compilation,
   or base-constructor exit publishes the failure.

This is a diagnostic only. It must not suppress `E_INVALIDARG`, fabricate a
state object, or be represented as an RT compatibility fix.

## Evidence boundary

- The real failure-only return-trap run stopped at
  `D3DMetal+0x36f8a2` with `EAX=0x80070057` and a null output slot.
- State-object type 3 dispatches to the raytracing state-object constructor.
- The raytracing constructor calls `CreatePipelines` only after the base
  constructor returns with status zero. The observed `E_INVALIDARG` is therefore
  established before `CreatePipelines`.
- The first status observation after `ParseStateObjectInto` is the `jne` at
  `0x12170a`.
- Earlier traps at the individual stores `0x0ae4ab`, `0x121798`, `0x12275f`,
  and `0x122813` did not fire. This excludes those exact stores, not their whole
  phases.
- Pristine D3DMetal SHA-256:
  `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`.

## Patch design

Build a new artifact from pristine. Do not modify the currently installed
no-op-fix artifact.

### Parser-result taken-branch trap

Retarget only the taken branch. The success fallthrough remains unchanged.

| Span | Pristine bytes | Diagnostic bytes |
| --- | --- | --- |
| `0x12170a`, 6 bytes | `0f 85 8f 00 00 00` | `0f 85 8b df 24 00` |
| `0x36f69b`, 2 bytes | `90 00` | `0f 0b` |

The branch displacement is `0x36f69b - 0x121710 = 0x24df8b`.
Only the two `UD2` bytes are written in the cave; the remaining padding is left
untouched. A taken branch traps at `D3DMetal+0x36f69b`. The crash collector must
record `R15` and the dword at `[R15]`; `EAX` at this trap is not the parser
HRESULT.

### Final failure-only return trap

Retain the already verified return discriminator.

| Span | Pristine bytes | Diagnostic bytes |
| --- | --- | --- |
| `0x69893`, 6 bytes | `8b 44 24 0c eb 0f` | `e9 02 60 30 00 90` |
| `0x36f89a`, 15 bytes | fifteen `00` bytes | `8b 44 24 0c 85 c0 74 02 0f 0b e9 ff 9f cf ff` |

The entry jump displacement is `0x36f89a - 0x69898 = 0x306002`.
Success resumes at `0x698a8`; failure traps at
`D3DMetal+0x36f8a2` with the original HRESULT still in `EAX`.

## Separation rule

The validated no-op PSO producer fix and the final return trap both occupy
`0x36f89a`, so they cannot coexist. The diagnostic must temporarily replace the
no-op-fix runtime using a separately built and signed artifact. After the first
crash artifact is collected, restore the no-op fix before any second launch.

This reintroduces the known competing no-op crash producer for one run. Any RIP
other than the two diagnostic RIPs is therefore inconclusive, not evidence for
either RT phase.

## Required guards and acceptance criteria

Before signing or installing, abort unless all of these match pristine:

- the full source SHA-256;
- 6 bytes at `0x12170a`;
- 2 bytes at `0x36f69b`;
- 6 bytes at `0x69893`;
- 15 bytes at `0x36f89a`.

Record the raw and signed diagnostic hashes. Install atomically only while no
process has D3DMetal loaded, then verify the installed hash.

- Raw SHA-256: `288226f9418e2d9d6571d0438158df259494abc4ba3fdae2b9a6d88319e16c41`
- Signed SHA-256: `ea8d4e5d11a01b2871125999679d59495f21663f11d66b31c9f1e6f060ea21ee`
- Runtime command: `scripts/d3dmetal-rtxgi-runtime.sh install-parser-phase-trap`

A run is classifiable only if the crash artifact contains the installed hash,
module base, exception code, normalized RIP, registers, stack, and relevant
launcher/game logs. The final-return result additionally requires
`EAX=0x80070057` and the expected RT state-object call stack.

## Outcome map

| Result | Defensible conclusion | Next patch |
| --- | --- | --- |
| `D3DMetal+0x36f69b` | The external status is nonzero at the first observation after `ParseStateObjectInto`. | Move inside the parser. Add unique traps after per-subobject dispatch/status checks and capture descriptor type, subobject count, current index/type, and `[R15]`. Do not repeat the isolated `0x0ae4ab` store trap. |
| `D3DMetal+0x36f8a2`, `EAX=0x80070057`, expected RT stack | Parsing passed; failure is later in the base constructor and still before `CreatePipelines`. | Replace the parser discriminator with a taken-branch trap at export predicate branch `0x12171b`, retaining the final trap. If that does not fire, move next to inheritance-status branch `0x12172c`, then bracket `CompileNewResolvedExports` and inspect later exits. |
| Any other RIP, wrong hash, different HRESULT/stack, or no trap | Inconclusive. The diagnostic did not classify the target failure. | Verify artifact loading and reproduction; determine whether the known no-op crash preempted the RT failure. Do not patch semantics from this run. |

## Architect review

Codex Architect returned `WATCH`: the two-outcome discriminator is sound and
minimal, provided complete pristine-byte guards and strict crash attribution are
implemented first. Architect explicitly recommended excluding the no-op fix for
this single run and restoring it immediately afterward.

Review conversation:
https://chatgpt.com/g/g-6a6c2c25638c819193c521156319a9e9-codex-architect/c/6a6da761-6420-83e8-9e0a-a9b2406a10a1

## Implementation and installed runtime

The parser-phase artifact was generated from pristine, ad-hoc signed, and
verified with deep/strict codesign. The patcher tests pass 14/14, the D3DMetal
Vitest suite passes 6/6, TypeScript passes, and the runtime shell script passes
syntax validation.

`Yaagl ZZZ DX12.app` was rebuilt at 2026-08-01 17:26:02 +0900 and passes
deep/strict codesign verification.

The active runtime is `state-object-parser-phase-trap`; its installed binary
hash is the signed SHA-256 above. The pristine backup and GPTK cache both remain
pristine, and no process had D3DMetal loaded at installation time.

## Runtime result

The controlled run `1785572894339` produced
`Crash_2026-08-01_082925416` on thread `0x0200` with exception
`0xc000001d` at absolute RIP `0x2192138a2`. Using the D3DMetal image base
`0x218ea4000`, the normalized RIP is `D3DMetal+0x36f8a2`: the final
failure-only return trap, not the parser trap.

The exception context and captured stack satisfy the attribution gates:

- `RAX/EAX = 0x80070057`;
- `[RSP+0x0c] = 0x80070057`, the original saved HRESULT;
- stack return address `0x218f09a62` normalizes to `D3DMetal+0x65a62`,
  immediately after the expected `CreateStateObject` wrapper call;
- `[RBX] = 0`, confirming the output state-object slot is null;
- the loaded framework path in the launch module capture is the active
  D3DMetal runtime.

Therefore the first external status check after `ParseStateObjectInto` passed.
The remaining failure region is after parsing and before `CreatePipelines`.
Per the outcome map, the next discriminator should instrument the taken export
predicate branch at `0x12171b` while retaining the final failure trap.

After capture, the parser-phase diagnostic was removed and the independently
validated `no-op-pso-vertex-count-init` runtime was restored. Its installed
signed hash is
`4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851`;
the pristine backup and GPTK cache remain valid.
