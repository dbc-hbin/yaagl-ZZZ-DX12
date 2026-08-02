# D3DMetal 4.0b2 separated no-op and RT-boundary patches

## Decision

The repeated graphics crash and the RTPSO `E_INVALIDARG` failures are separate
fault classes and must not share one binary during attribution.

## No-op graphics PSO producer fix

`D3DMGraphicsPipelineState` stores a null compiled-stage pointer and takes the
unique failure edge at `0x10f6d5`. That edge previously reached the no-op path
without running `InitVertexState`, leaving the trusted 16-bit count at
`object+0x28c` uninitialized.

The patch preserves the original conditional branch and changes only its rel32
target to the 15-byte alignment cave at `0x36f89a`. The thunk executes:

```asm
movw $0, 0x28c(%rbx)
jmp  0x10f79a
```

Successful PSOs retain the original fallthrough at `0x10f6db`. No consumer is
clamped and no other object fields are initialized.

- Raw SHA-256: `1a9dceacfd83a765d3d992e1a725d73de2cc52b4cbd0f9047e28dca0c5f0fa7e`
- Signed SHA-256: `4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851`
- Runtime command: `scripts/d3dmetal-rtxgi-runtime.sh install-noop-fix`

## CreateStateObject return-boundary diagnostic

The prior four HRESULT-store traps were disproved by execution. The actual COM
wrapper at `0x65a5d` calls `D3D12Device::CreateStateObject` at `0x697ee`.
For the supported state-object paths, the implementation restores the child
HRESULT into `EAX` at `0x69893` and then reaches the common epilogue.

The first diagnostic trapped every return and established that the first call
returned `S_OK`. The refined diagnostic redirects the complete six-byte normal
tail at `0x69893` through the alignment cave at `0x36f89a`. The thunk reloads
and tests the HRESULT: `S_OK` returns to `0x698a8`; only a failing HRESULT traps
at `0x36f8a2`. It cannot publish a failed state object or reach `DispatchRays`.

- Raw SHA-256: `42e501dbacfdf13100ed6a1dad7a3ea9e0ada00e59d9398c00009a8d692e18e0`
- Signed SHA-256: `f19a6b89a668eefd628a8b95126b8099dfae7b2e85861710498be0e57e46b5fb`
- Expected failing-call image-relative RIP: `0x36f8a2`
- Runtime command: `scripts/d3dmetal-rtxgi-runtime.sh install-return-trap`

## Gates

- Pristine D3DMetal SHA and exact original bytes are required.
- Patches are mutually exclusive and independently signed.
- Runtime transitions retain a pristine backup and verify the untouched GPTK
  cache.
- A real RT compatibility patch remains disallowed until the boundary HRESULT
  and first failing child stage are proven.

## Runtime results

The producer fix run created seven no-op graphics PSOs and logged 5,005 RTPSO
failures, then reached Unity's normal shutdown markers without a native crash.
This validates the crash fix independently from RT behavior.

The initial unconditional boundary trap stopped at `D3DMetal+0x69897` with
`EAX=0`, proving that the first state-object call succeeds. The refined
failure-only trap stopped at `D3DMetal+0x36f8a2` with
`EAX=0x80070057`; the output slot was null. D3DMetal itself therefore returns
`E_INVALIDARG`; this is not a Unity-side HRESULT transformation.

Static control flow further narrows the source. If the base state-object
constructor leaves the HRESULT at zero, the raytracing constructor calls
`CreatePipelines` after overwriting its HRESULT-pointer register, so that call
cannot account for the external `E_INVALIDARG`. The failure is published by
the base constructor before `CreatePipelines`.

The next diagnostic should retarget the parser-result `jne` at `0x12170a` to a
unique trap thunk while retaining the failure-only boundary trap. A parser RIP
would identify `ParseStateObjectInto`; a boundary RIP with no parser trap would
move the investigation to post-parse inheritance/export compilation. The prior
four direct-store traps already exclude their exact branches for this workload.
