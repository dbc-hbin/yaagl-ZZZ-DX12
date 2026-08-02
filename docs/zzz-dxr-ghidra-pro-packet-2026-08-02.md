# ZZZ DXR / D3DMetal renderer packet — 2026-08-02

## Scope and decision request

This packet deliberately excludes MetalFX UI and launcher design. It asks for a
read-only diagnosis of the D3DMetal DXR renderer path that can explain a city
scene with valid characters/HUD/BVH activity but missing or black world
surfaces. No conclusion may be promoted to a renderer fix without a direct
runtime-to-function correlation.

The requested decision is: rank the next *D3DMetal/DXR-only* observation point
between RT state-object creation, RT export compilation, `SetPipelineState1`,
`DispatchRays`, encoder resource/output handling, and the independently proven
FP64/no-op graphics pipeline failures. Do not recommend game-file edits, GPTK
cache edits, fabricated success, broad FP64 conversion, or a launch gate.

## Latest product run

Run `1785655439012` reached the city and exited normally (`launchExitCode: 0`).
Its profile proves the intended renderer contract:

- `-use-d3d12`, Direct3D 12 feature level 12.1, and `d3d12: loaded!`.
- `D3DM_MTL4=1`, `D3DM_SUPPORT_DXR=1`, RTX 4060 spoof, and
  `supportsRayTracing = 1`.
- D3DMetal reports `Enabled MTL4 backend - options=RTV` and created a D3D12
  swapchain.
- The screenshot shows `Dispatch Rays 1`, `Build BVH 1`, and `Refit BVH 60`.
  These are activity signals only, not output correctness.

The city remains visibly broken: world/foreground geometry is predominantly
black while the character, UI, sky, and some water remain visible. This is a
new screenshot artifact in `evidence/zzz-city-1785655439012.png`.

The same run does **not** record RTPSO or `CreateStateObject` failure:

- `rayTracingPsoFailureCount = 0`
- `rtxgiInvalidStateObjectCount = 0`
- `createStateObjectFailureCount = 0`

It does directly record twelve MetalIR `Unhandled FP64 usage` / error-19
failures (Compute 9, Fragment 3), and three failed fragment pipelines replaced
by no-op PSOs: `428`, `527`, and `661`. The failure time/thread sequence is in
the attached raw system log. Therefore this run establishes a valid DXR product
path with an incomplete shader graph; it does not establish functional RT.

## Binary identities and Ghidra basis

The Ghidra project imports the pristine, read-only GPTK 4.0b2 framework:

- source: `gptk/4.0b2/.../D3DMetal`
- SHA-256: `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`
- Ghidra: 12.1.2, Mach-O x86_64, image base `0x0`

The active product runtime is separately identified as no-op-only D3DMetal:
`4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851`.
No binary was modified for this analysis. Every Ghidra raw output and the exact
Java scripts that produced it are included.

## Static function flow confirmed in Ghidra

The end-to-end trace confirms these direct calls in the pristine binary:

```text
ID3D12Device5::CreateStateObject                  +0x697ee
  -> D3D12RaytracingStateObject::Create...        +0x1274d2
     -> D3D12RaytracingStateObject::ctor           +0x127542
        -> D3D12StateObject::ctor                  +0x1214f4
           -> InheritPipelineConfig...             +0x1225ae
           -> CompileNewResolvedExports            +0x122afc
              -> CreateFunction                    +0x123ba0
                 -> D3DMStageCache::CompileRT...   +0x996d8
                    -> cache-miss lambda            +0x99ec4
        -> CreatePipelines                          +0x12764c
```

The raytracing command path is independently present:

```text
D3D12GraphicsCommandListMPL::SetPipelineState1    +0xde70a
D3D12GraphicsCommandListMPL::DispatchRays          +0xde174
  -> DispatchRaysIndirect                           +0xe2062
EncodeDispatchRays                                 +0x15fd12
DispatchRaysIndirect encoder                       +0x16015b
```

`DispatchRays` dynamically casts the selected object to
`D3D12RaytracingStateObject` and reaches `DispatchRaysIndirect`. The encoder
path binds resources/compute pipeline state and dispatches work. Static control
flow alone cannot establish that the intended RT output resource contains finite
data or is consumed by the later scene composite.

The older, now historical `E_INVALIDARG` investigation is consistent with this
flow: `CreateFunction` calls `CompileRTFunction` at `+0x123f16`; a prior
fail-closed trap run proved the fresh `IRCompilerAllocCompileAndLink` null path
at `+0x9a12f`. That historic state-object rejection is absent from the latest
run and must not be silently conflated with the current no-op graphics PSOs.

## Evidence boundary and required next observation

The current capture implementation is intentionally unavailable because its
ACK/ARM control path once stopped Wine. Game entry takes the normal launch path.
Any next observer must be passive, one-way, bounded, and unable to terminate or
delay the game.

The highest-value unresolved renderer question is now:

> When `DispatchRays` is recorded, does the chosen RT state object produce a
> finite non-clear output resource, and is that resource consumed before the
> broken final scene surface is encoded?

An acceptable next design must collect only bounded metadata at the following
candidate boundaries, without changing renderer results:

1. just after `DispatchRays` / `DispatchRaysIndirect`;
2. scene color immediately before the final composite;
3. resource passed into `EncodeDispatchRays` and its format/dimensions/state;
4. separately, raw payload identity at the already-known compiler callsite,
   only if it can be correlated to the twelve current FP64 error-19 events.

Record resource identity, format, dimensions, last writer, finite/non-finite
counts, bounded samples/checksum, and relevant barrier/fence order. Missing or
ambiguous evidence must be `incomplete`; it must never cancel the product run.
