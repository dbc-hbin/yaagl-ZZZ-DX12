# D3DMetal 4.0 beta 2 / ZZZ RTXGI compatibility design request

Use your longest available Pro/Heavy reasoning mode. Spend substantial time checking the DXR semantics and x86-64 control flow before answering. This is a binary-compatibility design review, not a request for generic troubleshooting.

## Objective

Design the smallest defensible, reversible compatibility patch for the **x86_64 D3DMetal binary shipped in Game Porting Toolkit 4.0 beta 2** that lets Zenless Zone Zero create its RTXGI ray-tracing state objects correctly on Apple Silicon.

The desired result is real RT rendering, not merely exposing the menu or forcing `CreateStateObject` to return success. The patch must preserve DXR invariants and must not allow a structurally invalid state object to reach `DispatchRays`.

## Decisions requested

1. Audit the current four-way branch-tagging strategy. Is it sufficient to identify the first rejecting stage without altering execution semantics?
2. For each possible tag result, derive the most likely compatibility defect and the minimal safe patch shape.
3. In particular, determine whether D3DMetal's equality requirements for pipeline/shader configs are stricter than Windows DXR behavior for this RTXGI state object, or whether the game input must actually be rejected by spec.
4. If normalization is valid, specify exact merge rules for:
   - `MaxTraceRecursionDepth`
   - `MaxPayloadSizeInBytes`
   - `MaxAttributeSizeInBytes`
   - pipeline flags / `RAYTRACING_PIPELINE_CONFIG1`
   - explicit versus inherited/default configs
5. Give a concrete x86-64 patch design for D3DMetal 4.0b2: control-flow change, replacement logic, needed code cave/trampoline if any, guards, bounds checks, and rollback behavior. Do not hand-wave with “skip validation.”
6. Identify what evidence must be captured on the one tagged game run and what success/failure criteria must gate the real patch.
7. Review whether the secondary MetalIRConverter FP64/no-op PSO failures are independent, downstream, or likely to remain a second blocker after the RT state-object fix.

Return:

- A ranked root-cause verdict with confidence.
- A branch-by-branch patch decision table for tags `0x8004d001` through `0x8004d004`.
- A precise recommended implementation, including pseudocode and x86-64-level patch mechanics.
- DXR-spec justification for every relaxed or changed invariant.
- A fail-closed validation and rollback plan.
- Explicit “do not patch” cases.
- Any missing disassembly or runtime value that is genuinely required before implementing the final patch.

## Hard constraints

- GPTK/D3DMetal **4.0 beta 2 is the latest available build in this environment**. Do not recommend a nonexistent later official GPTK 4 runtime.
- Work within beta2 as far as technically possible.
- Do not modify the game executable, game DLLs, RTXGI files, anti-cheat, or inject proxy DLLs/OptiScaler.
- Only a private Wine runtime copy of `D3DMetal.framework` may be patched. A pristine GPTK cache remains untouched.
- The active framework is backed up in full before signing because `_CodeSignature` changes.
- Every binary patch must pin the exact pristine SHA-256 and exact opcode bytes, fail closed on mismatch, and be reversible.
- No change may simply replace a failing HRESULT with `S_OK`.
- No more cache deletion, game reinstall, OS upgrade, GPU-spoof variation, or generic RT/DLSS matrix testing unless it directly distinguishes two patch designs.
- Hardware/OS: Apple M5 Pro, 64 GB, Apple GPU family 10, macOS 27.0 build `26A5388g`.
- Wine: `11.0-1-crossover-signed-experimental`, x86_64 via Rosetta.
- D3DMetal: `4.0b2`.
- Pristine D3DMetal SHA-256: `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`.

## What already works

The game is launched through the real product path with:

```text
-use-d3d12
WINE_ENABLE_TIMEOUT_FIX=1
WINEMSYNC=1
CX_ACTIVE_GRAPHICS_BACKEND=d3dmetal
D3DM_MTL4=1
D3DM_ENABLE_METALFX=1
D3DM_SUPPORT_DXR=1
D3DM_VENDOR_ID=0x10de
D3DM_DEVICE_ID=0x2882
D3DM_DEVICE_DESCRIPTION=NVIDIA GeForce RTX 4060
```

This successfully exposes and operates the game's NVIDIA-gated menus:

- Ray Tracing: Enable
- Ray Tracing Level: Medium
- Super Resolution: DLSS
- DLSS quality selections

The launcher uses the GPTK MetalFX NGX shim and the correct Wine PE/Unix aliases. The old screenshot text `DXR: disabled` predates runtime-linked status reporting and is not the current capability result. The current UI distinguishes capability from pipeline health and reports `DXR: enabled — RTXGI pipeline failed`.

Changing caches, reinstalling the game, switching to macOS 27, and enabling the Metal 4 path did not fix RT. Native/TAA, frame generation off, and RT Medium still reproduced the same black-background failure, excluding DLSS as the primary cause.

