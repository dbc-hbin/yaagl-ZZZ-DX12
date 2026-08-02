import { describe, expect, it } from "vitest";
import {
  createD3DMetalIsolatedCommand,
  assertD3DMetalRuntimeAliasTarget,
  assertD3DMetalVersion,
  createD3DMetalLaunchArguments,
  d3dMetalWineRuntimePath,
  D3DMETAL_4_0_BETA_2_FAILURE_TAGS_SHA256,
  D3DMETAL_4_0_BETA_2_GUARD_FAILURE_TAGS_SHA256,
  D3DMETAL_4_0_BETA_2_SHA256,
  D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256,
  D3DMETAL_4_0_BETA_2_STATE_OBJECT_RETURN_TRAP_SHA256,
  D3DMETAL_4_0_BETA_2_STATE_OBJECT_PARSER_PHASE_TRAP_SHA256,
  D3DMETAL_4_0_BETA_2_STATE_OBJECT_INHERITANCE_RESULT_TRAP_SHA256,
  D3DMETAL_4_0_BETA_2_NO_OP_FIX_COMPILE_EXPORT_STORE_TRAPS_SHA256,
  D3DMETAL_4_0_BETA_2_NO_OP_FIX_CREATE_FUNCTION_NULL_TRAPS_SHA256,
  D3DMETAL_4_0_BETA_2_NO_OP_FIX_IR_LINK_FALLBACK_SHA256,
  D3DMETAL_4_0_BETA_2_STATE_OBJECT_TRAPS_SHA256,
  D3DMETAL_4_0_BETA_2_VERTEX_COUNT_GUARD_SHA256,
  D3DMETAL_FRAMEWORK_RUNTIME_PATH,
  D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST,
  D3DMETAL_LAUNCH_ENVIRONMENT,
  D3DMETAL_ZZZ_RT_SHIM_MODE,
  D3DMETAL_ZZZ_RT_SHIM_RELATIVE_PATH,
  createD3DMetalLaunchEnvironment,
  createD3DMetalZzzRtShimEnvironment,
  D3DMETAL_NVAPI_RUNTIME_ALIASES,
  isAllowedD3DMetalRuntimeHashPair,
  ZZZ_D3D12_SELECTOR,
  createD3DMetalMetalIrEnvironment,
  D3DMETAL_METAL_IR_OBSERVER_MODE,
  D3DMETAL_METAL_IR_FUNCTIONAL_OBSERVER_MODE,
  D3DMETAL_METAL_IR_MULTICAPTURE_MODE,
  validateD3DMetalMetalIrCapture,
  D3DMETAL_METAL_IR_PROBE_SHA256,
} from "./d3dmetal";

