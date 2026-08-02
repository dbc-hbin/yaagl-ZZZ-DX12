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

export const D3DMETAL_METAL_IR_OBSERVER_MODE = "metal-ir-observe-v1" as const;
export const D3DMETAL_METAL_IR_PROBE_MODE = "metal-ir-unorm-fix-v2" as const;
export const D3DMETAL_METAL_IR_FUNCTIONAL_OBSERVER_MODE =
  "metal-ir-unorm-fix-v2-rt" as const;
export const D3DMETAL_METAL_IR_MULTICAPTURE_MODE =
  "metal-ir-capture-v2" as const;
export type D3DMetalMetalIrMode =
  | typeof D3DMETAL_METAL_IR_OBSERVER_MODE
  | typeof D3DMETAL_METAL_IR_PROBE_MODE
  | typeof D3DMETAL_METAL_IR_FUNCTIONAL_OBSERVER_MODE
  | typeof D3DMETAL_METAL_IR_MULTICAPTURE_MODE;
export const D3DMETAL_METAL_IR_PROBE_RELATIVE_PATH =
  "sidecar/diagnostics/libyaagl-metal-ir-capture.dylib" as const;
export const D3DMETAL_METAL_IR_CAPTURE_RELATIVE_PATH =
  D3DMETAL_METAL_IR_PROBE_RELATIVE_PATH;
export const D3DMETAL_CAPTURE_FS_HELPER_RELATIVE_PATH =
  "sidecar/diagnostics/yaagl-capture-fs-helper" as const;
export const D3DMETAL_METAL_IR_CONVERTER_RELATIVE_PATH =
  "lib/external/D3DMetal.framework/Versions/A/Resources/libmetalirconverter.dylib" as const;
export const D3DMETAL_DXCOMPILER_RELATIVE_PATH =
  "lib/external/D3DMetal.framework/Versions/A/Resources/libdxcompiler.dylib" as const;
export const D3DMETAL_METAL_IR_PROBE_SHA256 =
  "6ef49cfefebf611df13b557e8d06898ced43b365971244fa068da34343d0b862" as const;
export const D3DMETAL_METAL_IR_CAPTURE_SHA256 =
  D3DMETAL_METAL_IR_PROBE_SHA256;
export const D3DMETAL_METAL_IR_CONVERTER_SHA256 =
  "75974d49ad4dd1bdf17ab3cd666ae7cac43e7f7a5760237699ab33ecd3d31daf" as const;
export const D3DMETAL_DXCOMPILER_SHA256 =
  "57dc9421af62c35b372adf7536f07b1e2c20ef32dc1f4c16930a42fc12ed1fd2" as const;
export const D3DMETAL_UNORM_REPLACEMENT_RELATIVE_PATH =
  "sidecar/diagnostics/zzz-rt-unorm-float.dxil" as const;
export const D3DMETAL_UNORM_REPLACEMENT_SHA256 =
  "c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717" as const;

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

export const D3DMETAL_LAUNCH_ENVIRONMENT = {
  WINE_ENABLE_TIMEOUT_FIX: "1",
  WINEMSYNC: "1",
  CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
  D3DM_MTL4: "1",
  D3DM_ENABLE_METALFX: "1",
  D3DM_SUPPORT_DXR: "1",
  D3DM_VENDOR_ID: "0x10de",
  D3DM_DEVICE_ID: "0x2882",
  D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 4060",
} as const;

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
] as const;

export const D3DMETAL_DYLD_INSERT_BRIDGE =
  "YAAGL_DYLD_INSERT_LIBRARIES" as const;

/**
 * SIP strips DYLD_* while starting platform binaries such as /usr/bin/env.
 * Start the platform shell without DYLD_*, set it from a private bridge only
 * inside that process, then exec the non-platform Wine loader.
 */
export function createD3DMetalIsolatedCommand(
  executable: string,
  args: readonly string[]
) {
  // Neutralino's command builder preserves one argv item but serializes raw
  // newlines as backslash-n, so keep the -c program on one line.
  const script =
    `unset ${D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST.join(" ")}; ` +
    `if [ -n "\${${D3DMETAL_DYLD_INSERT_BRIDGE}:-}" ]; then ` +
    `export DYLD_INSERT_LIBRARIES="$${D3DMETAL_DYLD_INSERT_BRIDGE}"; ` +
    `else unset DYLD_INSERT_LIBRARIES; fi; ` +
    `unset ${D3DMETAL_DYLD_INSERT_BRIDGE}; exec "$@"`;
  return ["/bin/sh", "-c", script, "yaagl-d3dmetal-env", executable, ...args];
}

