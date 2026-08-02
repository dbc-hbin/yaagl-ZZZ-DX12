# D3DMetal 4.0b2 RT state-object branch trap (2026-08-01)

## Purpose

Unity normalizes the four D3DMetal state-object failure HRESULT tags back to
`E_INVALIDARG`, so the previous tag probe could not identify the rejecting
branch. This one-run diagnostic replaces each failure store with a fixed-width
`UD2` followed by NOP padding. The crash RIP therefore identifies the first
actual RT rejection without allowing an invalid state object to continue.

## Branch map

| Image-relative RIP | Stage |
| --- | --- |
| `0x0ae4ab` | descriptor parser |
| `0x121798` | export/config precheck |
| `0x12275f` | pipeline-config inheritance |
| `0x122813` | shader-config inheritance |

The pristine executable SHA-256 is
`f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`.
The signed trap executable SHA-256 is
`397ad81e5cb18e4556fe04eaeb6d1fc43209e822810d0278cc151a8476aeffc4`.

## Verification

- Patcher tests: 8/8 passed, including the real pristine binary boundary check.
- TypeScript/Vitest: passed.
- Framework `codesign --verify --deep --strict`: passed.
- Runtime transaction install/status/restore: passed.
- GPTK cache remained pristine throughout.

## Controlled-run result

The real launcher rebuilt its Wine runtime and prefix before the diagnostic
run. The game then stopped at a newly presented terms/privacy acceptance UI,
before RT state-object construction. No agreement was accepted and no branch
trap fired. The game was terminated, the diagnostic runtime was restored, and
both active and cached D3DMetal frameworks were verified pristine.

The next run should reinstall `install-traps` only after the user has completed
that product-owned agreement screen. After the first crash, subtract the loaded
D3DMetal image base from RIP and apply the branch map above. Restore the
pristine runtime immediately after collecting the crash evidence.

## Secondary crash finding

The earlier `SetRenderVertexBuffers` crash is independently explained by a
failed/no-op graphics PSO. Its constructor skips `InitVertexState`, leaving the
16-bit field at `+0x28c` uninitialized; observed values matched the high 16 bits
of the PSO heap pointer. A producer-side zero initialization is semantically
correct, but no safe same-size insertion exists in the inspected constructor.
Do not trade RT compatibility for a speculative constructor rewrite.
