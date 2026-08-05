# Local Yaagl D3DMetal Wine runtime

This local runtime preserves Yaagl's upstream `wine/` archive layout while fixing the launch profile to:

- Wine 11.0 CrossOver experimental
- GPTK 4.0 beta 2 D3DMetal
- verified FP64 codec patch
- NVIDIA GeForce RTX 5060 identity (`10de:2d05`)
- Metal 4, MetalFX, and DXR enabled
- no renderer command-line injection; the ZZZ launcher option controls Direct3D 12
- no DXMT `winemetal` runtime module

The wrapper accepts both direct/Steam-style launches and upstream Yaagl's `cmd /c config.bat` launch. It never adds `-use-d3d12` or another game argument. Upstream Yaagl temporarily replaces `d3d10core.dll`, `d3d11.dll`, and `dxgi.dll` with DXMT before launch; the wrapper restores the saved D3DMetal modules for the ZZZ process while retaining Yaagl's `.bak` files for its normal post-game rollback.

The build refuses to package a source tree whose active D3D modules match an unverified or temporarily swapped runtime. DXMT's `winemetal.so`/`winemetal.dll` files are explicitly excluded. Wine's generic Vulkan loader and GStreamer Vulkan support remain because they are shared Wine/media components, not DXMT.

The launcher exposes **Launch with Direct3D 12** in the ZZZ game settings. It is disabled by default and persists under `config_nap_force_direct3d12`. When enabled, only ZZZ receives `-use-d3d12`, regardless of which Wine distribution is selected.

Build:

```sh
scripts/build-local-d3dmetal-wine-runtime.sh
```

Install after quitting Yaagl and Wine:

```sh
scripts/install-local-d3dmetal-wine-runtime.sh \
  build/local-d3dmetal-wine-runtime/wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060.tar.xz
```

Installation moves the previous runtime into Yaagl's `recovery/` directory. To roll back, quit Yaagl, move the installed `wine` directory aside, and move the reported recovery directory back to `wine`.

Yaagl may replace this runtime when its Wine distribution is reinstalled or updated. The archive is intended for local use and contains Apple GPTK components subject to Apple's license; do not redistribute it.
