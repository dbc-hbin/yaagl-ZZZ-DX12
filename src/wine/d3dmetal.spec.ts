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
  D3DMETAL_4_0_BETA_2_FP64_CODEC_PATCH_SHA256,
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
  D3DMETAL_NVAPI_RUNTIME_ALIASES,
  DEFAULT_ZZZ_D3DMETAL_GPU_SPOOF,
  createD3DMetalLaunchEnvironment,
  isAllowedD3DMetalRuntimeHashPair,
  resolveZzzD3DMetalGpuSpoof,
  ZZZ_D3D12_SELECTOR,
  ZZZ_D3DMETAL_GPU_SPOOFS,
} from "./d3dmetal";

describe("D3DMetal clean environment", () => {
  it("clears DYLD interposition and forwards exact argv", () => {
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
    expect(command[2]).toContain("DYLD_INSERT_LIBRARIES");
    expect(command[2]).toContain("YAAGL_DYLD_INSERT_LIBRARIES");
    expect(command[2]).not.toContain("export DYLD_INSERT_LIBRARIES");
    expect(command[2]).toContain("unset WINEDLLOVERRIDES");
    expect(command[2]).toContain('exec "$@"');
  });
});

describe("D3DMetal launch contract", () => {
  it("adds ZZZ's Direct3D 12 selector only when requested", () => {
    expect(ZZZ_D3D12_SELECTOR).toBe("-use-d3d12");
    expect(
      createD3DMetalLaunchArguments(
        "Z:\\Games\\ZenlessZoneZero.exe",
        true
      )
    ).toEqual(["Z:\\Games\\ZenlessZoneZero.exe", "-use-d3d12"]);
    expect(
      createD3DMetalLaunchArguments(
        "Z:\\Games\\ZenlessZoneZero.exe",
        false
      )
    ).toEqual(["Z:\\Games\\ZenlessZoneZero.exe"]);
  });

  it("keeps the default RTX 4060 MetalFX invariants enabled", () => {
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

  it("selects an exact supported RTX 5060 profile", () => {
    expect(DEFAULT_ZZZ_D3DMETAL_GPU_SPOOF).toBe("rtx4060");
    expect(resolveZzzD3DMetalGpuSpoof("unknown")).toBe("rtx4060");
    expect(ZZZ_D3DMETAL_GPU_SPOOFS.rtx5060).toEqual({
      id: "rtx5060",
      label: "NVIDIA GeForce RTX 5060",
      vendorId: "0x10de",
      deviceId: "0x2d05",
    });
    expect(createD3DMetalLaunchEnvironment("rtx5060")).toEqual({
      WINE_ENABLE_TIMEOUT_FIX: "1",
      WINEMSYNC: "1",
      CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
      D3DM_MTL4: "1",
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
      D3DM_VENDOR_ID: "0x10de",
      D3DM_DEVICE_ID: "0x2d05",
      D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 5060",
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
        targetHash: D3DMETAL_4_0_BETA_2_FP64_CODEC_PATCH_SHA256,
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
