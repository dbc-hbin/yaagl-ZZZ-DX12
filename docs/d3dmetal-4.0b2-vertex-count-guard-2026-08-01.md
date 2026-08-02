# D3DMetal 4.0b2 vertex-count guard

## Outcome

The first crash diagnostic patch is implemented. It preserves the original
`SetRenderVertexBuffers()` behavior for counts `0..32` and executes a unique
`UD2` at image offset `0xe1b13` before allocation or table indexing for any
unsigned count greater than 32.

The real product launch loaded the signed guard framework, reached D3D12 with
`supportsRayTracing = 1`, and then stopped at a new HoYoVerse Terms of Service
and Privacy Policy consent screen. No RTPSO attempt, guard trap, or native crash
occurred in that run. The game was terminated and both active/cache runtimes
were verified pristine afterward.

## Crash evidence addressed

Three minidumps map to
`D3D12GraphicsCommandListMPL::SetRenderVertexBuffers()`:

| Crash | Image offset | Raw `+0x28c` count |
| --- | ---: | ---: |
| `Crash_2026-07-31_161523935` | `0xe1b4f` | `65535` |
| `Crash_2026-08-01_032109423` | `0xe1b4f` | `32709` |
| `Crash_2026-08-01_041940492` | `0xe1b43` | `65535` |

The latest effective address `[rbx+rsi+0x3f0]` equals the Wine fault address
`0x7fbfba000000`. The normal producer initializes the field to zero or stores
`max input slot + 1`, so the observed values are not valid IA counts.

## Exact binary rewrite

- Pristine SHA-256:
  `f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad`
- Signed guard SHA-256:
  `380e0897fa881cc7a350e8f862708316ad6db6afb6a631e9b64cfe691b00118e`
- Replaced range: `[0xe1b0d, 0xe1b43)`, exactly 54 bytes
- Trap: `0xe1b13`
- Zero-count return target: `0xe1b96`
- Normal resume target: `0xe1b43`
- Transient allocator target: `0xd2b1c`

The replacement does not use a code cave. It keeps `rsp` fixed, preserves the
original sret stack slots, computes `count * 16` and `count * 40` with bounded
32-bit `imul`, and establishes the same loop-entry registers and flags.

## Files

- `scripts/d3dmetal-rtxgi-patch.mjs`
- `scripts/d3dmetal-rtxgi-patch.test.mjs`
- `scripts/d3dmetal-rtxgi-runtime.sh`
- `src/wine/d3dmetal.ts`
- `src/wine/d3dmetal.spec.ts`
- `build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.guard`

## Verification

- Node patcher tests: 4/4 passed
- D3DMetal runtime contract tests: 6/6 passed
- TypeScript: passed
- ESLint on changed TypeScript: passed
- `naposdx12` Vite build: passed
- Patched disassembly: branch, call, trap, and resume targets verified
- Independent ABI/unwind review: accepted after replacing an earlier transient
  `rsp` design with fixed-stack loads
- Deep/strict codesign: passed
- Isolated transactional install/status/restore: passed
- Real runtime transactional install and final pristine restore: passed

## Real run

- Run ID: `1785561213568`
- Renderer: D3D12
- DXR capability: supported
- RTPSO attempts: 0
- Guard traps: 0
- Crash: none
- Stop reason: `Combo.OverseaProtocol` legal-consent UI

The next run must occur only after the user personally handles that consent
screen. Install with `./scripts/d3dmetal-rtxgi-runtime.sh install-guard`, enter
the previously crashing scene once, capture the dump/log bundle if the unique
trap fires, and immediately run `./scripts/d3dmetal-rtxgi-runtime.sh restore`.
