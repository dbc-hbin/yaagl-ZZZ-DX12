import path from "path-browserify";
import { rawString } from "../utils/command-builder";
import {
  env,
  exec2 as rawExec2,
  exec2Result as rawExec2Result,
  resolve,
} from "../utils";
import {
  GPTK_RUNTIME_VERSION,
  GptkDirectoryEntry,
  GptkFilesystem,
  GptkHostOperations,
  GptkRuntimeManifest,
  importGptkRuntimeFromCandidates,
  validateCachedRuntime,
} from ".";

const DEFAULT_DMG_NAME = "Game_Porting_Toolkit_4.0_beta_2.dmg";
const HOST_READ_CHUNK_SIZE = 768;

interface MountedDiskImage {
  mountPoint: string;
  device?: string;
}

// Neutralino 4.11 can associate overlapping spawned-process events with the
// wrong virtual process. Keep this queue local to GPTK host operations so
// filesystem probes are reliable without serializing unrelated game commands.
export function createCommandQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

const enqueueGptkCommand = createCommandQueue();

function gptkExec2(...args: Parameters<typeof rawExec2>) {
  return enqueueGptkCommand(() => rawExec2(...args));
}

function gptkExec2Result(...args: Parameters<typeof rawExec2Result>) {
  return enqueueGptkCommand(() => rawExec2Result(...args));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function findMountedReadOnlyImage(
  hdiutilInfo: unknown,
  sourceDmg: string
): MountedDiskImage | undefined {
  if (!isRecord(hdiutilInfo) || !Array.isArray(hdiutilInfo.images)) {
    return undefined;
  }

  for (const image of hdiutilInfo.images) {
    if (
      !isRecord(image) ||
      image["image-path"] !== sourceDmg ||
      image.writeable !== false ||
      !Array.isArray(image["system-entities"])
    ) {
      continue;
    }
    const entities = image["system-entities"];
    for (let index = entities.length - 1; index >= 0; index -= 1) {
      const entity = entities[index];
      if (!isRecord(entity) || typeof entity["mount-point"] !== "string") {
        continue;
      }
      return {
        mountPoint: entity["mount-point"],
        device:
          typeof entity["dev-entry"] === "string"
            ? entity["dev-entry"]
            : undefined,
      };
    }
  }
  return undefined;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function syntheticAttachPlist(image: MountedDiskImage) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array><dict><key>system-entities</key><array><dict>
<key>dev-entry</key><string>${escapeXml(
    image.device ?? image.mountPoint
  )}</string>
<key>mount-point</key><string>${escapeXml(image.mountPoint)}</string>
</dict></array></dict></array></plist>`;
}

async function findExistingMountedImage(sourceDmg: string) {
  const temporaryPrefix = `/tmp/yaagl-gptk-mounts-${uniqueId()}`;
  const plistPath = `${temporaryPrefix}.plist`;
  const extractRaw = async (keyPath: string) => {
    const result = await gptkExec2([
      "/usr/bin/plutil",
      "-extract",
      keyPath,
      "raw",
      "-o",
      "-",
      "--",
      plistPath,
    ]);
    return result.stdOut.trim();
  };
  const extractRawIfPresent = async (keyPath: string) => {
    try {
      return await extractRaw(keyPath);
    } catch {
      return undefined;
    }
  };
  try {
    // Neutralino 4.11 may reject hdiutil's full plist/JSON at either its
    // command-response or filesystem-response boundary. Keep the snapshot on
    // the host and transport only short plutil scalar values via spawn events.
    await gptkExec2([
      "/usr/bin/hdiutil",
      "info",
      "-plist",
      rawString(">"),
      plistPath,
      rawString("2>"),
      "/dev/null",
    ]);

    const imageCount = Number(await extractRaw("images"));
    if (!Number.isSafeInteger(imageCount) || imageCount < 0) return undefined;

    for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
      const imageKey = `images.${imageIndex}`;
      const [imagePath, writeable] = await Promise.all([
        extractRawIfPresent(`${imageKey}.image-path`),
        extractRawIfPresent(`${imageKey}.writeable`),
      ]);
      if (imagePath !== sourceDmg || writeable !== "false") continue;

      const entityCount = Number(
        await extractRaw(`${imageKey}.system-entities`)
      );
      if (!Number.isSafeInteger(entityCount) || entityCount < 0) {
        return undefined;
      }
      for (
        let entityIndex = entityCount - 1;
        entityIndex >= 0;
        entityIndex -= 1
      ) {
        const entityKey = `${imageKey}.system-entities.${entityIndex}`;
        const mountPoint = await extractRawIfPresent(
          `${entityKey}.mount-point`
        );
        if (!mountPoint) continue;
        return {
          mountPoint,
          device: await extractRawIfPresent(`${entityKey}.dev-entry`),
        };
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    try {
      await gptkExec2(["/bin/unlink", plistPath]);
    } catch {
      // The snapshot may not exist if hdiutil failed.
    }
  }
}

async function removeEmptyPrivateMount(mountPoint: string) {
  try {
    await gptkExec2(["/bin/rmdir", mountPoint]);
  } catch {
    // Never recursively delete a mount path. If hdiutil left anything behind,
    // preserving it is safer than risking deletion of a still-mounted image.
  }
}

function uniqueId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function listFiles(root: string) {
  const result = await gptkExec2([
    "/usr/bin/find",
    root,
    "-type",
    "f",
    "-print0",
    rawString("|"),
    "/usr/bin/base64",
  ]);
  return decodeBase64Bytes(result.stdOut).split("\0").filter(Boolean);
}

export function decodeBase64Bytes(value: string) {
  const binary = atob(value.replaceAll(/\s/g, ""));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function readHostTextInChunks(
  target: string,
  size: number,
  readChunk: (offset: number, size: number) => Promise<string>,
  chunkSize = HOST_READ_CHUNK_SIZE
) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid GPTK text file size: ${target}`);
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid GPTK text chunk size: ${chunkSize}`);
  }
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (let offset = 0; offset < size; offset += chunkSize) {
    const encoded = (
      await readChunk(offset, Math.min(chunkSize, size - offset))
    ).replaceAll(/\s/g, "");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    chunks.push(bytes);
    totalLength += bytes.byteLength;
  }
  if (totalLength !== size) {
    throw new Error(
      `Unable to read complete GPTK text file: ${target} (${totalLength}/${size} bytes)`
    );
  }
  const bytes = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function encodeBase64Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function shellTest(flag: "-e" | "-f" | "-d" | "-L", target: string) {
  return (await gptkExec2Result(["/bin/test", flag, target])).exitCode === 0;
}

async function shellPathExists(target: string) {
  return shellTest("-e", target);
}

async function sha256FileOnHost(target: string) {
  const [sizeResult, hashResult] = await Promise.all([
    gptkExec2(["/usr/bin/stat", "-L", "-f", "%z", target]),
    gptkExec2(["/usr/bin/shasum", "-a", "256", target]),
  ]);
  const size = Number(sizeResult.stdOut.trim());
  const hashMatch = /^([a-f0-9]{64})\s/i.exec(hashResult.stdOut.trim());
  if (!Number.isSafeInteger(size) || size < 0 || !hashMatch) {
    throw new Error(`Unable to read size/SHA-256 for GPTK file: ${target}`);
  }
  return { size, sha256: hashMatch[1].toLowerCase() };
}

const filesystem: GptkFilesystem = {
  exists: shellPathExists,
  async stat(target) {
    const [isFile, isDirectory, sizeResult] = await Promise.all([
      shellTest("-f", target),
      shellTest("-d", target),
      gptkExec2Result(["/usr/bin/stat", "-L", "-f", "%z", target]),
    ]);
    if (sizeResult.exitCode !== 0) {
      throw new Error(`Unable to stat GPTK path: ${target}`);
    }
    const size = Number(sizeResult.stdOut.trim());
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid GPTK path size: ${target}`);
    }
    return {
      type: isFile ? "file" : isDirectory ? "directory" : "other",
      size,
    };
  },
  async listDirectory(target) {
    const result = await gptkExec2([
      "/usr/bin/find",
      target,
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-print0",
      rawString("|"),
      "/usr/bin/base64",
    ]);
    const children = decodeBase64Bytes(result.stdOut)
      .split("\0")
      .filter(Boolean);
    return await Promise.all(
      children.map(async (child): Promise<GptkDirectoryEntry> => {
        const isLink = await shellTest("-L", child);
        const type = isLink
          ? "other"
          : (await shellTest("-f", child))
          ? "file"
          : (await shellTest("-d", child))
          ? "directory"
          : "other";
        return { name: path.basename(child), type };
      })
    );
  },
  async readText(target) {
    const sizeResult = await gptkExec2([
      "/usr/bin/stat",
      "-L",
      "-f",
      "%z",
      target,
    ]);
    const size = Number(sizeResult.stdOut.trim());
    return readHostTextInChunks(target, size, async (offset, length) => {
      const result = await gptkExec2([
        "/bin/dd",
        `if=${target}`,
        "bs=1",
        `skip=${offset}`,
        `count=${length}`,
        "status=none",
        rawString("|"),
        "/usr/bin/base64",
      ]);
      return result.stdOut;
    });
  },
  async readBytes(target) {
    const result = await gptkExec2(["/usr/bin/base64", target]);
    const binary = atob(result.stdOut.replaceAll(/\s/g, ""));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  },
  async writeText(target, contents) {
    await gptkExec2([
      "/usr/bin/printf",
      "%s",
      encodeBase64Text(contents),
      rawString("|"),
      "/usr/bin/base64",
      "-D",
      rawString(">"),
      target,
    ]);
  },
  async createDirectory(target, options) {
    await gptkExec2([
      "/bin/mkdir",
      ...(options?.recursive ? ["-p"] : []),
      target,
    ]);
  },
  async copyFile(source, destination) {
    await gptkExec2(["/bin/cp", "-p", source, destination]);
  },
  async copyDirectory(source, destination) {
    await gptkExec2(["/usr/bin/ditto", source, destination]);
  },
  listFiles,
  async remove(target, options) {
    if (options?.recursive) {
      if (!target || target === "/" || target === "." || target === "..") {
        throw new Error(`Refusing unsafe GPTK removal target: ${target}`);
      }
      await gptkExec2(["/bin/rm", "-rf", target]);
      return;
    }
    if ((await shellTest("-d", target)) && !(await shellTest("-L", target))) {
      await gptkExec2(["/bin/rmdir", target]);
    } else {
      await gptkExec2(["/bin/unlink", target]);
    }
  },
  async move(source, destination) {
    await gptkExec2(["/bin/mv", source, destination]);
  },
};

