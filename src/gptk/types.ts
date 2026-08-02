import type {
  GPTK_D3DMETAL_VERSION,
  GPTK_MANIFEST_SCHEMA_VERSION,
  GPTK_RUNTIME_VERSION,
} from "./constants";

export interface GptkRuntimeManifestFile {
  /** POSIX-style path relative to the cache root. */
  path: string;
  size: number;
  sha256: string;
}

export interface GptkRuntimeManifest {
  schemaVersion: typeof GPTK_MANIFEST_SCHEMA_VERSION;
  runtimeVersion: typeof GPTK_RUNTIME_VERSION;
  d3dMetalVersion: typeof GPTK_D3DMETAL_VERSION;
  importedAt: string;
  files: GptkRuntimeManifestFile[];
}

export interface GptkFileStat {
  /** stat must follow symbolic links. */
  type: "file" | "directory" | "other";
  size: number;
}

export interface GptkDirectoryEntry {
  name: string;
  /** Directory listings must not report symbolic links as directories. */
  type: "file" | "directory" | "other";
}

export interface GptkFilesystem {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<GptkFileStat>;
  listDirectory(path: string): Promise<readonly GptkDirectoryEntry[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, contents: string): Promise<void>;
  createDirectory(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  /** Copies source to destination while preserving framework symlinks. */
  copyDirectory(source: string, destination: string): Promise<void>;
  /** Returns ordinary files below root without following directory symlinks. */
  listFiles(root: string): Promise<readonly string[]>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  move(source: string, destination: string): Promise<void>;
}

export interface GptkPathOperations {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  relative(from: string, to: string): string;
}

export interface GptkCommandRequest {
  executable: string;
  argv: string[];
}

export interface GptkCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GptkCommandRunner = (
  request: GptkCommandRequest
) => Promise<GptkCommandResult>;

export interface GptkHostOperations {
  filesystem: GptkFilesystem;
  path: GptkPathOperations;
  runCommand: GptkCommandRunner;
  sha256(bytes: Uint8Array): Promise<string>;
  /** Optional host-native fast path that avoids transporting large files. */
  sha256File?(path: string): Promise<{ size: number; sha256: string }>;
  now(): Date;
  createUniqueId(): string;
}

export interface GptkImporterOptions {
  hdiutilExecutable?: string;
  codesignExecutable?: string;
  plutilExecutable?: string;
}

export interface ValidatedGptkEvaluationRoot {
  evaluationRoot: string;
  sourceLibraryRoot: string;
  d3dMetalVersion: typeof GPTK_D3DMETAL_VERSION;
}

export interface GptkImportResult {
  destination: string;
  sourceDmg: string;
  manifest: GptkRuntimeManifest;
}

export type GptkAutomaticCandidateCallback = () => Promise<
  string | null | undefined
>;
export type GptkFileChooserCallback = () => Promise<string | null | undefined>;

export interface GptkCandidateImportRequest {
  destination: string;
  automaticCandidates?: readonly GptkAutomaticCandidateCallback[];
  chooseFile?: GptkFileChooserCallback;
}

export type GptkCandidateImportResult =
  | { status: "imported"; result: GptkImportResult }
  | { status: "cancelled"; errors: readonly Error[] }
  | { status: "failed"; errors: readonly Error[] };
