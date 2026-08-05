import { join } from "path-browserify";
import {
  exec,
  fileOrDirExists,
  mkdirp,
  removeFileIfExists,
  resolve,
} from "@utils";
import {
  GPTK_CACHED_LIBRARY_DIRECTORY,
  GPTK_D3DMETAL_INFO_PLIST,
  GPTK_REQUIRED_RUNTIME_FILES,
} from "../gptk/constants";

export const D3DMETAL_VERSION = "4.0b2" as const;

export const D3DMETAL_4_0_BETA_2_SHA256 =
  "f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad" as const;

/**
 * The deterministic SHA-256 after applying the four failing-HRESULT tags and
 * ad-hoc signing the complete private framework. This diagnostic binary still
 * fails state-object creation; it only reports which beta 2 branch rejected it.
 */
export const D3DMETAL_4_0_BETA_2_FAILURE_TAGS_SHA256 =
  "9fdcba57a4c47ed7f444ed18bbe3bc6468361a6d43fb40ea178244aec2f7366d" as const;

/**
 * The signed SetRenderVertexBuffers diagnostic. Counts 0..32 preserve the
 * original path; an impossible unsigned count above 32 terminates at a unique
 * UD2 before transient allocation or table indexing.
 */
export const D3DMETAL_4_0_BETA_2_VERTEX_COUNT_GUARD_SHA256 =
  "380e0897fa881cc7a350e8f862708316ad6db6afb6a631e9b64cfe691b00118e" as const;

/** Signed diagnostic containing both the vertex-count guard and four tags. */
export const D3DMETAL_4_0_BETA_2_GUARD_FAILURE_TAGS_SHA256 =
  "4e09276dca738ca6c76922d24dd7c6f7dee0b021889776743a8322e137c8748a" as const;

/** Signed one-run diagnostic that traps at the first RT state-object rejection. */
export const D3DMETAL_4_0_BETA_2_STATE_OBJECT_TRAPS_SHA256 =
  "397ad81e5cb18e4556fe04eaeb6d1fc43209e822810d0278cc151a8476aeffc4" as const;

/** Signed producer-side fix for the no-op graphics PSO vertex-count invariant. */
export const D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256 =
  "4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851" as const;

/**
 * Signed experiment with the no-op PSO fix retained and the GPTK 4.0b2
 * Metal IR converter patched at the three FP64 codec sites.
 */
export const D3DMETAL_4_0_BETA_2_FP64_CODEC_PATCH_SHA256 =
  "6b9bd455eb0d11472380008dc025edc4b2aa1f11dceceebfa4d241e57e2a773c" as const;

/** Signed diagnostic that traps with EAX at CreateStateObject's return edge. */
export const D3DMETAL_4_0_BETA_2_STATE_OBJECT_RETURN_TRAP_SHA256 =
  "f19a6b89a668eefd628a8b95126b8099dfae7b2e85861710498be0e57e46b5fb" as const;

/** Signed parser-result plus failure-return phase discriminator. */
export const D3DMETAL_4_0_BETA_2_STATE_OBJECT_PARSER_PHASE_TRAP_SHA256 =
  "ea8d4e5d11a01b2871125999679d59495f21663f11d66b31c9f1e6f060ea21ee" as const;

/** Signed inheritance-status plus failure-return phase discriminator. */
export const D3DMETAL_4_0_BETA_2_STATE_OBJECT_INHERITANCE_RESULT_TRAP_SHA256 =
  "699547e5c3f2f503705e6bc5809a2d21dbd2fc3d53461c07b4c8e9249bb695a3" as const;

/** Signed no-op stability fix plus three CompileNewResolvedExports store traps. */
export const D3DMETAL_4_0_BETA_2_NO_OP_FIX_COMPILE_EXPORT_STORE_TRAPS_SHA256 =
  "0a1e2effe8f534f897436545917019d0279aecaa8e86847cfb9a9bd2bc17f904" as const;

/** Signed no-op fix plus fail-closed CreateFunction null-origin traps. */
export const D3DMETAL_4_0_BETA_2_NO_OP_FIX_CREATE_FUNCTION_NULL_TRAPS_SHA256 =
  "bf9a75b515d549b43943793e3c00000206dadbd8e086946f3e786a697746023a" as const;