describe("D3DMetal passive MetalIR capture contract", () => {
  it("rejects the superseded capture artifact identity", () => {
    expect(D3DMETAL_METAL_IR_PROBE_SHA256).not.toBe(
      "a097e6aa7d6f4c0d07f2934f5ad47456f2b1d21a27c4500f06bea12440082e5f"
    );
  });

  it("does not expose functional replacement bytes", () => {
    const environment = createD3DMetalMetalIrEnvironment({
      mode: D3DMETAL_METAL_IR_MULTICAPTURE_MODE,
      capturePath: "/tmp/capture.log",
      captureHash: "a".repeat(64),
      manifestPath: "/tmp/manifest.json",
      providerPath: "/tmp/provider.dylib",
      d3dMetalPath: "/tmp/D3DMetal",
      probePath: "/tmp/capture.dylib",
      replacementPath: "/tmp/must-not-leak.dxil",
      runId: "run-123",
      sourceRevision: "rev-abc",
      buildIdentity: "build-xyz",
    });
    expect(environment).toMatchObject({
      YAAGL_RUNTIME_MODE: "metal-ir-capture-v2",
      YAAGL_METAL_IR_CAPTURE_PATH: "/tmp/capture.log",
      YAAGL_METAL_IR_CAPTURE_SHA256: "a".repeat(64),
      YAAGL_METAL_IR_MANIFEST: "/tmp/manifest.json",
      YAAGL_METAL_IR_PROVIDER: "/tmp/provider.dylib",
      YAAGL_METAL_IR_D3DMETAL: "/tmp/D3DMetal",
      YAAGL_DYLD_INSERT_LIBRARIES: "/tmp/capture.dylib",
      YAAGL_METAL_IR_RUN_ID: "run-123",
      YAAGL_METAL_IR_SOURCE_REVISION: "rev-abc",
      YAAGL_METAL_IR_BUILD_ID: "build-xyz",
    });
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_REPLACEMENT");
  });

  it("keeps the active observer free of replacement and DXC inputs", () => {
    const environment = createD3DMetalMetalIrEnvironment({
      mode: D3DMETAL_METAL_IR_OBSERVER_MODE,
      capturePath: "/tmp/observer.log",
      captureHash: D3DMETAL_METAL_IR_PROBE_SHA256,
      d3dMetalHash: "d".repeat(64),
      providerHash: "e".repeat(64),
      manifestPath: "/tmp/unused-manifest.json",
      probePath: "/tmp/observer.dylib",
      providerPath: "/tmp/provider.dylib",
      d3dMetalPath: "/tmp/D3DMetal",
      dxcompilerPath: "/tmp/must-not-leak-dxc.dylib",
      replacementPath: "/tmp/must-not-leak.dxil",
    });
    expect(environment).toMatchObject({
      YAAGL_RUNTIME_MODE: "metal-ir-observe-v1",
      YAAGL_METAL_IR_CAPTURE_PATH: "/tmp/observer.log",
      YAAGL_METAL_IR_D3DMETAL_SHA256: "d".repeat(64),
      YAAGL_METAL_IR_PROVIDER_SHA256: "e".repeat(64),
      YAAGL_METAL_IR_PROVIDER: "/tmp/provider.dylib",
      YAAGL_METAL_IR_D3DMETAL: "/tmp/D3DMetal",
      YAAGL_DYLD_INSERT_LIBRARIES: "/tmp/observer.dylib",
    });
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_REPLACEMENT");
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_DXCOMPILER");
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_ACK_TOKEN");
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_ARM_DIR");
  });

  it("keeps the dormant functional mode's replacement contract intact", () => {
    const environment = createD3DMetalMetalIrEnvironment({
      mode: "metal-ir-unorm-fix-v2",
      capturePath: "/tmp/probe.log",
      captureHash: D3DMETAL_METAL_IR_PROBE_SHA256,
      d3dMetalHash: "d".repeat(64),
      providerHash: "e".repeat(64),
      manifestPath: "/tmp/manifest.json",
      probePath: "/tmp/probe.dylib",
      providerPath: "/tmp/provider.dylib",
      d3dMetalPath: "/tmp/D3DMetal",
      dxcompilerPath: "/tmp/libdxcompiler.dylib",
      replacementPath: "/tmp/replacement.dxil",
    });
    expect(environment).toMatchObject({
      YAAGL_RUNTIME_MODE: "metal-ir-unorm-fix-v2",
      YAAGL_METAL_IR_D3DMETAL_SHA256: "d".repeat(64),
      YAAGL_METAL_IR_PROVIDER_SHA256: "e".repeat(64),
      YAAGL_METAL_IR_REPLACEMENT: "/tmp/replacement.dxil",
      YAAGL_METAL_IR_DXCOMPILER: "/tmp/libdxcompiler.dylib",
      YAAGL_METAL_IR_PROVIDER: "/tmp/provider.dylib",
      YAAGL_METAL_IR_D3DMETAL: "/tmp/D3DMetal",
      YAAGL_DYLD_INSERT_LIBRARIES: "/tmp/probe.dylib",
    });
  });

  it("activates functional v2 with pass-through RT output observation", () => {
    const environment = createD3DMetalMetalIrEnvironment({
      mode: D3DMETAL_METAL_IR_FUNCTIONAL_OBSERVER_MODE,
      capturePath: "/tmp/combined.log",
      captureHash: D3DMETAL_METAL_IR_PROBE_SHA256,
      d3dMetalHash: "d".repeat(64),
      providerHash: "e".repeat(64),
      manifestPath: "/tmp/unused-manifest.json",
      probePath: "/tmp/probe.dylib",
      providerPath: "/tmp/provider.dylib",
      d3dMetalPath: "/tmp/D3DMetal",
      dxcompilerPath: "/tmp/libdxcompiler.dylib",
      replacementPath: "/tmp/replacement.dxil",
    });
    expect(environment).toMatchObject({
      YAAGL_RUNTIME_MODE: "metal-ir-unorm-fix-v2-rt",
      YAAGL_METAL_IR_REPLACEMENT: "/tmp/replacement.dxil",
      YAAGL_METAL_IR_DXCOMPILER: "/tmp/libdxcompiler.dylib",
      YAAGL_METAL_IR_PROVIDER: "/tmp/provider.dylib",
      YAAGL_METAL_IR_D3DMETAL: "/tmp/D3DMetal",
      YAAGL_DYLD_INSERT_LIBRARIES: "/tmp/probe.dylib",
    });
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_ACK_TOKEN");
    expect(environment).not.toHaveProperty("YAAGL_METAL_IR_ARM_DIR");
  });

  it("rejects an invalid capture before any signing check", async () => {
    await expect(
      validateD3DMetalMetalIrCapture({
        wineRoot: "/tmp/wine",
        capturePath: "/tmp/does-not-exist-capture.dylib",
        controlHelperPath: "/tmp/does-not-exist-capture-fs-helper",
        expectedHash: "pending-native-build",
      })
    ).rejects.toThrow();
  });
});

