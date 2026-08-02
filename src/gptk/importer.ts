import {
  GPTK_CACHED_LIBRARY_DIRECTORY,
  GPTK_D3DMETAL_FRAMEWORK,
  GPTK_D3DMETAL_INFO_PLIST,
  GPTK_D3DMETAL_VERSION,
  GPTK_MANIFEST_FILENAME,
  GPTK_MANIFEST_SCHEMA_VERSION,
  GPTK_OPTIONAL_DOCUMENTS,
  GPTK_REQUIRED_DOCUMENTS,
  GPTK_REQUIRED_RUNTIME_FILES,
  GPTK_RUNTIME_VERSION,
  GPTK_SOURCE_LIBRARY_DIRECTORY,
} from "./constants";
import type {
  GptkCandidateImportRequest,
  GptkCandidateImportResult,
  GptkCommandResult,
  GptkHostOperations,
  GptkImporterOptions,
  GptkImportResult,
  GptkRuntimeManifest,
  GptkRuntimeManifestFile,
  ValidatedGptkEvaluationRoot,
} from "./types";

export type GptkImportErrorCode =
  | "invalid-destination"
  | "missing-library-directory"
  | "missing-artifact"
  | "invalid-artifact"
  | "missing-info-plist"
  | "invalid-info-plist"
  | "unsupported-version"
  | "invalid-signature"
  | "attach-failed"
  | "attach-output-invalid"
  | "detach-failed"
  | "runtime-not-found"
  | "manifest-invalid"
  | "cache-file-set-mismatch"
  | "cache-size-mismatch"
  | "cache-hash-mismatch"
  | "staging-conflict"
  | "cache-commit-failed"
  | "cache-restore-failed";

export class GptkImportError extends Error {
  readonly code: GptkImportErrorCode;
  readonly originalError?: unknown;
  readonly cleanupErrors: Error[];

  constructor(
    code: GptkImportErrorCode,
    message: string,
    originalError?: unknown,
    cleanupErrors: Error[] = []
  ) {
    super(message);
    this.name = "GptkImportError";
    this.code = code;
    this.originalError = originalError;
    this.cleanupErrors = cleanupErrors;
  }
}

const DEFAULT_HDIUTIL = "/usr/bin/hdiutil";
const DEFAULT_CODESIGN = "/usr/bin/codesign";
const DEFAULT_PLUTIL = "/usr/bin/plutil";
const INNER_DMG_PATTERN = /evaluation environment.*\.dmg$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const compareStrings = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const commandFailureDetail = (result: GptkCommandResult) =>
  result.stderr.trim() ||
  result.stdout.trim() ||
  `command exited with code ${result.exitCode}`;

const splitRelativePath = (relativePath: string) => relativePath.split("/");

const joinRelativePath = (
  host: GptkHostOperations,
  root: string,
  relativePath: string
) => host.path.join(root, ...splitRelativePath(relativePath));

const normalizeRelativePath = (relativePath: string): string => {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    parts.some(part => !part || part === "." || part === "..")
  ) {
    throw new GptkImportError(
      "manifest-invalid",
      `Unsafe manifest path: ${relativePath}`
    );
  }
  return normalized;
};

const relativeManifestPath = (
  host: GptkHostOperations,
  root: string,
  absolutePath: string
) => normalizeRelativePath(host.path.relative(root, absolutePath));

