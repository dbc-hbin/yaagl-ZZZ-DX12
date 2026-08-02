# ZZZ DXR / D3DMetal Ghidra trace — city run 1785664789736

## Scope

Read-only Ghidra trace against the active GPTK 4.0b2 x86_64 D3DMetal image.
The raw headless output is preserved outside the repository at
`/tmp/yaagl-trace-dxr-1785664789736.log`; this document records the verified
renderer-flow conclusions needed by the live repository agent.

## Confirmed DXR flow

`D3DMStageCache::CompileRTFunction` creates the DXIL object at
`D3DMetal+0x9a10e`, calls `IRCompilerAllocCompileAndLink` at
`D3DMetal+0x9a12a` (return address `+0x9a12f`), then consumes metallib and
reflection output.

Runtime dispatch continues through:

```text
SetPipelineState1 +0xde70a
  -> DispatchRays +0xde174
  -> DispatchRaysIndirect +0xe2062
  -> EncodeDispatchRays +0x15fd12
  -> encoder +0x16015b
```

The final encoder binds a compute PSO, installs a 0x30-byte argument block at
index 3, dispatches threads, emits a barrier, and chooses ICB or per-record
indirect dispatch. Instrumenting its output resource identity, format, extent,
state, dispatch dimensions, barrier, and ICB/direct selection is the focused
way to distinguish invalid RT output binding from a broken composite.

## Compile paths that match the current failures

```text
Graphics:
  +0x89188 -> +0x9ccd8 -> graphics PSO ctor +0x10f512
  -> LoadFunctions +0x110746 -> GetRenderPipelineState +0x11215c

Compute:
  +0x86e58 -> +0x872e4 / +0x879e8 -> +0x9cccc
  -> compute PSO ctor +0x10ed2c / CompilePipeline +0x10f062
```

The city run has 12 FP64 error-19 failures (compute 9, fragment 3) and
fragment no-op PSOs 429, 527, and 759. The existing hook only exports the
CompileAndLink input and does not connect an input SHA to stage, error-19, or
PSO ID. The next implementation must make that correlation, rather than guess
which of the 26 observed DXIL blobs is the failing shader.

## Important negative result

The current functional replacement target (`26964` bytes,
`02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869`) was not
observed in this city run. All 26 observed calls selected the original object;
there was no replacement compilation success. The yellow/black frame must not
be attributed to that replacement.

## Runtime evidence

The non-repository runtime logs are:

```text
/Users/hanbinnoh/Library/Application Support/Yaagl ZZZ DX12/logs/
  d3dmetal_1785664789736_metal_ir_probe.log
  d3dmetal_1785664789736_system.log
  d3dmetal_1785664789736_evidence.json
  d3dmetal_1785664789736_profile.json
```