/** Signed fresh IR-link null trap plus outer CompileRTFunction fallback. */
export const D3DMETAL_4_0_BETA_2_NO_OP_FIX_IR_LINK_FALLBACK_SHA256 =
  "db27ff847589670c701937392a63c0f9411b3411c77df224d6d066bae44deecb" as const;

export const D3DMETAL_FRAMEWORK_RUNTIME_PATH =
  "external/D3DMetal.framework/D3DMetal" as const;
export const D3DMETAL_FRAMEWORK_RUNTIME_CANONICAL_PATH =
  "lib/external/D3DMetal.framework/Versions/A/D3DMetal" as const;

const WINDOWS_LIBRARIES = [
  "d3d10.dll",
  "d3d11.dll",
  "d3d12.dll",
  "dxgi.dll",
  "nvapi64.dll",
] as const;

const UNIX_LIBRARIES = [
  "d3d10.so",
  "d3d11.so",
  "d3d12.so",
  "dxgi.so",
  "nvapi64.so",
] as const;

/**
 * GPTK 4.0b2 ships nvapi64.dll with the PE export name `nvapi.dll`.
 * Wine 11 pairs builtin PE/Unix modules by that export name, so both aliases
 * are required for the PE module to find its Unix call implementation.
 */
export const D3DMETAL_NVAPI_RUNTIME_ALIASES = [
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
] as const;

const D3DMETAL_CORE_LAUNCH_ENVIRONMENT = {
  WINE_ENABLE_TIMEOUT_FIX: "1",
  WINEMSYNC: "1",
  CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
  D3DM_MTL4: "1",
  D3DM_ENABLE_METALFX: "1",
  D3DM_SUPPORT_DXR: "1",
} as const;

/**
 * DXGI identities exposed by the pure GPTK path. These only select the
 * application-visible NVIDIA profile; Metal execution remains on the host GPU.
 */
export const ZZZ_D3DMETAL_GPU_SPOOFS = {
  rtx4060: {
    id: "rtx4060",
    label: "NVIDIA GeForce RTX 4060",
    vendorId: "0x10de",
    deviceId: "0x2882",
  },
  rtx5060: {
    id: "rtx5060",
    label: "NVIDIA GeForce RTX 5060",
    vendorId: "0x10de",
    deviceId: "0x2d05",
  },
} as const;

export type ZzzD3DMetalGpuSpoof = keyof typeof ZZZ_D3DMETAL_GPU_SPOOFS;
export const DEFAULT_ZZZ_D3DMETAL_GPU_SPOOF = "rtx4060" as const;

export function resolveZzzD3DMetalGpuSpoof(
  value: string | undefined
): ZzzD3DMetalGpuSpoof {
  return value === "rtx5060" ? value : DEFAULT_ZZZ_D3DMETAL_GPU_SPOOF;
}

export function createD3DMetalLaunchEnvironment(gpuSpoof?: string) {
  const selected =
    ZZZ_D3DMETAL_GPU_SPOOFS[resolveZzzD3DMetalGpuSpoof(gpuSpoof)];
  return {
    ...D3DMETAL_CORE_LAUNCH_ENVIRONMENT,
    D3DM_VENDOR_ID: selected.vendorId,
    D3DM_DEVICE_ID: selected.deviceId,
    D3DM_DEVICE_DESCRIPTION: selected.label,
  } as const;
}

/** The default profile is retained for static settings/status presentation. */
export const D3DMETAL_LAUNCH_ENVIRONMENT = createD3DMetalLaunchEnvironment();

export const ZZZ_D3D12_SELECTOR = "-use-d3d12" as const;

/** Variables used by YAAGL's other graphics backends that must not leak in. */
export const D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST = [
  "WINEDLLOVERRIDES",
  "WINEDLLPATH_PREPEND",
  "DXMT_CONFIG",
  "DXMT_CONFIG_FILE",
  "DXMT_LOG_PATH",
  "DXMT_ENABLE_NVEXT",
  "DXVK_CONFIG_FILE",
  "DXVK_LOG_PATH",
  "DXVK_STATE_CACHE_PATH",
  "VK_ICD_FILENAMES",
  "VK_DRIVER_FILES",
  "VK_LAYER_PATH",
  "MVK_ALLOW_METAL_FENCES",
  "MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS",
  "DYLD_INSERT_LIBRARIES",
  "YAAGL_DYLD_INSERT_LIBRARIES",
] as const;