export function createNeutralinoGptkHost(): GptkHostOperations {
  const privateMounts = new Set<string>();
  const borrowedMounts = new Set<string>();

  return {
    filesystem,
    path: {
      join: (...parts) => path.join(...parts),
      dirname: target => path.dirname(target),
      basename: target => path.basename(target),
      relative: (from, to) => path.relative(from, to),
    },
    async runCommand(request) {
      if (
        request.executable === "/usr/bin/hdiutil" &&
        request.argv[0] === "detach" &&
        borrowedMounts.has(request.argv[1])
      ) {
        // The image was mounted before this launcher started. The importer
        // still receives a successful cleanup result, but the user's mount is
        // deliberately left untouched.
        borrowedMounts.delete(request.argv[1]);
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      let argv = request.argv;
      let privateMount: string | undefined;
      if (
        request.executable === "/usr/bin/hdiutil" &&
        request.argv[0] === "attach"
      ) {
        const sourceDmg = request.argv[request.argv.length - 1];
        const mounted = await findExistingMountedImage(sourceDmg);
        if (mounted) {
          borrowedMounts.add(mounted.mountPoint);
          return {
            exitCode: 0,
            stdout: syntheticAttachPlist(mounted),
            stderr: "",
          };
        }

        privateMount = `/tmp/yaagl-gptk-${uniqueId()}`;
        await gptkExec2(["/bin/mkdir", "-p", privateMount]);
        argv = [
          ...request.argv.slice(0, -1),
          "-mountpoint",
          privateMount,
          request.argv[request.argv.length - 1],
        ];
      }

      const result = await gptkExec2Result([request.executable, ...argv]);

      if (privateMount) {
        if (result.exitCode === 0) {
          privateMounts.add(privateMount);
        } else {
          await removeEmptyPrivateMount(privateMount);
        }
      }
      if (
        request.executable === "/usr/bin/hdiutil" &&
        request.argv[0] === "detach" &&
        result.exitCode === 0
      ) {
        const mount = request.argv[1];
        if (privateMounts.has(mount)) {
          privateMounts.delete(mount);
          await removeEmptyPrivateMount(mount);
        }
      }

      return {
        exitCode: result.exitCode,
        stdout: result.stdOut,
        stderr: result.stdErr,
      };
    },
    sha256File: sha256FileOnHost,
    sha256,
    now: () => new Date(),
    createUniqueId: uniqueId,
  };
}

export async function ensureGptkRuntime(): Promise<{
  runtimeRoot: string;
  manifest: GptkRuntimeManifest;
}> {
  const runtimeRoot = resolve(`./gptk/${GPTK_RUNTIME_VERSION}`);
  const host = createNeutralinoGptkHost();
  try {
    return {
      runtimeRoot,
      manifest: await validateCachedRuntime(host, runtimeRoot),
    };
  } catch {
    // A missing, old, or tampered cache is replaced only after a complete
    // staged import validates successfully.
  }

  const home = await env("HOME");
  const defaultDmg = path.join(home, "Downloads", DEFAULT_DMG_NAME);
  const result = await importGptkRuntimeFromCandidates(host, {
    destination: runtimeRoot,
    automaticCandidates: [
      async () => ((await shellPathExists(defaultDmg)) ? defaultDmg : null),
    ],
    chooseFile: async () => {
      const selected = await Neutralino.os.showOpenDialog(
        `Select Game Porting Toolkit ${GPTK_RUNTIME_VERSION} DMG`,
        {
          defaultPath: path.join(home, "Downloads"),
          filter: [{ name: "Disk Images", extensions: ["dmg"] }],
          multiSelections: false,
        }
      );
      return selected[0] ?? null;
    },
  });

  if (result.status === "imported") {
    return { runtimeRoot, manifest: result.result.manifest };
  }
  const details = result.errors.map(error => error.message).join("\n");
  if (result.status === "cancelled") {
    throw new Error(
      `GPTK ${GPTK_RUNTIME_VERSION} is required. DMG selection was cancelled.${
        details ? `\n${details}` : ""
      }`
    );
  }
  throw new Error(
    `Unable to import GPTK ${GPTK_RUNTIME_VERSION}.${
      details ? `\n${details}` : ""
    }`
  );
}