const decodeXml = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16))
    )
    .replace(/&#([0-9]+);/g, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10))
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const readPlistString = (plist: string, key: string): string | null => {
  const match = plist.match(
    new RegExp(
      `<key>\\s*${escapeRegExp(
        key
      )}\\s*</key>\\s*<string>\\s*([^<]*?)\\s*</string>`,
      "i"
    )
  );
  return match ? decodeXml(match[1]).trim() : null;
};

const validateD3DMetalPlist = (plist: string): typeof GPTK_D3DMETAL_VERSION => {
  const shortVersion = readPlistString(plist, "CFBundleShortVersionString");
  const bundleVersion = readPlistString(plist, "CFBundleVersion");
  const versions = [shortVersion, bundleVersion].filter(
    (version): version is string => version !== null
  );
  if (
    versions.length === 0 ||
    versions.some(version => version !== GPTK_D3DMETAL_VERSION)
  ) {
    const actualVersion =
      versions.length > 0 ? versions.join(" / ") : "missing";
    throw new GptkImportError(
      "unsupported-version",
      `Expected D3DMetal ${GPTK_D3DMETAL_VERSION}, found ${actualVersion}`
    );
  }
  return GPTK_D3DMETAL_VERSION;
};

const requireDirectory = async (
  host: GptkHostOperations,
  path: string,
  description: string,
  code: GptkImportErrorCode = "missing-library-directory"
): Promise<void> => {
  if (!(await host.filesystem.exists(path))) {
    throw new GptkImportError(code, `Missing ${description}: ${path}`);
  }
  const stat = await host.filesystem.stat(path);
  if (stat.type !== "directory") {
    throw new GptkImportError(
      "invalid-artifact",
      `Expected ${description} to be a directory: ${path}`
    );
  }
};

const requireFile = async (
  host: GptkHostOperations,
  path: string,
  description: string,
  code: GptkImportErrorCode = "missing-artifact"
): Promise<void> => {
  if (!(await host.filesystem.exists(path))) {
    throw new GptkImportError(code, `Missing ${description}: ${path}`);
  }
  const stat = await host.filesystem.stat(path);
  if (stat.type !== "file") {
    throw new GptkImportError(
      "invalid-artifact",
      `Expected ${description} to be a file: ${path}`
    );
  }
};

const validateRuntimeLibrary = async (
  host: GptkHostOperations,
  libraryRoot: string,
  options: GptkImporterOptions
): Promise<typeof GPTK_D3DMETAL_VERSION> => {
  await requireDirectory(host, libraryRoot, "GPTK redist/lib directory");
  await requireDirectory(
    host,
    joinRelativePath(host, libraryRoot, GPTK_D3DMETAL_FRAMEWORK),
    "D3DMetal framework",
    "missing-artifact"
  );

  for (const relativePath of GPTK_REQUIRED_RUNTIME_FILES) {
    await requireFile(
      host,
      joinRelativePath(host, libraryRoot, relativePath),
      `required GPTK artifact ${relativePath}`
    );
  }

  const infoPlistPath = joinRelativePath(
    host,
    libraryRoot,
    GPTK_D3DMETAL_INFO_PLIST
  );
  await requireFile(
    host,
    infoPlistPath,
    "D3DMetal Info.plist",
    "missing-info-plist"
  );
  const plistResult = await host.runCommand({
    executable: options.plutilExecutable ?? DEFAULT_PLUTIL,
    argv: ["-convert", "xml1", "-o", "-", "--", infoPlistPath],
  });
  if (plistResult.exitCode !== 0 || !plistResult.stdout.trim()) {
    throw new GptkImportError(
      "invalid-info-plist",
      `Unable to parse D3DMetal Info.plist: ${commandFailureDetail(
        plistResult
      )}`
    );
  }
  return validateD3DMetalPlist(plistResult.stdout);
};

const verifyD3DMetalSignature = async (
  host: GptkHostOperations,
  libraryRoot: string,
  options: GptkImporterOptions
) => {
  const frameworkPath = joinRelativePath(
    host,
    libraryRoot,
    GPTK_D3DMETAL_FRAMEWORK
  );
  const signatureResult = await host.runCommand({
    executable: options.codesignExecutable ?? DEFAULT_CODESIGN,
    argv: ["--verify", "--deep", "--strict", frameworkPath],
  });
  if (signatureResult.exitCode !== 0) {
    throw new GptkImportError(
      "invalid-signature",
      `D3DMetal code-signature verification failed: ${commandFailureDetail(
        signatureResult
      )}`
    );
  }
};

export const validateMountedEvaluationRoot = async (
  host: GptkHostOperations,
  evaluationRoot: string,
  options: GptkImporterOptions = {}
): Promise<ValidatedGptkEvaluationRoot> => {
  const sourceLibraryRoot = joinRelativePath(
    host,
    evaluationRoot,
    GPTK_SOURCE_LIBRARY_DIRECTORY
  );
  const d3dMetalVersion = await validateRuntimeLibrary(
    host,
    sourceLibraryRoot,
    options
  );
  await verifyD3DMetalSignature(host, sourceLibraryRoot, options);
  return { evaluationRoot, sourceLibraryRoot, d3dMetalVersion };
};

const manifestFilePaths = async (
  host: GptkHostOperations,
  cacheRoot: string
): Promise<string[]> => {
  const files = await host.filesystem.listFiles(cacheRoot);
  const relativePaths = files
    .map(file => relativeManifestPath(host, cacheRoot, file))
    .filter(file => file !== GPTK_MANIFEST_FILENAME)
    .sort(compareStrings);

  for (let index = 1; index < relativePaths.length; index += 1) {
    if (relativePaths[index - 1] === relativePaths[index]) {
      throw new GptkImportError(
        "manifest-invalid",
        `Duplicate cached file path: ${relativePaths[index]}`
      );
    }
  }
  return relativePaths;
};

const hashFile = async (
  host: GptkHostOperations,
  cacheRoot: string,
  relativePath: string
): Promise<GptkRuntimeManifestFile> => {
  const target = joinRelativePath(host, cacheRoot, relativePath);
  let size: number;
  let sha256: string;
  if (host.sha256File) {
    const nativeHash = await host.sha256File(target);
    size = nativeHash.size;
    sha256 = nativeHash.sha256.toLowerCase();
  } else {
    const bytes = await host.filesystem.readBytes(target);
    size = bytes.byteLength;
    sha256 = (await host.sha256(bytes)).toLowerCase();
  }
  if (!SHA256_PATTERN.test(sha256)) {
    throw new GptkImportError(
      "manifest-invalid",
      `SHA-256 provider returned an invalid digest for ${relativePath}`
    );
  }
  return { path: relativePath, size, sha256 };
};

export const createRuntimeManifest = async (
  host: GptkHostOperations,
  cacheRoot: string
): Promise<GptkRuntimeManifest> => {
  const files: GptkRuntimeManifestFile[] = [];
  for (const relativePath of await manifestFilePaths(host, cacheRoot)) {
    files.push(await hashFile(host, cacheRoot, relativePath));
  }
  return {
    schemaVersion: GPTK_MANIFEST_SCHEMA_VERSION,
    runtimeVersion: GPTK_RUNTIME_VERSION,
    d3dMetalVersion: GPTK_D3DMETAL_VERSION,
    importedAt: host.now().toISOString(),
    files,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseManifestFile = (value: unknown): GptkRuntimeManifestFile => {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    !Number.isInteger(value.size) ||
    (value.size as number) < 0 ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256)
  ) {
    throw new GptkImportError(
      "manifest-invalid",
      "GPTK manifest contains an invalid file entry"
    );
  }
  return {
    path: normalizeRelativePath(value.path),
    size: value.size as number,
    sha256: value.sha256,
  };
};

const parseRuntimeManifest = (value: unknown): GptkRuntimeManifest => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== GPTK_MANIFEST_SCHEMA_VERSION ||
    value.runtimeVersion !== GPTK_RUNTIME_VERSION ||
    value.d3dMetalVersion !== GPTK_D3DMETAL_VERSION ||
    typeof value.importedAt !== "string" ||
    Number.isNaN(Date.parse(value.importedAt)) ||
    !Array.isArray(value.files)
  ) {
    throw new GptkImportError(
      "manifest-invalid",
      "GPTK runtime manifest has an unsupported schema or version"
    );
  }
  const files = value.files.map(parseManifestFile);
  for (let index = 1; index < files.length; index += 1) {
    if (compareStrings(files[index - 1].path, files[index].path) >= 0) {
      throw new GptkImportError(
        "manifest-invalid",
        "GPTK manifest file paths must be unique and sorted"
      );
    }
  }
  return {
    schemaVersion: GPTK_MANIFEST_SCHEMA_VERSION,
    runtimeVersion: GPTK_RUNTIME_VERSION,
    d3dMetalVersion: GPTK_D3DMETAL_VERSION,
    importedAt: value.importedAt,
    files,
  };
};

