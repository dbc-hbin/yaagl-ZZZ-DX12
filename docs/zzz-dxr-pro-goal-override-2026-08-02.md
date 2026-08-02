# Goal override for the next Pro review

The only product goal is: **Zenless Zone Zero DX12 Raytracing must render
correctly on macOS.** City entry is a prerequisite for observing that result,
not a reason to avoid a real renderer fix.

The previous Pro review treated a self-imposed zero-delay/zero-render-
perturbation condition as a blocking contract. The user rejects that condition.
The next design may use bounded, reversible renderer instrumentation,
synchronization, copies, checksums, frame capture, or a targeted runtime
modification when they are needed to identify and repair the real defect.

Required constraints remain factual rather than prohibitive: preserve evidence,
do not fake RT success or mask failures, keep a recoverable baseline, and verify
the actual city image after each targeted change. The review must propose and,
where repository-scoped, implement a concrete path to a functional renderer
patch rather than stopping at BLOCK.
