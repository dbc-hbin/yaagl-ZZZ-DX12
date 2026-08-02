# D3DMetal 4.0b2 CompileNewResolvedExports store traps

## Evidence

The inheritance diagnostic run `1785573884280` produced
`Crash_2026-08-01_084527367` at `D3DMetal+0x36f8a2` with
`EAX=0x80070057`, a null state-object output, and wrapper return
`D3DMetal+0x65a62`. The inheritance trap at `D3DMetal+0x36f6a1` did not
fire. Parser, direct export precheck, and tested inheritance paths have therefore
passed for this workload.

`CompileNewResolvedExports` saves its output-only status pointer at
`[rsp+0xa0]` and has exactly three direct writes through that pointer:

| Store | Offset | Dominating null branch | Pristine bytes |
| --- | --- | --- | --- |
| A | `0x1234ab` | `0x122ec3 -> 0x1234a3` | `c7 00 57 00 07 80` |
| B | `0x123920` | `0x123320 -> 0x123918` | `c7 00 57 00 07 80` |
| C | `0x123955` | `0x12365f -> 0x12394d` | `c7 00 57 00 07 80` |

Each complete six-byte store is replaced in place with
`0f 0b 90 90 90 90`. A crash identifies only the first reached store A, B, or
C; semantic family naming remains deferred until its producer inputs are
captured.

## Combined stability fix

The three inline traps do not use a cave, so the validated no-op PSO producer
fix is included in the same artifact:

- edge `[0x10f6d5,0x10f6db)` becomes `0f 84 bf 01 26 00`;
- cave `[0x36f89a,0x36f8a9)` becomes
  `66 c7 83 8c 02 00 00 00 00 e9 f2 fe d9 ff 00`.

The old final-return edge at `0x69893` remains pristine
`8b 44 24 0c eb 0f`. The former trap RIP `0x36f8a2` is byte `00` inside the
validated no-op thunk postimage, not `UD2`.

## Outcome map

- `D3DMetal+0x1234ab`: first reached direct status store is A.
- `D3DMetal+0x123920`: first reached direct status store is B.
- `D3DMetal+0x123955`: first reached direct status store is C.
- No trap plus Player.log RTPSO `0x80070057`: the three direct stores did not
  localize the failure; this is inconclusive, not negative evidence.
- Any other crash or wrong loaded hash: invalid run.

## Review gates

Codex Architect returned `WATCH`, approving the bounded experiment with strict
artifact attribution. Codex Critic initially returned `ITERATE`; after the full
no-op cave map, predecessor/dominance checks, relocation scan, and no-trap log
channel were supplied, Critic returned `OKAY` with no remaining blocker.

- Architect: https://chatgpt.com/g/g-6a6c2c25638c819193c521156319a9e9-codex-architect/c/6a6db340-d0f4-83e8-a3a3-595f4dcf8d72
- Critic: https://chatgpt.com/g/g-6a6c2f72fbcc8191aa567362b0ccf3f6-codex-critic/c/6a6db341-6ba4-83ee-8eab-cc471c39bb99

## Artifact

- Pristine SHA-256: `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`
- Raw SHA-256: `36ee7c9dacacbecfd1653abb117751ac77c5864bd52e62269d8e1c1cdc7d4c41`
- Signed SHA-256: `0a1e2effe8f534f897436545917019d0279aecaa8e86847cfb9a9bd2bc17f904`
- Runtime command: `scripts/d3dmetal-rtxgi-runtime.sh install-compile-store-traps`

## Verification and installation

- Patcher tests: 18/18 passed.
- D3DMetal Vitest suite: 6/6 passed.
- TypeScript and runtime shell syntax: passed.
- Artifact and installed framework deep/strict codesign: passed.
- `Yaagl ZZZ DX12.app` rebuilt at 2026-08-01 18:00:15 +0900 and verified.
- Active runtime: `noop-fix+compile-export-store-traps`.
- Installed hash: `0a1e2effe8f534f897436545917019d0279aecaa8e86847cfb9a9bd2bc17f904`.
- Pristine backup and GPTK cache: pristine.
- D3DMetal was not loaded by any process at installation time.