## Definitive runtime evidence

Latest controlled RT Medium run:

```json
{
  "validatedD3DMetalVersion": "4.0b2",
  "selectedRenderer": "d3d12",
  "rendererEvidence": [
    "Forcing GfxDevice: Direct3D 12",
    "Version: Direct3D 12 [level 12.1]",
    "d3d12: loaded!"
  ],
  "dxrCapability": "supported",
  "dxrEvidence": ["supportsRayTracing = 1"],
  "dxrPipelineFailed": true,
  "rayTracingPsoFailureCount": 1247,
  "rtxgiInvalidStateObjectCount": 1,
  "hresultCounts": { "0x80070057": 1247 },
  "metalCompileFailureCount": 14,
  "metalCompileFailuresByStage": { "compute": 9, "fragment": 5 },
  "metalIrUnhandledFp64Count": 15,
  "noOpPsoIds": [336, 419, 521, 526, 537, 809, 840]
}
```

First decisive Player.log sequence:

```text
supportsRayTracing = 1
d3d12: could not create a Ray Tracing Pipeline State Object (0x80070057)
d3d12: Dispatching Ray Tracing Shader "RTXGI" failed. Invalid Ray Tracing State Object.
```

The run exited normally through `OnApplicationQuit`. There was no device loss, GPU fault, or crash in this run.

Unified-log examples near the RT scene:

```text
[MetalIRConverter:] FP64Usage : Unhandled FP64 usage
[D3DMetal:] Failed to compile stage Compute - error:19, <private>
[D3DMetal:] Failed to compile stage Fragment - error:19, <private>
[D3DMetal:] Failed to compile a pipeline, marking PSO(336) as no-op
```

The established causal chain is:

```text
DXR capability exposed
  -> ZZZ constructs RTXGI D3D12 ray-tracing state objects
  -> D3DMetal 4.0b2 returns E_INVALIDARG
  -> Unity records an invalid RT state object
  -> RTXGI dispatch cannot occur
  -> RT lighting/background is absent or black
```

## D3DMetal reverse-engineering evidence

The binary contains a substantial DXR State Object implementation. Relevant symbols/addresses:

```text
0x0abec3  StateObjectBuilder::ParseStateObjectInto(...)
0x0b36c4  StateObjectBuilder::ResolveAssociations(...)
0x0b3990  StateObjectBuilder::StateObject::exportsHaveMatchingPipelineAndShaderConfigs()
0x1214f4  D3D12StateObject::D3D12StateObject(...)
0x1225ae  D3D12StateObject::InheritPipelineConfigAndShaderConfigFromExports(int*)
0x122afc  D3D12StateObject::CompileNewResolvedExports(...)
```

Mach-O `__TEXT` has `vmaddr=0` and `fileoff=0`, so these virtual addresses equal file offsets.

Constructor control flow:

```asm
0x1216d9 call ParseStateObjectInto
0x121706 cmpl $0, (*hresult)
0x12170a jne  failure_epilogue

0x121714 call exportsHaveMatchingPipelineAndShaderConfigs
0x121719 test al, al
0x12171b je   0x121798          ; direct E_INVALIDARG store

0x121723 call InheritPipelineConfigAndShaderConfigFromExports
0x121728 cmpl $0, (*hresult)
0x12172c jne  failure_epilogue

0x121788 call CompileNewResolvedExports

0x121798 movl $0x80070057, (*hresult)
```

There are exactly four known direct `E_INVALIDARG` stores on this construction path:

| Stage                                | Instruction | HRESULT immediate | Original opcode bytes  |
| ------------------------------------ | ----------: | ----------------: | ---------------------- |
| descriptor/parser failure            |  `0x0ae4ab` |        `0x0ae4ae` | `41 c7 01 57 00 07 80` |
| export config precheck               |  `0x121798` |        `0x12179b` | `41 c7 07 57 00 07 80` |
| pipeline config inheritance mismatch |  `0x12275f` |        `0x122761` | `c7 00 57 00 07 80`    |
| shader config inheritance mismatch   |  `0x122813` |        `0x122815` | `c7 00 57 00 07 80`    |

Observed inheritance logic:

- Recursion depth at the resolved object around offset `0x88` is merged with a max-like `cmova` path.
- Pipeline config value at object offset `0x90` is required to equal the incoming export config at offset `0x40`; mismatch writes `E_INVALIDARG` at `0x12275f`.
- Shader config values at object offsets `0xa0` and `0x98` are required to equal incoming export values around offsets `0x38` and `0x40`; mismatch writes `E_INVALIDARG` at `0x122813`.
- Flag bytes around `0x94`, `0x9c`, and `0xa4` mark whether corresponding inherited configs have already been established.

Relevant pipeline comparison disassembly:

```asm
0x12274f movl 0x90(%r14), %ecx
0x122756 cmpl 0x40(%rax), %ecx
0x122759 je   0x122777
0x12275f movl $0x80070057, (%rax_hresult)
...
0x12276c movl 0x40(%rax), %ecx
0x122777 movl %ecx, 0x90(%r14)
```

