import { createHash } from "crypto";
import { mkdtemp, mkdir, realpath, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireGameLock,
  checkProcessConflicts,
  GameLockDependencies,
  GameLockFileSystem,
  GameLockHandle,
  ProcessListEntry,
  releaseGameLock,
} from ".";

class MemoryFileSystem implements GameLockFileSystem {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  async ensureDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  async createExclusive(path: string, contents: string): Promise<boolean> {
    if (this.files.has(path)) return false;
    this.files.set(path, contents);
    return true;
  }

  async readText(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }

  async compareAndDelete(
    path: string,
    expectedContents: string
  ): Promise<boolean> {
    if (this.files.get(path) !== expectedContents) return false;
    this.files.delete(path);
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(path => rm(path, { recursive: true }))
  );
});

async function createGameDirectory(): Promise<{
  root: string;
  gamePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "yaagl-game-lock-"));
  temporaryDirectories.push(root);
  const gamePath = join(root, "Zenless Zone Zero Game");
  await mkdir(gamePath);
  return { root, gamePath };
}

function createDependencies(
  fileSystem: MemoryFileSystem,
  alivePids: Set<number>,
  nonce: string
): GameLockDependencies {
  return {
    fileSystem,
    canonicalizePath: async path => realpath(resolve(path)),
    sha256: async value => createHash("sha256").update(value).digest("hex"),
    isProcessAlive: async pid => alivePids.has(pid),
    createNonce: () => nonce,
    now: () => 1_722_400_000_000,
  };
}

describe("game path lock", () => {
  it("atomically grants only one owner and rejects the live owner conflict", async () => {
    const { gamePath } = await createGameDirectory();
    const fileSystem = new MemoryFileSystem();
    const alivePids = new Set([101, 202]);
    const lockDirectory = "/caller/locks";

    const [first, second] = await Promise.all([
      acquireGameLock({
        gamePath,
        lockDirectory,
        ownerPid: 101,
        dependencies: createDependencies(fileSystem, alivePids, "owner-one"),
      }),
      acquireGameLock({
        gamePath,
        lockDirectory,
        ownerPid: 202,
        dependencies: createDependencies(fileSystem, alivePids, "owner-two"),
      }),
    ]);

    const results = [first, second];
    expect(results.filter(result => result.acquired)).toHaveLength(1);
    const rejected = results.find(result => !result.acquired);
    expect(rejected).toMatchObject({
      acquired: false,
      conflict: { reason: "live-owner" },
    });
    expect(fileSystem.directories).toEqual(new Set([lockDirectory]));
    expect([...fileSystem.files.keys()][0]).toMatch(
      /^\/caller\/locks\/[a-f0-9]{64}\.lock$/
    );
  });

  it("reclaims a lock only after its recorded pid is stale", async () => {
    const { gamePath } = await createGameDirectory();
    const fileSystem = new MemoryFileSystem();
    const alivePids = new Set([101]);
    const first = await acquireGameLock({
      gamePath,
      lockDirectory: "/locks",
      ownerPid: 101,
      dependencies: createDependencies(fileSystem, alivePids, "old-owner"),
    });
    expect(first.acquired).toBe(true);

    alivePids.delete(101);
    alivePids.add(202);
    const recovered = await acquireGameLock({
      gamePath,
      lockDirectory: "/locks",
      ownerPid: 202,
      dependencies: createDependencies(fileSystem, alivePids, "new-owner"),
    });

    expect(recovered).toMatchObject({
      acquired: true,
      lock: { record: { pid: 202, nonce: "new-owner" } },
    });
    expect([...fileSystem.files.values()][0]).toContain('"pid":202');
  });

  it("does not let an old or forged owner release the current lock", async () => {
    const { gamePath } = await createGameDirectory();
    const fileSystem = new MemoryFileSystem();
    const alivePids = new Set([101]);
    const first = await acquireGameLock({
      gamePath,
      lockDirectory: "/locks",
      ownerPid: 101,
      dependencies: createDependencies(fileSystem, alivePids, "old-owner"),
    });
    if (!first.acquired) throw new Error("expected the first lock acquisition");

    const forged: GameLockHandle = {
      ...first.lock,
      record: { ...first.lock.record, nonce: "forged" },
    };
    expect(await releaseGameLock(forged, fileSystem)).toBe(false);

    alivePids.delete(101);
    alivePids.add(202);
    const second = await acquireGameLock({
      gamePath,
      lockDirectory: "/locks",
      ownerPid: 202,
      dependencies: createDependencies(fileSystem, alivePids, "new-owner"),
    });
    if (!second.acquired) throw new Error("expected stale lock recovery");

    expect(await releaseGameLock(first.lock, fileSystem)).toBe(false);
    expect(await releaseGameLock(second.lock, fileSystem)).toBe(true);
    expect(fileSystem.files.size).toBe(0);
  });

  it("uses the normalized real path as the shared SHA-256 key", async () => {
    const { root, gamePath } = await createGameDirectory();
    const linkedPath = join(root, "linked-game");
    await symlink(gamePath, linkedPath);
    const fileSystem = new MemoryFileSystem();
    const alivePids = new Set([101]);

    const first = await acquireGameLock({
      gamePath: `${linkedPath}/./`,
      lockDirectory: "/locks/",
      ownerPid: 101,
      dependencies: createDependencies(fileSystem, alivePids, "owner-one"),
    });
    const second = await acquireGameLock({
      gamePath,
      lockDirectory: "/locks",
      ownerPid: 202,
      dependencies: createDependencies(fileSystem, alivePids, "owner-two"),
    });

    if (!first.acquired) throw new Error("expected the first lock acquisition");
    const canonicalGamePath = await realpath(gamePath);
    expect(first.lock.record).toMatchObject({
      canonicalGamePath,
      createdAtMs: 1_722_400_000_000,
    });
    expect(first.lock.key).toBe(
      createHash("sha256").update(canonicalGamePath).digest("hex")
    );
    expect(second).toMatchObject({
      acquired: false,
      conflict: {
        reason: "live-owner",
        lockPath: first.lock.lockPath,
      },
    });
  });
});