/** Starts a clean GPTK process without inherited DYLD interposition. */
export function createD3DMetalIsolatedCommand(
  executable: string,
  args: readonly string[]
) {
  // Neutralino's command builder preserves one argv item but serializes raw
  // newlines as backslash-n, so keep the -c program on one line.
  const script =
    `unset ${D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST.join(" ")}; ` +
    `exec "$@"`;
  return ["/bin/sh", "-c", script, "yaagl-d3dmetal-env", executable, ...args];
}

export function createD3DMetalLaunchArguments(
  gameExecutablePath: string,
  forceDirect3D12: boolean
) {
  return forceDirect3D12
    ? [gameExecutablePath, ZZZ_D3D12_SELECTOR]
    : [gameExecutablePath];
}

export function d3dMetalWineRuntimePath(sourceRelativePath: string) {
  return sourceRelativePath
    .replace("nvngx-on-metalfx.so", "nvngx.so")
    .replace("nvngx-on-metalfx.dll", "nvngx.dll");
}

export function isAllowedD3DMetalRuntimeHashPair({
  sourceRelativePath,
  sourceHash,
  targetHash,
}: {
  sourceRelativePath: string;
  sourceHash: string;
  targetHash: string;
}) {
  if (sourceHash === targetHash) return true;
  return (
    sourceRelativePath === D3DMETAL_FRAMEWORK_RUNTIME_PATH &&
    sourceHash === D3DMETAL_4_0_BETA_2_SHA256 &&
    (targetHash === D3DMETAL_4_0_BETA_2_FAILURE_TAGS_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_VERTEX_COUNT_GUARD_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_GUARD_FAILURE_TAGS_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_STATE_OBJECT_TRAPS_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_FP64_CODEC_PATCH_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_STATE_OBJECT_RETURN_TRAP_SHA256 ||
      targetHash ===
        D3DMETAL_4_0_BETA_2_STATE_OBJECT_PARSER_PHASE_TRAP_SHA256 ||
      targetHash ===
        D3DMETAL_4_0_BETA_2_STATE_OBJECT_INHERITANCE_RESULT_TRAP_SHA256 ||
      targetHash ===
        D3DMETAL_4_0_BETA_2_NO_OP_FIX_COMPILE_EXPORT_STORE_TRAPS_SHA256 ||
      targetHash ===
        D3DMETAL_4_0_BETA_2_NO_OP_FIX_CREATE_FUNCTION_NULL_TRAPS_SHA256 ||
      targetHash === D3DMETAL_4_0_BETA_2_NO_OP_FIX_IR_LINK_FALLBACK_SHA256)
  );
}

export function assertD3DMetalRuntimeAliasTarget({
  alias,
  expectedTarget,
  actualTarget,
}: {
  alias: string;
  expectedTarget: string;
  actualTarget: string;
}) {
  if (actualTarget !== expectedTarget) {
    throw new Error(
      `D3DMetal runtime alias mismatch: ${alias} must target ${expectedTarget}, found ${
        actualTarget || "missing"
      }`
    );
  }
}

export function assertD3DMetalVersion(
  version: string
): asserts version is typeof D3DMETAL_VERSION {
  if (version !== D3DMETAL_VERSION) {
    throw new Error(
      `Expected D3DMetal ${D3DMETAL_VERSION}, found ${version || "missing"}`
    );
  }
}

async function sha256File(target: string) {
  const result = await exec(["/usr/bin/shasum", "-a", "256", target]);
  const match = /^([a-f0-9]{64})\s/i.exec(result.stdOut.trim());
  if (!match) {
    throw new Error(`Unable to read SHA-256 for D3DMetal artifact: ${target}`);
  }
  return match[1].toLowerCase();
}

/**
 * Overlays a validated GPTK cache onto an extracted YAAGL Wine tree.
 * This function never mutates the cache and should only target a staging tree.
 */
