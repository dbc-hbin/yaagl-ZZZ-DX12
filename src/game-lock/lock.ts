import { CanonicalizePath, canonicalizeGamePath, joinLockPath } from "./path";

const LOCK_RECORD_VERSION = 1 as const;
const DEFAULT_MAX_ACQUIRE_ATTEMPTS = 16;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export interface GameLockFileSystem {
  ensureDirectory(path: string): Promise<void>;

  /**
   * Must atomically publish the complete file and return false when it already
   * exists. Partial contents must never be observable.
   */
  createExclusive(path: string, contents: string): Promise<boolean>;

  /** Returns undefined only when the file does not exist. */
  readText(path: string): Promise<string | undefined>;

  /**
   * Must atomically delete the file only when its complete contents still equal
   * expectedContents. A read followed by an unconditional delete is unsafe.
   */
  compareAndDelete(path: string, expectedContents: string): Promise<boolean>;
}

export interface GameLockDependencies {
  fileSystem: GameLockFileSystem;
  canonicalizePath: CanonicalizePath;
  sha256(value: string): Promise<string>;
  isProcessAlive(pid: number): Promise<boolean>;
  createNonce(): string;
  now(): number;
}

export interface GameLockRecord {
  version: typeof LOCK_RECORD_VERSION;
  pid: number;
  canonicalGamePath: string;
  createdAtMs: number;
  nonce: string;
}

export interface GameLockHandle {
  key: string;
  lockPath: string;
  record: GameLockRecord;
}

export type GameLockConflictReason =
  | "live-owner"
  | "invalid-record"
  | "path-mismatch"
  | "contended";

export interface GameLockConflict {
  reason: GameLockConflictReason;
  lockPath: string;
  owner?: GameLockRecord;
}

export type AcquireGameLockResult =
  | { acquired: true; lock: GameLockHandle }
  | { acquired: false; conflict: GameLockConflict };

export interface AcquireGameLockOptions {
  gamePath: string;
  lockDirectory: string;
  ownerPid: number;
  dependencies: GameLockDependencies;
  maxAttempts?: number;
}

function isGameLockRecord(value: unknown): value is GameLockRecord {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Partial<GameLockRecord>;
  return (
    record.version === LOCK_RECORD_VERSION &&
    typeof record.pid === "number" &&
    Number.isSafeInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.canonicalGamePath === "string" &&
    record.canonicalGamePath !== "" &&
    typeof record.createdAtMs === "number" &&
    Number.isFinite(record.createdAtMs) &&
    typeof record.nonce === "string" &&
    record.nonce !== ""
  );
}

function parseGameLockRecord(contents: string): GameLockRecord | undefined {
  try {
    const value: unknown = JSON.parse(contents);
    return isGameLockRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function serializeGameLockRecord(record: GameLockRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function validateOwnerPid(ownerPid: number): void {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    throw new Error("ownerPid must be a positive safe integer");
  }
}

function validateNonce(nonce: string): void {
  if (nonce === "")
    throw new Error("createNonce must return a non-empty string");
}

function validateAttemptCount(maxAttempts: number): void {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("maxAttempts must be a positive safe integer");
  }
}

export async function acquireGameLock({
  gamePath,
  lockDirectory,
  ownerPid,
  dependencies,
  maxAttempts = DEFAULT_MAX_ACQUIRE_ATTEMPTS,
}: AcquireGameLockOptions): Promise<AcquireGameLockResult> {
  validateOwnerPid(ownerPid);
  validateAttemptCount(maxAttempts);

  const canonicalGamePath = await canonicalizeGamePath(
    gamePath,
    dependencies.canonicalizePath
  );
  const key = (await dependencies.sha256(canonicalGamePath)).toLowerCase();
  if (!SHA_256_PATTERN.test(key)) {
    throw new Error("sha256 must return a 64-character hexadecimal digest");
  }

  const nonce = dependencies.createNonce();
  validateNonce(nonce);

  const record: GameLockRecord = {
    version: LOCK_RECORD_VERSION,
    pid: ownerPid,
    canonicalGamePath,
    createdAtMs: dependencies.now(),
    nonce,
  };
  const contents = serializeGameLockRecord(record);
  const lockPath = joinLockPath(lockDirectory, `${key}.lock`);

  await dependencies.fileSystem.ensureDirectory(lockDirectory);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await dependencies.fileSystem.createExclusive(lockPath, contents)) {
      return { acquired: true, lock: { key, lockPath, record } };
    }

    const existingContents = await dependencies.fileSystem.readText(lockPath);
    if (existingContents === undefined) continue;

    const existingRecord = parseGameLockRecord(existingContents);
    if (existingRecord === undefined) {
      return {
        acquired: false,
        conflict: { reason: "invalid-record", lockPath },
      };
    }

    if (existingRecord.canonicalGamePath !== canonicalGamePath) {
      return {
        acquired: false,
        conflict: {
          reason: "path-mismatch",
          lockPath,
          owner: existingRecord,
        },
      };
    }

    if (await dependencies.isProcessAlive(existingRecord.pid)) {
      return {
        acquired: false,
        conflict: {
          reason: "live-owner",
          lockPath,
          owner: existingRecord,
        },
      };
    }

    await dependencies.fileSystem.compareAndDelete(lockPath, existingContents);
  }

  return {
    acquired: false,
    conflict: { reason: "contended", lockPath },
  };
}

export async function releaseGameLock(
  lock: GameLockHandle,
  fileSystem: GameLockFileSystem
): Promise<boolean> {
  const contents = await fileSystem.readText(lock.lockPath);
  if (contents === undefined) return false;

  const current = parseGameLockRecord(contents);
  if (
    current === undefined ||
    current.pid !== lock.record.pid ||
    current.nonce !== lock.record.nonce ||
    current.canonicalGamePath !== lock.record.canonicalGamePath
  ) {
    return false;
  }

  return fileSystem.compareAndDelete(lock.lockPath, contents);
}
