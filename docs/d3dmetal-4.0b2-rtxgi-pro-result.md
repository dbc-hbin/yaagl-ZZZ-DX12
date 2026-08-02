# D3DMetal 4.0 beta 2 RTXGI Pro review result

Source conversation: <https://chatgpt.com/c/6a6cd924-8818-83e8-bfb1-52e17b0939e1>

Completed after 16 minutes 8 seconds of Pro analysis. This document records the
actionable conclusions; it is not a verbatim transcript.

## Decisive verdict

The four-way failing-HRESULT tag probe is the correct next diagnostic. Each tag
remains a failing HRESULT, preserves instruction size and flags behavior, and
cannot create a usable state object. The observable HRESULT is intentionally
different, so a valid run must prove that a raw `0x8004d00N` reaches the log and
that no failed object reaches `SetPipelineState1` or `DispatchRays`.

Do not merge genuinely different pipeline or shader configurations. In
particular:

- Do not use `max()` for recursion depth, payload size, or attribute size.
- Do not OR, AND, or mask pipeline flags to make configurations match.
- Compare canonical _effective_ associations after DXR override/default
  resolution.
- The one narrow cross-type equivalence is
  `PIPELINE_CONFIG(depth) == PIPELINE_CONFIG1(depth, FLAGS_NONE)` when the
  reported tier supports CONFIG1.

Before the tagged run, the leading hypothesis is an effective-association or
canonical-representation defect in D3DMetal (roughly 50–60% analytical prior),
followed by a genuinely conflicting RTXGI descriptor (20–30%) and a parser or
subobject-support defect (15–20%). MetalIRConverter FP64/no-op failures are very
unlikely to cause this particular `CreateStateObject(E_INVALIDARG)` because all
four identified rejection paths precede `CompileNewResolvedExports`.

## Tag decision table

| Tag          | Proven stage                                                                      | Defensible patch family                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x8004d001` | Descriptor/parser rejection                                                       | Identify the exact valid missing subobject case and repair only its parser switch/predicate. Preserve pointer, count, enum, tier, range, flag, and export-reference validation.                                                                 |
| `0x8004d002` | `exportsHaveMatchingPipelineAndShaderConfigs()` returned false before inheritance | Repair association resolution or the narrow comparator so it compares canonical effective `(depth, flags)` and `(payload, attribute)` tuples. Never invert the constructor failure branch.                                                      |
| `0x8004d003` | Export precheck passed; pipeline inheritance mismatch                             | Correct only a proven representation/source error, such as legacy CONFIG flags not being canonicalized to zero, a stale superseded association being selected, or an unset slot being initialized incorrectly. Keep the original exact compare. |
| `0x8004d004` | Pipeline inheritance passed; shader-config mismatch                               | Correct only the producer width/source, such as zero-extending API `UINT` fields or choosing the resolved winning association. Keep exact payload/attribute equality; never use `max()`.                                                        |

## Preferred beta 2 hook architecture

Build the real patch from the pristine binary only:

```text
f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad
```

Do not stack a real compatibility patch on the tagged binary. Restore pristine,
verify SHA and source opcodes, then apply exactly one selected branch family.
The four original `E_INVALIDARG` stores should remain unchanged in the real
patch.

For `d002`, the preferred targets are the narrow faulty leaf in
`ResolveAssociations` (`0x0b36c4`) or
`exportsHaveMatchingPipelineAndShaderConfigs` (`0x0b3990`). If a guarded
wrapper is necessary, the call at `0x121714` is the candidate trampoline; the
expected pristine direct-call encoding is `e8 77 22 f9 ff`, which must be read
and verified before patching.

For `d003` or `d004`, prefer a guarded pre-inheritance canonicalization wrapper
at the call from `0x121723` to `0x1225ae`. The expected pristine encoding is
`e8 86 0e 00 00`, again subject to exact opcode verification. Unrecognized
layouts and failed guards must tail-call the untouched original implementation.
The wrapper may repair only representation or source selection; original
equality and failure paths must still execute.

No safe generic `d001` parser patch can be designed from the final HRESULT store
alone. It requires the exact failing subobject index/type and predecessor switch
or predicate.

Any code cave must be file-backed executable padding in `__TEXT,__text`, unused
by function-start, unwind, relocation, branch-target, and literal metadata. It
must be ASLR-safe, ABI-correct, bounded, allocation-free, guarded by the exact
captured descriptor shape, and fall through to original behavior for every
unknown case.

## Evidence required from the tagged run

The run must capture:

- Exact loaded framework path, SHA, Mach-O UUID, and load base/slide.
- The first raw tagged HRESULT for the RTXGI state object.
- State-object type, subobject count, subobject index/type list, and collection
  presence.
- Raw pipeline/shader configs and every explicit/default association with its
  source scope: state object, directly included DXIL library, or collection.
- Reported ray-tracing tier and a call-sequence identifier.

Tag-specific follow-up:

- `d001`: failing subobject index/type, predecessor branch, descriptor fields,
  and call stack.
- `d002`: each resolved export's winning config source and canonical tuples,
  plus full disassembly of `0x0b3990`.
- `d003`: object `+0x88/+0x90`, presence bytes, incoming `+0x40`, config kind,
  and association provenance.
- `d004`: object `+0x98/+0xa0`, presence bytes, incoming `+0x38/+0x40` split
  into low/high halves, field mapping, and provenance.

If no raw tag reaches the log, or different descriptors fail in unrelated tag
families, do not select a real patch yet.

## Success gates

A real patch is successful only if `CreateStateObject` returns success with a
non-null object, `CompileNewResolvedExports` succeeds, shader identifiers are
valid, and a real `SetPipelineState1`/`DispatchRays` occurs. The scene must render
actual RT lighting/background, both RTXGI invalid-state-object errors must
disappear, and there must be no device loss, GPU fault, or new RTXGI no-op PSO.
A negative-control descriptor with one genuinely differing canonical field must
still fail through the original validation path.

Do not patch if effective canonical values genuinely differ, a collection
association would need to be overridden, limits or tier requirements are
violated, unsupported flags need real unimplemented semantics, or the only
available change is bypassing validation or returning synthetic success.

## 2026-08-01 Computer Use follow-up

The failure-tag runtime was installed for one real product launch, but the game
stopped at its post-login UI before any RTPSO attempt. The foreground Wine
process had no bundle identifier and was not a supported Computer Use target.

A follow-up Architect review selected a direct-spawned, same-PID AppKit host as
the only conditional design that might preserve the existing process contract.
A local x86_64 probe then disproved its required invariant: after the host
`execve`d an external GUI executable, the PID stayed constant but macOS replaced
the ASN, set the new app's bundle identifier to `NULL`, and Computer Use could
no longer attach through the original bundle identifier. Architect's final
verdict was `BLOCK` under the current constraints.

The full reproducible evidence and reopening gates are recorded in
`docs/d3dmetal-computer-use-identity-probe-2026-08-01.md`. This result does not
change the compatibility decision: no real D3DMetal relaxation may be selected
until a raw `0x8004d001` through `0x8004d004` is captured from an actual RTXGI
state-object attempt.
