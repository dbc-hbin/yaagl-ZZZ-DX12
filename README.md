# Yaagl ZZZ D3DMetal

An experimental Apple Silicon fork of [Yaagl](https://github.com/yaagl/yet-another-anime-game-launcher) for evaluating the **Zenless Zone Zero OS** Windows build through Wine, Game Porting Toolkit 4.0 beta 2, and D3DMetal.

The current `main` branch is the single supported branch in this fork. The previous runtime shim and diagnostic branches have been retired after the shader failure was reduced to a narrow FP64 lowering defect in GPTK 4.0b2's Metal IR converter.

This is research software. Use a test account, preserve your game data, and expect breakage after game, macOS, Wine, or GPTK updates.

## Current scope

- Apple Silicon Mac
- macOS 27
- Zenless Zone Zero OS
- Wine 11.0 CrossOver experimental
- Game Porting Toolkit **4.0 beta 2** (`GPTK 4.0b2`)
- D3DMetal with Metal 4, MetalFX, and DXR enabled

ZZZ CN and the other games supported by upstream Yaagl have not been validated with this D3DMetal configuration.

## What is included

### FP64 codec patch

Twelve captured shaders failed in the original GPTK 4.0b2 converter with:

```text
error 19: Unhandled FP64 usage
```

The common sequence was an integer-to-double conversion followed by a short double-precision operation and truncation back to float. `scripts/metalir-fp64-codec-patch.mjs` applies a pinned, fail-closed binary patch to the verified GPTK 4.0b2 `libmetalirconverter.dylib` only.

The patcher verifies:

- the complete pristine converter SHA-256;
- all expected original instruction bytes;
- all patched instruction bytes after modification;
- rejection of unknown, partial, or already modified inputs.

The old per-shader shim, injected dylib, correction shader, and runtime interception path have been removed. This avoids their per-shader CPU and synchronization overhead.

### Launcher-owned Direct3D selection

The ZZZ game settings include **Launch with Direct3D 12**. It is disabled by default and adds `-use-d3d12` only when enabled.

Renderer selection belongs to the launcher, not the Wine runtime:

- other games receive no argument;
- other Wine distributions receive no forced renderer;
- disabling the option launches ZZZ without `-use-d3d12`;
- the setting is stored as `config_nap_force_direct3d12`.

### GPU identity and MetalFX

The launcher can expose controlled RTX 4060 or RTX 5060 DXGI identities. This changes the identity visible to the Windows game; rendering still occurs on the Mac GPU.

GPTK's `nvngx-on-metalfx` runtime maps the supported NGX/DLSS path to MetalFX. Capability detection and module loading do not by themselves prove that a particular frame used MetalFX, frame generation, or ray tracing; use the runtime evidence and Metal tools for that distinction.

### Patched local Wine runtime

The optional local runtime is named:

```text
Wine 11.0 D3DMetal Patched (GPTK 4.0b2, RTX 5060)
```

Archive and internal ID conventions:

```text
wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060.tar.xz
wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060
```

It preserves upstream Yaagl's top-level `wine/` archive layout and fixes the runtime profile to:

- GPTK 4.0b2 D3DMetal;
- the verified FP64 codec patch;
- NVIDIA GeForce RTX 5060 (`10de:2d05`);
- Metal 4, MetalFX, and DXR enabled;
- no renderer command-line injection;
- no DXMT `winemetal` module.

Generic Wine Vulkan components and GStreamer Vulkan support remain because they are shared Wine/media components, not DXMT. GPTK's `nvngx`, D3DMetal `dxgi`, `d3d11`, and `d3d12` modules are also not DXMT and are required.

## Requirements

Install these before building the launcher:

- Node.js 22
- pnpm 11
- Xcode Command Line Tools
- Neutralino dependencies downloaded by `neu update`
- the official `Game_Porting_Toolkit_4.0_beta_2.dmg`

Place the GPTK disk image in:

```text
~/Downloads/Game_Porting_Toolkit_4.0_beta_2.dmg
```

Apple's GPTK components are governed by Apple's license. Do not redistribute the generated Wine archive or extracted GPTK runtime.

## Build the launcher

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec neu update
cp dist/neutralino.js neutralino.js
pnpm run build:clients
```

The application is generated at:

```text
Yaagl ZZZ DX12.app
```

Verify the final bundle:

```sh
codesign --verify --deep --strict "Yaagl ZZZ DX12.app"
```

For a development run:

```sh
pnpm start-naposdx12
```

## First launch

On first launch, Yaagl imports the official GPTK 4.0b2 runtime and prepares the Wine prefix. The initial prefix setup runs Wine initialization; shader and pipeline caches are not precompiled at this stage.

D3DMetal creates its caches lazily when the game first supplies shaders, root signatures, and pipeline state descriptions. A cold-cache run can therefore stutter substantially. Preserve the D3DMetal cache between comparable runs unless the test explicitly requires a cold cache.

In the ZZZ game settings, enable **Launch with Direct3D 12** when testing the D3D12/D3DMetal path.

## Build the patched local Wine runtime

The runtime builder defaults to the active Yaagl Wine installation:

```text
~/Library/Application Support/Yaagl ZZZ DX12/wine
```

That source must already contain the verified FP64-patched converter and the expected D3DMetal PE modules. The build refuses unknown converter or module hashes and refuses to overwrite an existing output directory.

Build it with:

```sh
scripts/build-local-d3dmetal-wine-runtime.sh
```

The output is:

```text
build/local-d3dmetal-wine-runtime/
  wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060.tar.xz
  wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060.tar.xz.sha256
```

The builder verifies Wine and D3DMetal signatures, excludes recovery copies and DXMT `winemetal` files, validates the archive, and writes its SHA-256.

See [docs/local-d3dmetal-wine-runtime.md](docs/local-d3dmetal-wine-runtime.md) for the detailed runtime contract.

## Install or roll back the local runtime

Quit the game and Yaagl before installation:

```sh
scripts/install-local-d3dmetal-wine-runtime.sh \
  build/local-d3dmetal-wine-runtime/wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060.tar.xz
```

The installer validates the archive layout, patched converter hash, and Wine version before replacing anything. The previous runtime is moved to a dated directory under:

```text
~/Library/Application Support/Yaagl ZZZ DX12/recovery/
```

To roll back, quit Yaagl and Wine, move the installed `wine` directory aside, and restore the recovery directory reported by the installer as `wine`.

Yaagl may replace a local runtime during a Wine reinstall or update.

## Verification

Run the source-level checks:

```sh
pnpm exec tsc --noEmit
pnpm vitest run src/wine/d3dmetal.spec.ts
pnpm run test:metal-ir-fp64-patch
sidecar/local-wine/test-wine-launch-wrapper.sh
```

Inspect a converter without modifying it:

```sh
node scripts/metalir-fp64-codec-patch.mjs inspect \
  /path/to/libmetalirconverter.dylib
```

The included Windows probe can validate the DXGI identity, D3D12 device creation, and reported ray-tracing tier:

```sh
x86_64-w64-mingw32-g++ -std=c++17 \
  sidecar/local-wine/dxgi-identity-probe.cpp \
  -o dxgi-identity-probe.exe -ldxgi -ld3d12
```

The verified local profile reported:

```text
vendor=0x10de device=0x2d05
description=NVIDIA GeForce RTX 5060
d3d12_device=success
raytracing_tier=11
```

This proves API exposure and device creation, not visual correctness or actual feature use in every frame.

## Known limitations

- The binary patch is pinned to GPTK 4.0b2 and must reject other converter builds.
- The observed FP64 pattern is fixed, but this is not a claim of complete general FP64 lowering support.
- Cold shader and RT pipeline caches can cause severe first-run frame drops.
- D3DMetal, Wine, Rosetta, and game-side pipeline creation still add overhead compared with a native Metal port.
- Invalid index-buffer geometry may be excluded from Metal acceleration structures, reducing the visible scope of ray-traced effects.
- DXR/MetalFX capability logs do not prove successful ray dispatch, temporal upscaling, or frame generation.
- The local runtime has only been validated on the hardware and software profile used for this experiment.

## Logs and diagnostics

Runtime logs are stored under the Yaagl support directory:

```text
~/Library/Application Support/Yaagl ZZZ DX12/logs/
```

When comparing runs, record at least:

- game and launcher build;
- macOS and GPTK versions;
- Wine and D3DMetal hashes;
- GPU spoof profile;
- Direct3D 12 option state;
- cold or warm cache state;
- `Unhandled FP64 usage`, pipeline, Metal compile, and acceleration-structure errors.

Do not label a run clean or attribute a regression to a branch based only on the checked-out Git branch. Verify the active runtime binaries and launch profile as well.

## Repository layout

Relevant paths:

```text
scripts/metalir-fp64-codec-patch.mjs        pinned FP64 binary patcher
scripts/build-local-d3dmetal-wine-runtime.sh
scripts/install-local-d3dmetal-wine-runtime.sh
sidecar/local-wine/wine-launch-wrapper.sh
sidecar/local-wine/dxgi-identity-probe.cpp
src/clients/mhy/nap/config/direct3d12.tsx
src/wine/d3dmetal.ts
docs/local-d3dmetal-wine-runtime.md
```

Generated archives, imported GPTK files, Wine prefixes, caches, logs, and local recovery artifacts are not source and should not be committed.

## Support and upstream

This fork is not an official Apple, HoYoverse, CodeWeavers, or upstream Yaagl project. Upstream Yaagl's support channels are not responsible for this experimental D3DMetal runtime or binary patch.

For actionable reports, include a reproducible case, exact runtime hashes, relevant logs, and whether the cache was cold or warm. Generic launch failures without evidence are not sufficient for diagnosis.

## Related projects

- [Yaagl](https://github.com/yaagl/yet-another-anime-game-launcher)
- [DXMT](https://github.com/3Shain/dxmt)
- [anime-game-wine](https://github.com/yaagl/anime-game-wine)
- [Game Porting Toolkit](https://developer.apple.com/games/game-porting-toolkit/)

## License and acknowledgements

Retain the upstream project licenses and notices. GPTK and D3DMetal remain Apple components under Apple's terms. The launcher changes and helper scripts in this repository do not grant redistribution rights for Apple or game binaries.

Thanks to the upstream Yaagl, Wine, DXMT, and related compatibility-tooling contributors whose work made this investigation possible.