export function createD3DMetalLaunchArguments(gameExecutablePath: string) {
  return [gameExecutablePath, ZZZ_D3D12_SELECTOR];
}

export function isD3DMetalPassiveMetalIrCaptureEnabled() {
  return (
    import.meta.env["YAAGL_METAL_IR_MODE"] ===
    D3DMETAL_METAL_IR_MULTICAPTURE_MODE
  );
}

export function createD3DMetalMetalIrEnvironment({
  mode,
  capturePath,
  captureHash,
  d3dMetalHash,
  providerHash,
  manifestPath,
  probePath,
  providerPath,
  d3dMetalPath,
  dxcompilerPath,
  replacementPath,
  runId,
  sourceRevision,
  buildIdentity,
  acknowledgementPath,
  acknowledgementToken,
  attemptId,
  executable,
  gameExecutable,
  armDirectory,
  controlsDirectory,
}: {
  mode: D3DMetalMetalIrMode;
  capturePath: string;
  captureHash: string;
  d3dMetalHash?: string;
  providerHash?: string;
  manifestPath: string;
  probePath?: string;
  providerPath?: string;
  d3dMetalPath?: string;
  dxcompilerPath?: string;
  replacementPath?: string;
  runId?: string;
  sourceRevision?: string;
  buildIdentity?: string;
  acknowledgementPath?: string;
  acknowledgementToken?: string;
  attemptId?: string;
  executable?: string;
  gameExecutable?: string;
  armDirectory?: string;
  controlsDirectory?: string;
}) {
  const passive = mode === D3DMETAL_METAL_IR_MULTICAPTURE_MODE;
  const observer = mode === D3DMETAL_METAL_IR_OBSERVER_MODE;
  return {
    YAAGL_RUNTIME_MODE: mode,
    YAAGL_METAL_IR_LOG: capturePath,
    YAAGL_METAL_IR_CAPTURE_PATH: capturePath,
    YAAGL_METAL_IR_CAPTURE_SHA256: captureHash,
    YAAGL_METAL_IR_D3DMETAL_SHA256: d3dMetalHash!,
    YAAGL_METAL_IR_PROVIDER_SHA256: providerHash!,
    YAAGL_METAL_IR_MANIFEST: manifestPath,
    ...(passive
      ? {
          YAAGL_METAL_IR_PROVIDER: providerPath!,
          YAAGL_METAL_IR_D3DMETAL: d3dMetalPath!,
          [D3DMETAL_DYLD_INSERT_BRIDGE]: probePath!,
          YAAGL_METAL_IR_RUN_ID: runId!,
          YAAGL_METAL_IR_SOURCE_REVISION: sourceRevision!,
          YAAGL_METAL_IR_BUILD_ID: buildIdentity!,
          YAAGL_METAL_IR_SOURCE: sourceRevision!,
          YAAGL_METAL_IR_BUILD: buildIdentity!,
          YAAGL_METAL_IR_ACK_PATH: acknowledgementPath!,
          YAAGL_METAL_IR_ACK_DIR: acknowledgementPath!,
          YAAGL_METAL_IR_ARM_DIR: armDirectory!,
          YAAGL_METAL_IR_CONTROLS_DIR: controlsDirectory!,
          YAAGL_METAL_IR_ACK_TOKEN: acknowledgementToken!,
          YAAGL_METAL_IR_ATTEMPT_ID: attemptId!,
          YAAGL_METAL_IR_EXECUTABLE: executable!,
          YAAGL_METAL_IR_GAME_EXECUTABLE: gameExecutable!,
        }
      : observer
      ? {
          YAAGL_METAL_IR_PROVIDER: providerPath!,
          YAAGL_METAL_IR_D3DMETAL: d3dMetalPath!,
          [D3DMETAL_DYLD_INSERT_BRIDGE]: probePath!,
        }
      : {
          YAAGL_METAL_IR_REPLACEMENT: replacementPath!,
          YAAGL_METAL_IR_DXCOMPILER: dxcompilerPath!,
          YAAGL_METAL_IR_PROVIDER: providerPath!,
          YAAGL_METAL_IR_D3DMETAL: d3dMetalPath!,
          [D3DMETAL_DYLD_INSERT_BRIDGE]: probePath!,
        }),
  };
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

export async function validateD3DMetalMetalIrObserver({
  wineRoot,
  probePath,
}: {
  wineRoot: string;
  probePath: string;
}) {
  const d3dMetalPath = join(
    wineRoot,
    D3DMETAL_FRAMEWORK_RUNTIME_CANONICAL_PATH
  );
  const providerPath = join(
    wineRoot,
    D3DMETAL_METAL_IR_CONVERTER_RELATIVE_PATH
  );
  const [d3dMetalHash, probeHash, providerHash] = await Promise.all([
    sha256File(d3dMetalPath),
    sha256File(probePath),
    sha256File(providerPath),
  ]);
  if (d3dMetalHash !== D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256) {
    throw new Error(
      `Metal IR observer requires pinned D3DMetal ${D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256}, found ${d3dMetalHash}`
    );
  }
  if (probeHash !== D3DMETAL_METAL_IR_PROBE_SHA256) {
    throw new Error(
      `Metal IR observer hash mismatch: expected ${D3DMETAL_METAL_IR_PROBE_SHA256}, found ${probeHash}`
    );
  }
  if (providerHash !== D3DMETAL_METAL_IR_CONVERTER_SHA256) {
    throw new Error(
      `Metal IR observer provider mismatch: expected ${D3DMETAL_METAL_IR_CONVERTER_SHA256}, found ${providerHash}`
    );
  }
  await exec(["/usr/bin/codesign", "--verify", "--strict", probePath]);
  const fileDescription = (await exec(["/usr/bin/file", probePath])).stdOut;
  if (!/Mach-O 64-bit[^\n]*x86_64/i.test(fileDescription)) {
    throw new Error(
      `Metal IR observer must be a Mach-O x86_64 dylib: ${fileDescription.trim()}`
    );
  }
  return {
    d3dMetalPath,
    d3dMetalHash,
    probePath,
    probeHash,
    providerPath,
    providerHash,
  };
}

export async function validateD3DMetalMetalIrProbe({
  wineRoot,
  probePath,
  replacementPath,
}: {
  wineRoot: string;
  probePath: string;
  replacementPath: string;
}) {
  const d3dMetalPath = join(
    wineRoot,
    D3DMETAL_FRAMEWORK_RUNTIME_CANONICAL_PATH
  );
  const providerPath = join(
    wineRoot,
    D3DMETAL_METAL_IR_CONVERTER_RELATIVE_PATH
  );
  const dxcompilerPath = join(wineRoot, D3DMETAL_DXCOMPILER_RELATIVE_PATH);
  const [
    d3dMetalHash,
    probeHash,
    providerHash,
    dxcompilerHash,
    replacementHash,
  ] =
    await Promise.all([
      sha256File(d3dMetalPath),
      sha256File(probePath),
      sha256File(providerPath),
      sha256File(dxcompilerPath),
      sha256File(replacementPath),
    ]);
  if (d3dMetalHash !== D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256) {
    throw new Error(
      `Metal IR probe requires no-op-only D3DMetal ${D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256}, found ${d3dMetalHash}`
    );
  }
  if (probeHash !== D3DMETAL_METAL_IR_PROBE_SHA256) {
    throw new Error(
      `Metal IR probe hash mismatch: expected ${D3DMETAL_METAL_IR_PROBE_SHA256}, found ${probeHash}`
    );
  }
  if (providerHash !== D3DMETAL_METAL_IR_CONVERTER_SHA256) {
    throw new Error(
      `Metal IR converter hash mismatch: expected ${D3DMETAL_METAL_IR_CONVERTER_SHA256}, found ${providerHash}`
    );
  }
  if (dxcompilerHash !== D3DMETAL_DXCOMPILER_SHA256) {
    throw new Error(
      `DXC runtime hash mismatch: expected ${D3DMETAL_DXCOMPILER_SHA256}, found ${dxcompilerHash}`
    );
  }
  if (replacementHash !== D3DMETAL_UNORM_REPLACEMENT_SHA256) {
    throw new Error(
      `Metal IR replacement hash mismatch: expected ${D3DMETAL_UNORM_REPLACEMENT_SHA256}, found ${replacementHash}`
    );
  }
  await exec(["/usr/bin/codesign", "--verify", "--strict", probePath]);
  const fileDescription = (await exec(["/usr/bin/file", probePath])).stdOut;
  if (!/Mach-O 64-bit[^\n]*x86_64/i.test(fileDescription)) {
    throw new Error(
      `Metal IR probe must be a Mach-O x86_64 dylib: ${fileDescription.trim()}`
    );
  }
  return {
    d3dMetalPath,
    d3dMetalHash,
    probePath,
    probeHash,
    providerPath,
    providerHash,
    dxcompilerPath,
    dxcompilerHash,
    replacementPath,
    replacementHash,
  };
}

export async function validateD3DMetalMetalIrCapture({
  wineRoot,
  capturePath,
  controlHelperPath,
  expectedHash,
}: {
  wineRoot: string;
  capturePath: string;
  controlHelperPath: string;
  expectedHash: string;
}) {
  const captureHash = await sha256File(capturePath);
  if (
    !/^[a-f0-9]{64}$/i.test(expectedHash) ||
    captureHash !== expectedHash.toLowerCase()
  ) {
    throw new Error(
      `Metal IR capture hash mismatch: expected ${
        expectedHash || "missing"
      }, found ${captureHash}`
    );
  }
  await exec(["/usr/bin/codesign", "--verify", "--strict", capturePath]);
  const fileDescription = (await exec(["/usr/bin/file", capturePath])).stdOut;
  if (!/Mach-O 64-bit[^\n]*x86_64/i.test(fileDescription)) {
    throw new Error(
      `Metal IR capture must be a Mach-O x86_64 dylib: ${fileDescription.trim()}`
    );
  }
  if (!(await fileOrDirExists(controlHelperPath))) {
    throw new Error(`Missing capture-control helper: ${controlHelperPath}`);
  }
  const controlHelperHash = await sha256File(controlHelperPath);
  await exec([
    "/usr/bin/codesign",
    "--verify",
    "--strict",
    controlHelperPath,
  ]);
  const controlHelperDescription = (
    await exec(["/usr/bin/file", controlHelperPath])
  ).stdOut;
  if (!/Mach-O 64-bit[^\n]*x86_64/i.test(controlHelperDescription)) {
    throw new Error(
      `capture-control helper must be a Mach-O x86_64 executable: ${controlHelperDescription.trim()}`
    );
  }
  const d3dMetalPath = join(
    wineRoot,
    D3DMETAL_FRAMEWORK_RUNTIME_CANONICAL_PATH
  );
  const providerPath = join(
    wineRoot,
    D3DMETAL_METAL_IR_CONVERTER_RELATIVE_PATH
  );
  if (!(await fileOrDirExists(d3dMetalPath))) {
    throw new Error(`Missing passive capture D3DMetal image: ${d3dMetalPath}`);
  }
  if (!(await fileOrDirExists(providerPath))) {
    throw new Error(`Missing passive capture provider image: ${providerPath}`);
  }
  const [d3dMetalHash, providerHash] = await Promise.all([
    sha256File(d3dMetalPath),
    sha256File(providerPath),
  ]);
  if (d3dMetalHash !== D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256) {
    throw new Error(
      `Passive capture requires pinned D3DMetal ${D3DMETAL_4_0_BETA_2_NO_OP_PSO_FIX_SHA256}, found ${d3dMetalHash}`
    );
  }
  if (providerHash !== D3DMETAL_METAL_IR_CONVERTER_SHA256) {
    throw new Error(
      `Passive capture requires pinned Metal IR provider ${D3DMETAL_METAL_IR_CONVERTER_SHA256}, found ${providerHash}`
    );
  }
  return {
    capturePath,
    captureHash,
    d3dMetalPath,
    d3dMetalHash,
    providerPath,
    providerHash,
    controlHelperPath,
    controlHelperHash,
  };
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