export async function overlayD3DMetalRuntime({
  runtimeRoot,
  wineRoot,
}: {
  runtimeRoot: string;
  wineRoot: string;
}) {
  const runtimeLib = join(runtimeRoot, "lib");
  const targetLib = join(wineRoot, "lib");
  await mkdirp(targetLib);

  await exec([
    "/usr/bin/ditto",
    join(runtimeLib, "external"),
    join(targetLib, "external"),
  ]);
  await exec([
    "/usr/bin/ditto",
    join(runtimeLib, "wine"),
    join(targetLib, "wine"),
  ]);

  const unixDir = join(targetLib, "wine", "x86_64-unix");
  const windowsDir = join(targetLib, "wine", "x86_64-windows");
  await removeFileIfExists(join(unixDir, "nvngx.so"));
  await removeFileIfExists(join(windowsDir, "nvngx.dll"));
  await exec([
    "/bin/mv",
    "-f",
    join(unixDir, "nvngx-on-metalfx.so"),
    join(unixDir, "nvngx.so"),
  ]);
  await exec([
    "/bin/mv",
    "-f",
    join(windowsDir, "nvngx-on-metalfx.dll"),
    join(windowsDir, "nvngx.dll"),
  ]);

  for (const alias of D3DMETAL_NVAPI_RUNTIME_ALIASES) {
    const directory = join(targetLib, "wine", alias.directory);
    const aliasPath = join(directory, alias.alias);
    await removeFileIfExists(aliasPath);
    await exec(["/bin/ln", "-s", alias.target, aliasPath]);
  }

  await validateD3DMetalWine(wineRoot, runtimeRoot);
}

export async function validateD3DMetalWine(
  wineRoot: string,
  runtimeRoot?: string
): Promise<typeof D3DMETAL_VERSION> {
  const wineLib = join(wineRoot, "lib", "wine");
  const required = [
    ...WINDOWS_LIBRARIES.map(file => join(wineLib, "x86_64-windows", file)),
    ...UNIX_LIBRARIES.map(file => join(wineLib, "x86_64-unix", file)),
    join(wineLib, "x86_64-windows", "nvngx.dll"),
    join(wineLib, "x86_64-unix", "nvngx.so"),
    join(wineRoot, "lib", "external", "libd3dshared.dylib"),
    join(wineRoot, "lib", "external", "D3DMetal.framework", "D3DMetal"),
    join(wineRoot, "lib", GPTK_D3DMETAL_INFO_PLIST),
  ];

  for (const path of required) {
    if (!(await fileOrDirExists(path))) {
      throw new Error(`Incomplete D3DMetal Wine overlay: ${path}`);
    }
  }

  for (const alias of D3DMETAL_NVAPI_RUNTIME_ALIASES) {
    const aliasPath = join(wineLib, alias.directory, alias.alias);
    let actualTarget = "";
    try {
      actualTarget = (
        await exec(["/usr/bin/readlink", aliasPath])
      ).stdOut.trim();
    } catch {
      throw new Error(`Missing D3DMetal runtime alias: ${aliasPath}`);
    }
    assertD3DMetalRuntimeAliasTarget({
      alias: aliasPath,
      expectedTarget: alias.target,
      actualTarget,
    });
  }

  await exec([
    "/usr/bin/codesign",
    "--verify",
    "--deep",
    "--strict",
    resolve(join(wineRoot, "lib", "external", "D3DMetal.framework")),
  ]);

  const version = await exec([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Print :CFBundleShortVersionString",
    join(wineRoot, "lib", GPTK_D3DMETAL_INFO_PLIST),
  ]);
  const validatedVersion = version.stdOut.trim();
  assertD3DMetalVersion(validatedVersion);

  if (runtimeRoot) {
    for (const sourceRelativePath of GPTK_REQUIRED_RUNTIME_FILES) {
      const source = join(
        runtimeRoot,
        GPTK_CACHED_LIBRARY_DIRECTORY,
        sourceRelativePath
      );
      const target = join(
        wineRoot,
        "lib",
        d3dMetalWineRuntimePath(sourceRelativePath)
      );
      const [sourceHash, targetHash] = await Promise.all([
        sha256File(source),
        sha256File(target),
      ]);
      if (
        !isAllowedD3DMetalRuntimeHashPair({
          sourceRelativePath,
          sourceHash,
          targetHash,
        })
      ) {
        throw new Error(
          `D3DMetal Wine overlay hash mismatch: ${d3dMetalWineRuntimePath(
            sourceRelativePath
          )}`
        );
      }
    }
  }
  return validatedVersion;
}