const readRuntimeManifest = async (
  host: GptkHostOperations,
  cacheRoot: string
): Promise<GptkRuntimeManifest> => {
  const manifestPath = host.path.join(cacheRoot, GPTK_MANIFEST_FILENAME);
  await requireFile(host, manifestPath, "GPTK runtime manifest");
  let value: unknown;
  try {
    value = JSON.parse(await host.filesystem.readText(manifestPath));
  } catch (error) {
    throw new GptkImportError(
      "manifest-invalid",
      "GPTK runtime manifest is not valid JSON",
      error
    );
  }
  return parseRuntimeManifest(value);
};

export const validateCachedRuntime = async (
  host: GptkHostOperations,
  cacheRoot: string,
  options: GptkImporterOptions = {}
): Promise<GptkRuntimeManifest> => {
  const manifest = await readRuntimeManifest(host, cacheRoot);
  const cachedLibraryRoot = host.path.join(
    cacheRoot,
    GPTK_CACHED_LIBRARY_DIRECTORY
  );
  await validateRuntimeLibrary(host, cachedLibraryRoot, options);
  await verifyD3DMetalSignature(host, cachedLibraryRoot, options);

  const actualPaths = await manifestFilePaths(host, cacheRoot);
  const expectedPaths = manifest.files.map(file => file.path);
  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new GptkImportError(
      "cache-file-set-mismatch",
      "Cached GPTK files do not match the manifest"
    );
  }

  for (const expected of manifest.files) {
    const actual = await hashFile(host, cacheRoot, expected.path);
    if (actual.size !== expected.size) {
      throw new GptkImportError(
        "cache-size-mismatch",
        `Cached GPTK file has the wrong size: ${expected.path}`
      );
    }
    if (actual.sha256 !== expected.sha256) {
      throw new GptkImportError(
        "cache-hash-mismatch",
        `Cached GPTK file has the wrong SHA-256: ${expected.path}`
      );
    }
  }
  return manifest;
};