describe("running process conflicts", () => {
  it("finds exact game, YAAGL, and target Wine processes", async () => {
    const processes: ProcessListEntry[] = [
      { pid: 10, executablePath: "/Games/ZZZ/ZenlessZoneZero.exe" },
      {
        pid: 11,
        executablePath: "/Applications/YAAGL.app/Contents/MacOS/YAAGL",
      },
      {
        pid: 12,
        executablePath: "/opt/yaagl/wine64",
        arguments: ["/opt/yaagl/wine64", "/Games/Other/OtherGame.exe"],
      },
      { pid: 13, name: "ZenlessZoneZero.exe" },
      {
        pid: 14,
        name: "wine64",
        arguments: [
          "/unconfigured/wine64",
          "z:\\games\\zzz\\ZENLESSZONEZERO.EXE",
        ],
      },
    ];

    const conflicts = await checkProcessConflicts({
      gameExecutablePath: "/Games/ZZZ/ZenlessZoneZero.exe",
      gameExecutableAliases: ["Z:\\Games\\ZZZ\\ZenlessZoneZero.exe"],
      knownYaaglExecutablePaths: [
        "/Applications/YAAGL.app/Contents/MacOS/YAAGL",
      ],
      knownWineExecutablePaths: ["/opt/yaagl/wine64"],
      canonicalizePath: async path => resolve(path),
      processListProvider: { listProcesses: async () => processes },
    });

    expect(conflicts.map(({ kind, process }) => [process.pid, kind])).toEqual([
      [10, "game"],
      [11, "yaagl"],
      [12, "wine"],
      [13, "game"],
      [14, "game"],
    ]);
  });

  it("does not block unrelated or name-only Wine processes", async () => {
    const processes: ProcessListEntry[] = [
      {
        pid: 20,
        name: "wine64",
        executablePath: "/another/wine64",
        commandLine: "/another/wine64 /Games/Other/OtherGame.exe",
      },
      {
        pid: 21,
        executablePath: "/opt/other/wine64",
        arguments: ["/opt/other/wine64", "/Games/Other/OtherGame.exe"],
      },
      { pid: 22, name: "ZenlessZoneZero.exe.backup" },
      {
        pid: 23,
        commandLine: "helper --note ZenlessZoneZero.exe.backup",
      },
    ];

    const conflicts = await checkProcessConflicts({
      gameExecutablePath: "/Games/ZZZ/ZenlessZoneZero.exe",
      knownWineExecutablePaths: ["/opt/yaagl/wine64"],
      canonicalizePath: async path => resolve(path),
      processListProvider: { listProcesses: async () => processes },
    });

    expect(conflicts).toEqual([]);
  });

  it("does not canonicalize unrelated command-line tokens", async () => {
    const canonicalized: string[] = [];
    const conflicts = await checkProcessConflicts({
      gameExecutablePath: "/Games/ZZZ/ZenlessZoneZero.exe",
      knownYaaglExecutablePaths: [
        "/Applications/YAAGL.app/Contents/MacOS/YAAGL",
      ],
      knownWineExecutablePaths: ["/opt/yaagl/wine64"],
      canonicalizePath: async path => {
        canonicalized.push(path);
        return resolve(path);
      },
      processListProvider: {
        listProcesses: async () => [
          {
            pid: 30,
            commandLine:
              "/usr/bin/helper --message ordinary words /System/Library/Unrelated",
          },
        ],
      },
    });

    expect(conflicts).toEqual([]);
    expect(canonicalized).toEqual([
      "/Games/ZZZ/ZenlessZoneZero.exe",
      "/Applications/YAAGL.app/Contents/MacOS/YAAGL",
      "/opt/yaagl/wine64",
    ]);
  });

  it("recognizes an authoritative executable path through a renamed symlink", async () => {
    const conflicts = await checkProcessConflicts({
      gameExecutablePath: "/Games/ZZZ/ZenlessZoneZero.exe",
      knownWineExecutablePaths: ["/opt/yaagl/wine64"],
      canonicalizePath: async path =>
        path === "/tmp/current-runtime" ? "/opt/yaagl/wine64" : resolve(path),
      processListProvider: {
        listProcesses: async () => [
          {
            pid: 31,
            executablePath: "/tmp/current-runtime",
            arguments: ["/tmp/current-runtime"],
          },
        ],
      },
    });

    expect(conflicts).toMatchObject([
      { kind: "wine", matchedBy: "executable-path", process: { pid: 31 } },
    ]);
  });
});
