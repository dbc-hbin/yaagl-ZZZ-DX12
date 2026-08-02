# MetalIR passive multi-capture contract

This is a diagnostic-only mode. It must not share replacement-object or
functional-rewrite branches with `metal-ir-unorm-fix-v1`.

## Integration

- Interceptor: `native/metal-ir-capture/metal-ir-capture.cpp`, GOT wrapper
  `YaaglIRCompilerAllocCompileAndLinkProbe`.
- ABI: `IRObject *(IRCompiler *, const std::vector<std::string> &, const IRObject *, IRError **)`.
- Validated DXIL object fields are read at `+0x00`, `+0x10`, `+0x18`, `+0x1c`,
  and `+0x1d`; the vtable must equal provider `+0x14940e0`, type is `2`, and
  `ownsBytes` is `0`.
- A claimant is eligible only when the verified D3DMetal return address is
  `+0x9a12f`; the original `IRError **` argument is forwarded bit-for-bit on
  every invocation. At the verified target call site its value is currently
  null, but this is an observed predicate, not a replacement rule. The
  interceptor therefore does not observe an
  `IRError` code; it records `error_code=unknown` and correlates the captured
  pre-call blob with the post-run system log's exact `Unhandled FP64 usage`
  (`0x13`) records. The compiler, arguments, object pointer, sink, and returned
  object remain unchanged.

## Pre-call handoff

Before the one real call, the wrapper validates the object header, checked-adds
the byte span, and uses `vm_read_overwrite` into one preallocated 64 KiB scratch
buffer (not ordinary `memcpy`). A failed kernel copy is a capture omission and
cannot escape into the real call path. SHA-256 and all comparisons operate only
on that scratch or on committed arena bytes. After
the call begins, neither wrapper nor worker reads the caller object or byte
pointer. Nested pointers are not followed; the blob is opaque DXIL bytes.

If validation, hashing, reservation, or copying fails, capture is omitted and
the original call still executes exactly once with every original argument. The
failure never suppresses, retries, delays, replaces, or changes the returned
object or error semantics.

## Fixed storage and deterministic limits

- 16 blob descriptors and exactly 1,048,576 bytes of raw blob arena.
- One preallocated 64 KiB scratch buffer and one atomic capture lock serialize
  candidate extraction; a busy lock records `scratch_busy` and forwards the
  original call without capture. The scratch is outside the raw arena and is
  included in the fixed process-lifetime memory ceiling.
- 32 capture records and 32 omission records; all are fixed-size and allocated
  before GOT installation. No heap growth occurs after initialization.
- Every qualifying sighting consumes one record. A duplicate SHA-256 plus equal
  length reuses the existing blob; byte-for-byte comparison resolves digest
  collisions. New blob allocation is committed only after the full copy. There
  is no losing arena reservation: the capture lock serializes lookup and
  commit, so only committed bytes count against the payload budget.
- Priority is `record_cap`, then `shader_size_cap`, then `payload_budget`, then
  `blob_cap`; no partial blob is published. Omission counters saturate and a
  manifest `complete=false` bit records any omission.
- Records are fixed binary entries containing sequence (u64), blob id (u16 or
  0xffff), size (u32), SHA-256 (32 bytes), error-code unknown (u32 sentinel
  0xffffffff), result-null unknown (u8 sentinel 2), caller offset (u32), and
  omission reason (u8). The manifest header contains schema version, counts,
  payload bytes, saturated omission counters, and `complete` (u8). Records are
  emitted in sequence order; Stage/PSO are optional
  and are never read from caller memory after handoff.

## Concurrency and publication

Reservations use atomic counters/CAS. A record is unpublished until its blob
id, size, digest, and reason fields are fully written; release publication is
paired with acquire reads by the worker. A bounded nonblocking event pipe carries
record indices only. Pipe-full disables capture publication but leaves the real
CompileAndLink call untouched. The worker writes only the fixed manifest schema;
it cannot compile, patch, retry, or invoke provider APIs.

## Evidence boundary

Independent counters classify `create_state_object`, `build_blas`, `refit_blas`,
`build_tlas`, `refit_tlas`, `dispatch_rays`, and `composite` activity. These are
activity observations only. Nonzero `dispatch_rays` or captured DXIL never proves
that RT contributed correctly to the final image; the white-frame run remains a
visual failure.