const safeUniqueId = (host: GptkHostOperations): string => {
  const value = host.createUniqueId().replace(/[^a-z0-9_-]/gi, "_");
  return value || "runtime";
};

const removeIfPresent = async (
  host: GptkHostOperations,
  path: string
): Promise<void> => {
  if (await host.filesystem.exists(path)) {
    await host.filesystem.remove(path, { recursive: true });
  }
};

const commitStagedRuntime = async (
  host: GptkHostOperations,
  staging: string,
  destination: string
): Promise<void> => {
  const destinationExists = await host.filesystem.exists(destination);
  if (!destinationExists) {
    try {
      await host.filesystem.move(staging, destination);
      return;
    } catch (error) {
      throw new GptkImportError(
        "cache-commit-failed",
        `Failed to install GPTK cache at ${destination}`,
        error
      );
    }
  }

  const parent = host.path.dirname(destination);
  const basename = host.path.basename(destination);
  const backup = host.path.join(
    parent,
    `.${basename}.backup-${safeUniqueId(host)}`
  );
  if (await host.filesystem.exists(backup)) {
    throw new GptkImportError(
      "staging-conflict",
      `GPTK cache backup path already exists: ${backup}`
    );
  }

  await host.filesystem.move(destination, backup);
  try {
    await host.filesystem.move(staging, destination);
  } catch (error) {
    try {
      await host.filesystem.move(backup, destination);
    } catch (restoreError) {
      throw new GptkImportError(
        "cache-restore-failed",
        `Failed to restore the previous GPTK cache at ${destination}`,
        restoreError
      );
    }
    throw new GptkImportError(
      "cache-commit-failed",
      `Failed to replace the GPTK cache at ${destination}`,
      error
    );
  }

  try {
    await removeIfPresent(host, backup);
  } catch {
    // The new cache is committed. A stale backup is safer than reporting a
    // failed import after the destination has already changed.
  }
};