describe("D3DMetal SIP-safe environment bridge", () => {
  it("sets DYLD only inside the shell and forwards exact argv", () => {
    const command = createD3DMetalIsolatedCommand("/tmp/wine", [
      "steam.exe",
      "game path",
    ]);
    expect(command.slice(0, 2)).toEqual(["/bin/sh", "-c"]);
    expect(command.slice(-4)).toEqual([
      "yaagl-d3dmetal-env",
      "/tmp/wine",
      "steam.exe",
      "game path",
    ]);
    expect(command[2]).toContain(
      'export DYLD_INSERT_LIBRARIES="$YAAGL_DYLD_INSERT_LIBRARIES"'
    );
    expect(command[2]).toContain("unset WINEDLLOVERRIDES");
    expect(command[2]).toContain('exec "$@"');
  });
});

describe("D3DMetal launch contract", () => {
  it("uses ZZZ's Direct3D 12 selector", () => {
    expect(ZZZ_D3D12_SELECTOR).toBe("-use-d3d12");
    expect(
      createD3DMetalLaunchArguments("Z:\\Games\\ZenlessZoneZero.exe")
    ).toEqual(["Z:\\Games\\ZenlessZoneZero.exe", "-use-d3d12"]);
  });

  it("keeps the anti-cheat and MetalFX invariants enabled", () => {
    expect(D3DMETAL_LAUNCH_ENVIRONMENT).toEqual({
      WINE_ENABLE_TIMEOUT_FIX: "1",
      WINEMSYNC: "1",
      CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
      D3DM_MTL4: "1",
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
      D3DM_VENDOR_ID: "0x10de",
      D3DM_DEVICE_ID: "0x2882",
      D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 4060",
    });
    expect(D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST).toEqual(
      expect.arrayContaining([
        "WINEDLLOVERRIDES",
        "WINEDLLPATH_PREPEND",
        "DXMT_CONFIG",
        "DXMT_CONFIG_FILE",
        "DXMT_LOG_PATH",
        "DXMT_ENABLE_NVEXT",
        "VK_ICD_FILENAMES",
        "MVK_ALLOW_METAL_FENCES",
      ])
    );
  });

  it("offers the 4060 default and 5060 spoof without changing GPTK invariants", () => {
    expect(createD3DMetalLaunchEnvironment()).toMatchObject({
      D3DM_VENDOR_ID: "0x10de",
      D3DM_DEVICE_ID: "0x2882",
      D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 4060",
      D3DM_MTL4: "1",
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
    });
    expect(createD3DMetalLaunchEnvironment("rtx5060")).toMatchObject({
      D3DM_VENDOR_ID: "0x10de",
      D3DM_DEVICE_ID: "0x2d05",
      D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 5060",
      D3DM_MTL4: "1",
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
    });
  });

  it("uses only the minimal RT shim runtime contract", () => {
    expect(D3DMETAL_ZZZ_RT_SHIM_RELATIVE_PATH).toBe(
      "sidecar/runtime/libyaagl-zzz-rt-shim.dylib"
    );
    expect(
      createD3DMetalZzzRtShimEnvironment({
        shimPath: "/tmp/zzz-rt-shim.dylib",
        replacementPath: "/tmp/replacement.dxil",
        d3dMetalPath: "/tmp/D3DMetal",
        providerPath: "/tmp/provider.dylib",
        dxcompilerPath: "/tmp/libdxcompiler.dylib",
      })
    ).toEqual({
      YAAGL_RUNTIME_MODE: D3DMETAL_ZZZ_RT_SHIM_MODE,
      YAAGL_DYLD_INSERT_LIBRARIES: "/tmp/zzz-rt-shim.dylib",
      YAAGL_ZZZ_RT_SHIM_REPLACEMENT: "/tmp/replacement.dxil",
      YAAGL_ZZZ_RT_SHIM_D3DMETAL: "/tmp/D3DMetal",
      YAAGL_ZZZ_RT_SHIM_PROVIDER: "/tmp/provider.dylib",
      YAAGL_ZZZ_RT_SHIM_DXCOMPILER: "/tmp/libdxcompiler.dylib",
    });
  });

  it("maps the MetalFX NGX shim into Wine's nvngx module name", () => {
    expect(
      d3dMetalWineRuntimePath("wine/x86_64-windows/nvngx-on-metalfx.dll")
    ).toBe("wine/x86_64-windows/nvngx.dll");
    expect(
      d3dMetalWineRuntimePath("wine/x86_64-unix/nvngx-on-metalfx.so")
    ).toBe("wine/x86_64-unix/nvngx.so");
    expect(d3dMetalWineRuntimePath("wine/x86_64-windows/d3d12.dll")).toBe(
      "wine/x86_64-windows/d3d12.dll"
    );
  });

  it("pairs GPTK 4.0b2's NVAPI PE export name with its Unix module", () => {
    expect(D3DMETAL_NVAPI_RUNTIME_ALIASES).toEqual([
      {
        directory: "x86_64-windows",
        alias: "nvapi.dll",
        target: "nvapi64.dll",
      },
      {
        directory: "x86_64-unix",
        alias: "nvapi.so",
        target: "nvapi64.so",
      },
    ]);
    expect(() =>
      assertD3DMetalRuntimeAliasTarget({
        alias: "nvapi.dll",
        expectedTarget: "nvapi64.dll",
        actualTarget: "nvapi64.dll",
      })
    ).not.toThrow();
    expect(() =>
      assertD3DMetalRuntimeAliasTarget({
        alias: "nvapi.dll",
        expectedTarget: "nvapi64.dll",
        actualTarget: "nvapi.dll",
      })
    ).toThrow(
      "D3DMetal runtime alias mismatch: nvapi.dll must target nvapi64.dll, found nvapi.dll"
    );
  });

  it("accepts only GPTK 4.0 beta 2's D3DMetal version", () => {
    expect(() => assertD3DMetalVersion("4.0b2")).not.toThrow();
    expect(() => assertD3DMetalVersion("4.0b1")).toThrow(
      "Expected D3DMetal 4.0b2, found 4.0b1"
    );
  });

  it("allows only the exact signed beta 2 diagnostics", () => {
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: "wine/x86_64-windows/d3d12.dll",
        sourceHash: "a".repeat(64),
        targetHash: "a".repeat(64),
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_NO_OP_FIX_IR_LINK_FALLBACK_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash:
          D3DMETAL_4_0_BETA_2_NO_OP_FIX_CREATE_FUNCTION_NULL_TRAPS_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_STATE_OBJECT_RETURN_TRAP_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_STATE_OBJECT_PARSER_PHASE_TRAP_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash:
          D3DMETAL_4_0_BETA_2_STATE_OBJECT_INHERITANCE_RESULT_TRAP_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash:
          D3DMETAL_4_0_BETA_2_NO_OP_FIX_COMPILE_EXPORT_STORE_TRAPS_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_STATE_OBJECT_TRAPS_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_GUARD_FAILURE_TAGS_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_VERTEX_COUNT_GUARD_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_FAILURE_TAGS_SHA256,
      })
    ).toBe(true);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: "external/libd3dshared.dylib",
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: D3DMETAL_4_0_BETA_2_FAILURE_TAGS_SHA256,
      })
    ).toBe(false);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: "a".repeat(64),
        targetHash: D3DMETAL_4_0_BETA_2_FAILURE_TAGS_SHA256,
      })
    ).toBe(false);
    expect(
      isAllowedD3DMetalRuntimeHashPair({
        sourceRelativePath: D3DMETAL_FRAMEWORK_RUNTIME_PATH,
        sourceHash: D3DMETAL_4_0_BETA_2_SHA256,
        targetHash: "b".repeat(64),
      })
    ).toBe(false);
  });
});
