import { join, relative } from "path-browserify";
import { exec, fileOrDirExists, readFile, stats, writeFile } from "@utils";
import { WineDistribution } from "./distro";
import { getCorrectWineBinary } from "./wine";

const WINE_RUNTIME_MANIFEST_SCHEMA = 1 as const;
const WINE_RUNTIME_MANIFEST_FILENAME = "yaagl-wine-runtime.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface WineRuntimeFile {
  path: string;
  sha256: string;
}

interface WineRuntimeManifest {
  schemaVersion: typeof WINE_RUNTIME_MANIFEST_SCHEMA;
  wineTag: string;
  wineVersion: string;
  sourceArchiveSha256: string;
  sourceArchiveSize: number;
  files: WineRuntimeFile[];
}

function requirePinnedDistribution(distro: WineDistribution) {
  if (
    !distro.archiveSha256 ||
    !SHA256_PATTERN.test(distro.archiveSha256) ||
    !Number.isSafeInteger(distro.archiveSize) ||
    !distro.archiveSize ||
    !distro.wineVersion
  ) {
    throw new Error(`Wine distribution is not pinned: ${distro.id}`);
  }
  return {
    sha256: distro.archiveSha256,
    size: distro.archiveSize,
    wineVersion: distro.wineVersion,
  };
}

export function assertWineArchiveIdentity({
  distro,
  actualSha256,
  actualSize,
}: {
  distro: WineDistribution;
  actualSha256: string;
  actualSize: number;
}) {
  const expected = requirePinnedDistribution(distro);
  if (actualSize !== expected.size) {
    throw new Error(
      `Wine archive size mismatch: expected ${expected.size}, found ${actualSize}`
    );
  }
  if (actualSha256.toLowerCase() !== expected.sha256) {
    throw new Error(
      `Wine archive SHA-256 mismatch: expected ${expected.sha256}, found ${actualSha256}`
    );
  }
}

async function sha256File(target: string) {
  const result = await exec(["/usr/bin/shasum", "-a", "256", target]);
  const match = /^([a-f0-9]{64})\s/i.exec(result.stdOut.trim());
  if (!match)
    throw new Error(`Unable to read SHA-256 for Wine file: ${target}`);
  return match[1].toLowerCase();
}

async function verifySignedExecutable(target: string) {
  await exec(["/usr/bin/codesign", "--verify", "--strict", target]);
}

async function readWineVersion(loader: string) {
  const result = await exec([loader, "--version"]);
  return result.stdOut.trim();
}

function parseManifest(contents: string): WineRuntimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Wine runtime manifest is not valid JSON: ${String(error)}`
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Wine runtime manifest is invalid");
  }
  const manifest = value as Partial<WineRuntimeManifest>;
  if (
    manifest.schemaVersion !== WINE_RUNTIME_MANIFEST_SCHEMA ||
    typeof manifest.wineTag !== "string" ||
    typeof manifest.wineVersion !== "string" ||
    typeof manifest.sourceArchiveSha256 !== "string" ||
    !SHA256_PATTERN.test(manifest.sourceArchiveSha256) ||
    !Number.isSafeInteger(manifest.sourceArchiveSize) ||
    !Array.isArray(manifest.files) ||
    manifest.files.some(
      file =>
        typeof file !== "object" ||
        file === null ||
        typeof file.path !== "string" ||
        file.path.startsWith("/") ||
        file.path.split("/").some(part => part === "..") ||
        typeof file.sha256 !== "string" ||
        !SHA256_PATTERN.test(file.sha256)
    )
  ) {
    throw new Error("Wine runtime manifest has an unsupported schema");
  }
  return manifest as WineRuntimeManifest;
}

async function runtimeFiles(wineRoot: string) {
  const loader = await getCorrectWineBinary(wineRoot);
  const wineserver = join(wineRoot, "bin", "wineserver");
  for (const target of [loader, wineserver]) {
    if (!(await fileOrDirExists(target))) {
      throw new Error(`Required Wine executable is missing: ${target}`);
    }
    await verifySignedExecutable(target);
  }
  return { loader, wineserver };
}

export async function createWineRuntimeManifest({
  wineRoot,
  distro,
  archiveSha256,
  archiveSize,
}: {
  wineRoot: string;
  distro: WineDistribution;
  archiveSha256: string;
  archiveSize: number;
}) {
  assertWineArchiveIdentity({
    distro,
    actualSha256: archiveSha256,
    actualSize: archiveSize,
  });
  const expected = requirePinnedDistribution(distro);
  const { loader, wineserver } = await runtimeFiles(wineRoot);
  const actualVersion = await readWineVersion(loader);
  if (actualVersion !== expected.wineVersion) {
    throw new Error(
      `Wine version mismatch: expected ${expected.wineVersion}, found ${
        actualVersion || "missing"
      }`
    );
  }
  const files = await Promise.all(
    [loader, wineserver].map(async target => ({
      path: relative(wineRoot, target),
      sha256: await sha256File(target),
    }))
  );
  const manifest: WineRuntimeManifest = {
    schemaVersion: WINE_RUNTIME_MANIFEST_SCHEMA,
    wineTag: distro.id,
    wineVersion: actualVersion,
    sourceArchiveSha256: archiveSha256,
    sourceArchiveSize: archiveSize,
    files,
  };
  await writeFile(
    join(wineRoot, WINE_RUNTIME_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

export async function validateWineRuntime(
  wineRoot: string,
  distro: WineDistribution
) {
  const expected = requirePinnedDistribution(distro);
  const manifest = parseManifest(
    await readFile(join(wineRoot, WINE_RUNTIME_MANIFEST_FILENAME))
  );
  assertWineArchiveIdentity({
    distro,
    actualSha256: manifest.sourceArchiveSha256,
    actualSize: manifest.sourceArchiveSize,
  });
  if (
    manifest.wineTag !== distro.id ||
    manifest.wineVersion !== expected.wineVersion
  ) {
    throw new Error(`Wine runtime manifest does not match ${distro.id}`);
  }

  const { loader } = await runtimeFiles(wineRoot);
  const actualVersion = await readWineVersion(loader);
  if (actualVersion !== expected.wineVersion) {
    throw new Error(
      `Wine version mismatch: expected ${expected.wineVersion}, found ${actualVersion}`
    );
  }
  for (const file of manifest.files) {
    const target = join(wineRoot, file.path);
    if ((await sha256File(target)) !== file.sha256) {
      throw new Error(`Wine runtime file hash mismatch: ${file.path}`);
    }
  }
  return manifest;
}

export async function readArchiveIdentity(archivePath: string) {
  const archiveStats = await stats(archivePath);
  return {
    size: archiveStats.size,
    sha256: await sha256File(archivePath),
  };
}