export const cacheMountedRuntime = async (
  host: GptkHostOperations,
  evaluationRoot: string,
  destination: string,
  options: GptkImporterOptions = {}
): Promise<GptkRuntimeManifest> => {
  const basename = host.path.basename(destination);
  const parent = host.path.dirname(destination);
  if (
    !basename ||
    basename === "." ||
    basename === ".." ||
    parent === destination
  ) {
    throw new GptkImportError(
      "invalid-destination",
      `Unsafe GPTK cache destination: ${destination}`
    );
  }

  const validated = await validateMountedEvaluationRoot(
    host,
    evaluationRoot,
    options
  );
  await host.filesystem.createDirectory(parent, { recursive: true });
  const staging = host.path.join(
    parent,
    `.${basename}.staging-${safeUniqueId(host)}`
  );
  if (await host.filesystem.exists(staging)) {
    throw new GptkImportError(
      "staging-conflict",
      `GPTK cache staging path already exists: ${staging}`
    );
  }

  await host.filesystem.createDirectory(staging, { recursive: false });
  try {
    await host.filesystem.copyDirectory(
      validated.sourceLibraryRoot,
      host.path.join(staging, GPTK_CACHED_LIBRARY_DIRECTORY)
    );
    for (const document of GPTK_REQUIRED_DOCUMENTS) {
      const source = host.path.join(evaluationRoot, document);
      await requireFile(
        host,
        source,
        `required GPTK document ${document}`,
        "missing-artifact"
      );
      await host.filesystem.copyFile(source, host.path.join(staging, document));
    }
    for (const document of GPTK_OPTIONAL_DOCUMENTS) {
      const source = host.path.join(evaluationRoot, document);
      if (await host.filesystem.exists(source)) {
        const stat = await host.filesystem.stat(source);
        if (stat.type === "file") {
          await host.filesystem.copyFile(
            source,
            host.path.join(staging, document)
          );
        }
      }
    }

    const manifest = await createRuntimeManifest(host, staging);
    await host.filesystem.writeText(
      host.path.join(staging, GPTK_MANIFEST_FILENAME),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    const validatedManifest = await validateCachedRuntime(host, staging);
    await commitStagedRuntime(host, staging, destination);
    return validatedManifest;
  } finally {
    await removeIfPresent(host, staging);
  }
};

interface AttachedImage {
  mountPoint: string;
  detachTarget: string;
}

const readPlistValues = (plist: string, key: string): string[] => {
  const expression = new RegExp(
    `<key>\\s*${escapeRegExp(
      key
    )}\\s*</key>\\s*<string>\\s*([^<]*?)\\s*</string>`,
    "gi"
  );
  return Array.from(plist.matchAll(expression), match =>
    decodeXml(match[1]).trim()
  ).filter(Boolean);
};

const detachImage = async (
  host: GptkHostOperations,
  detachTarget: string,
  hdiutilExecutable: string
): Promise<void> => {
  const result = await host.runCommand({
    executable: hdiutilExecutable,
    argv: ["detach", detachTarget],
  });
  if (result.exitCode !== 0) {
    throw new GptkImportError(
      "detach-failed",
      `Detaching ${detachTarget} failed: ${commandFailureDetail(result)}`
    );
  }
};

const attachImage = async (
  host: GptkHostOperations,
  dmgPath: string,
  hdiutilExecutable: string
): Promise<AttachedImage> => {
  const result = await host.runCommand({
    executable: hdiutilExecutable,
    argv: ["attach", "-readonly", "-nobrowse", "-plist", dmgPath],
  });
  if (result.exitCode !== 0) {
    throw new GptkImportError(
      "attach-failed",
      `Attaching ${dmgPath} failed: ${commandFailureDetail(result)}`
    );
  }

  const mountPoints = readPlistValues(result.stdout, "mount-point");
  const deviceEntries = readPlistValues(result.stdout, "dev-entry");
  const mountPoint = mountPoints[mountPoints.length - 1];
  const detachTarget = mountPoint ?? deviceEntries[deviceEntries.length - 1];
  if (!mountPoint) {
    const cleanupErrors: Error[] = [];
    if (detachTarget) {
      try {
        await detachImage(host, detachTarget, hdiutilExecutable);
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
    throw new GptkImportError(
      "attach-output-invalid",
      `hdiutil did not report a mount point for ${dmgPath}`,
      undefined,
      cleanupErrors
    );
  }
  return { mountPoint, detachTarget };
};

const isDirectory = async (host: GptkHostOperations, path: string) => {
  if (!(await host.filesystem.exists(path))) {
    return false;
  }
  return (await host.filesystem.stat(path)).type === "directory";
};

const findEvaluationRoot = async (
  host: GptkHostOperations,
  mountPoint: string,
  maximumDepth = 3
): Promise<string | null> => {
  const visit = async (path: string, depth: number): Promise<string | null> => {
    if (
      await isDirectory(
        host,
        joinRelativePath(host, path, GPTK_SOURCE_LIBRARY_DIRECTORY)
      )
    ) {
      return path;
    }
    if (depth >= maximumDepth) {
      return null;
    }
    const entries = [...(await host.filesystem.listDirectory(path))].sort(
      (left, right) => compareStrings(left.name, right.name)
    );
    for (const entry of entries) {
      if (entry.type === "directory") {
        const found = await visit(host.path.join(path, entry.name), depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  return visit(mountPoint, 0);
};

const findInnerEvaluationDmg = async (
  host: GptkHostOperations,
  mountPoint: string,
  maximumDepth = 3
): Promise<string | null> => {
  const visit = async (path: string, depth: number): Promise<string | null> => {
    const entries = [...(await host.filesystem.listDirectory(path))].sort(
      (left, right) => compareStrings(left.name, right.name)
    );
    for (const entry of entries) {
      const child = host.path.join(path, entry.name);
      if (entry.type === "file" && INNER_DMG_PATTERN.test(entry.name)) {
        return child;
      }
      if (entry.type === "directory" && depth < maximumDepth) {
        const found = await visit(child, depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  return visit(mountPoint, 0);
};

export const importGptkRuntime = async (
  host: GptkHostOperations,
  sourceDmg: string,
  destination: string,
  options: GptkImporterOptions = {}
): Promise<GptkImportResult> => {
  const hdiutilExecutable = options.hdiutilExecutable ?? DEFAULT_HDIUTIL;
  const attachments: AttachedImage[] = [];
  let result: GptkImportResult | undefined;
  let primaryError: unknown;

  try {
    const outerImage = await attachImage(host, sourceDmg, hdiutilExecutable);
    attachments.push(outerImage);
    let evaluationRoot = await findEvaluationRoot(host, outerImage.mountPoint);
    if (!evaluationRoot) {
      const innerDmg = await findInnerEvaluationDmg(
        host,
        outerImage.mountPoint
      );
      if (!innerDmg) {
        throw new GptkImportError(
          "runtime-not-found",
          "Mounted GPTK image contains neither redist/lib nor an evaluation environment DMG"
        );
      }
      const innerImage = await attachImage(host, innerDmg, hdiutilExecutable);
      attachments.push(innerImage);
      evaluationRoot = await findEvaluationRoot(host, innerImage.mountPoint);
    }
    if (!evaluationRoot) {
      throw new GptkImportError(
        "runtime-not-found",
        "Mounted evaluation environment does not contain redist/lib"
      );
    }
    const manifest = await cacheMountedRuntime(
      host,
      evaluationRoot,
      destination,
      options
    );
    result = { destination, sourceDmg, manifest };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors: Error[] = [];
  for (const attachment of [...attachments].reverse()) {
    try {
      await detachImage(host, attachment.detachTarget, hdiutilExecutable);
    } catch (error) {
      cleanupErrors.push(asError(error));
    }
  }

  if (primaryError !== undefined) {
    if (primaryError instanceof GptkImportError) {
      primaryError.cleanupErrors.push(...cleanupErrors);
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new GptkImportError(
      "detach-failed",
      cleanupErrors.map(error => error.message).join("; "),
      cleanupErrors[0],
      cleanupErrors
    );
  }
  if (!result) {
    throw new GptkImportError(
      "runtime-not-found",
      "GPTK import did not produce a runtime"
    );
  }
  return result;
};

export const importGptkRuntimeFromCandidates = async (
  host: GptkHostOperations,
  request: GptkCandidateImportRequest,
  options: GptkImporterOptions = {}
): Promise<GptkCandidateImportResult> => {
  const errors: Error[] = [];
  const tryImport = async (
    source: string
  ): Promise<GptkImportResult | null> => {
    try {
      return await importGptkRuntime(
        host,
        source,
        request.destination,
        options
      );
    } catch (error) {
      errors.push(asError(error));
      return null;
    }
  };

  for (const candidate of request.automaticCandidates ?? []) {
    let source: string | null | undefined;
    try {
      source = await candidate();
    } catch (error) {
      errors.push(asError(error));
      continue;
    }
    if (source && source.trim()) {
      const imported = await tryImport(source);
      if (imported) {
        return { status: "imported", result: imported };
      }
    }
  }

  if (request.chooseFile) {
    let source: string | null | undefined;
    try {
      source = await request.chooseFile();
    } catch (error) {
      errors.push(asError(error));
      return { status: "failed", errors };
    }
    if (!source || !source.trim()) {
      return { status: "cancelled", errors };
    }
    const imported = await tryImport(source);
    return imported
      ? { status: "imported", result: imported }
      : { status: "failed", errors };
  }

  return errors.length > 0
    ? { status: "failed", errors }
    : { status: "cancelled", errors };
};