Relevant shader comparisons:

```asm
0x1227d7 movl 0xa0(%r14), %eax
0x1227de cmpq %rax, 0x38(%rcx)
0x1227e2 je   0x1227f1
0x1227e4 jmp  0x12280f
...
0x122802 movl 0x98(%r14), %eax
0x122809 cmpq %rax, 0x40(%rcx)
0x12280d je   0x122828
0x12280f movl $0x80070057, (%hresult)
```

Important caution: the DXR specification requires compatible/finally consistent shader and pipeline configurations. Blindly disabling validation or forcing `S_OK` is not acceptable. A possible compatibility rule is to normalize payload/attribute maxima, but that is only valid if Windows permits the state object construction semantics represented by ZZZ and the compiled shader metadata remains safe.

## One-run branch tagging design

The current diagnostic patch changes only the four failing HRESULT immediates:

```text
descriptor/parser                 0x80070057 -> 0x8004d001
export-config precheck            0x80070057 -> 0x8004d002
pipeline-config inheritance       0x80070057 -> 0x8004d003
shader-config inheritance         0x80070057 -> 0x8004d004
```

All four values remain failing HRESULTs. No invalid object is allowed to execute. One RT Medium run should therefore identify the first rejection stage from Player.log while preserving the failure behavior.

The patcher:

- accepts only the exact pristine SHA above;
- verifies the full instruction bytes at all four sites;
- creates a separate patched output;
- recognizes original, fully tagged, and unknown/mixed modes;
- refuses unknown binaries;
- preserves file mode;
- backs up the complete active framework before signing;
- ad-hoc signs only the private active framework;
- verifies the signature and all four tags after signing;
- restores from the untouched cached beta2 framework or full framework backup.

The tagged framework was already validated on a temporary full copy:

```text
Mach-O 64-bit dynamically linked shared library x86_64
all four immediates disassemble as 0x8004d001..0x8004d004
codesign --force --deep --sign - <framework>
codesign --verify --deep --strict -> valid on disk / satisfies requirement
```

No real compatibility relaxation has yet been applied.

## Existing launcher/diagnostic code changes

The launcher now:

- forces the actual D3D12 product path rather than a synthetic harness;
- validates exact D3DMetal version and the full runtime overlay;
- captures a fresh per-run Player.log fingerprint;
- captures loaded D3DMetal modules;
- uses unified-log predicate terms for `subsystem == "D3DMetal"` and `MetalIRConverter`;
- records structured DXR capability and RTXGI pipeline evidence;
- distinguishes `DXR supported` from `RTXGI state object failed` in the UI;
- cleans up and restores patches in `finally` paths.

Targeted diagnostics tests, TypeScript, formatting, app build, signature verification, real launcher path, and the real RT Medium run all passed before starting the binary patch work.

## External research already checked

- Metal 4 and native Metal ray tracing are supported on this hardware; changing macOS/Metal generation did not solve the D3D12 state-object failure.
- Apple does not publish a complete D3DMetal 4.0b2 DXR/RTXGI compatibility matrix or a supported environment flag that repairs this path.
- Binary inspection found no credible general `D3DM_LOGLEVEL` or “ignore unsupported state object” environment switch. `D3DM_NOT_IMPLEMENTED` is a returned string, not an environment variable.
- `D3DM_BOUNDS_CHECK` and `D3DM_DXIL_PROCESS_DEBUG_INFORMATION` exist but change diagnostics/processing and are not evidence-backed fixes for this State Object rejection.
- Shader Validation can itself be problematic with Metal 4 RT pipelines, but the observed failure is earlier and explicit: D3D12 RTPSO creation returns `E_INVALIDARG`.
- Similar translation layers implement complex RTPSO association, collection, embedded DXIL-subobject, and DXR 1.1 behavior incrementally; mere `supportsRayTracing=1` does not prove RTXGI compatibility.

## Current local judgment to challenge

The most evidence-efficient next action is the single branch-tagged RT run. It is not a random experiment: the result selects the only defensible real patch family.

Tentative mapping:

- `d001`: parser/descriptor/subobject support defect. Trace the incoming State Object subobject type and repair only the unsupported or misparsed case.
- `d002`: top-level export config precheck rejects a combination before inheritance. Determine exactly which export/config equivalence predicate differs from Windows, then normalize or defer only that comparison.
- `d003`: pipeline config/flags inheritance mismatch. Distinguish default versus explicit config, collection inheritance, and CONFIG versus CONFIG1 flags before any relaxation.
- `d004`: shader payload/attribute mismatch. If Windows-compatible, merge conservative maxima within DXR limits and ensure all downstream allocation/compilation uses the merged values. The precheck may also need a narrow adjustment so valid normalization can be reached.

Please challenge this mapping and produce the precise, spec-backed design requested above.
