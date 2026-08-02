import { join } from "path-browserify";
import { ChannelClient } from "../channel-client";
import { Config } from "../config";
import {
  exec,
  env,
  fileOrDirExists,
  mkdirp,
  readFile,
  resolve,
  writeFile,
} from "../utils";
import {
  acquireGameLock,
  assertGraphicsSnapshotUnchanged,
  checkProcessConflicts,
  GameLockDependencies,
  GameLockFileSystem,
  GraphicsSnapshot,
  isProtectedZzzRootGraphicsDll,
  ProcessListEntry,
  releaseGameLock,
  ZZZ_GAME_EXECUTABLE,
  ZZZ_SHARED_GAME_DIRECTORY,
  ZZZ_VULKAN_DLL,
  ZZZ_VULKAN_DLL_BACKUP,
} from ".";

const ZZZ_EXECUTABLE = ZZZ_GAME_EXECUTABLE;
const ORIGINAL_YAAGL_EXECUTABLE =
  "/Applications/Yaagl ZZZ OS.app/Contents/MacOS/Yaagl";
const ORIGINAL_YAAGL_WINE64 =
  "/Users/{user}/Library/Application Support/Yaagl ZZZ OS/wine/bin/wine64";
const ORIGINAL_YAAGL_WINE =
  "/Users/{user}/Library/Application Support/Yaagl ZZZ OS/wine/bin/wine";

function recordPath(lockPath: string) {
  return lockPath;
}

function randomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, value => value.toString(16).padStart(2, "0")).join(
    ""
  );
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function canonicalizePath(path: string) {
  return (await exec(["/bin/realpath", path])).stdOut.trim();
}

async function sha256File(path: string) {
  const result = await exec(["/usr/bin/shasum", "-a", "256", path]);
  const match = /^([a-f0-9]{64})\s/i.exec(result.stdOut.trim());
  if (!match) throw new Error(`Unable to hash shared ZZZ file: ${path}`);
  return match[1].toLowerCase();
}

async function assertNoLegacyVulkanBackup(gameDirectory: string) {
  const backup = join(gameDirectory, ZZZ_VULKAN_DLL_BACKUP);
  if (await fileOrDirExists(backup)) {
    throw new Error(
      `Refusing to launch while an unrecovered YAAGL Vulkan backup exists: ${backup}`
    );
  }
}

async function snapshotZzzGraphicsFiles(
  gameDirectory: string
): Promise<GraphicsSnapshot> {
  const rootEntries = await Neutralino.filesystem.readDirectory(gameDirectory);
  const relativePaths = rootEntries
    .filter(
      entry =>
        entry.type === "FILE" && isProtectedZzzRootGraphicsDll(entry.entry)
    )
    .map(entry => entry.entry);
  if (await fileOrDirExists(join(gameDirectory, ZZZ_GAME_EXECUTABLE))) {
    relativePaths.push(ZZZ_GAME_EXECUTABLE);
  }
  const vulkanPath = join(gameDirectory, ZZZ_VULKAN_DLL);
  if (await fileOrDirExists(vulkanPath)) relativePaths.push(ZZZ_VULKAN_DLL);
  relativePaths.sort((left, right) => left.localeCompare(right));

  const snapshot: Record<string, string> = {};
  for (const relativePath of relativePaths) {
    snapshot[relativePath] = await sha256File(
      join(gameDirectory, relativePath)
    );
  }
  return snapshot;
}

class NeutralinoGameLockFileSystem implements GameLockFileSystem {
  async ensureDirectory(path: string) {
    await mkdirp(path);
  }

  async createExclusive(path: string, contents: string) {
    const temporary = `${path}.candidate-${randomHex(8)}`;
    const guard = `${path}.guard`;
    try {
      await writeFile(temporary, contents);
      // A hard link publishes the already-complete record atomically and
      // fails when another launcher has won the same path.
      await exec(["/usr/bin/lockf", "-k", guard, "/bin/ln", temporary, path]);
      return true;
    } catch (error) {
      if (await fileOrDirExists(path)) return false;
      throw error;
    } finally {
      if (await fileOrDirExists(temporary)) {
        await Neutralino.filesystem.removeFile(temporary);
      }
    }
  }

  async readText(path: string) {
    try {
      return await readFile(recordPath(path));
    } catch {
      return (await fileOrDirExists(path)) ? "" : undefined;
    }
  }

  async compareAndDelete(path: string, expectedContents: string) {
    const expected = `${path}.expected-${randomHex(8)}`;
    const guard = `${path}.guard`;
    try {
      await writeFile(expected, expectedContents);
      await exec([
        "/usr/bin/lockf",
        "-k",
        guard,
        "/bin/sh",
        "-c",
        'if /usr/bin/cmp -s "$1" "$2"; then /bin/rm -f "$1"; else exit 1; fi',
        "yaagl-lock-delete",
        path,
        expected,
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (await fileOrDirExists(expected)) {
        await Neutralino.filesystem.removeFile(expected);
      }
    }
  }
}

async function isProcessAlive(pid: number) {
  try {
    await exec(["/bin/kill", "-0", String(pid)]);
    return true;
  } catch {
    return false;
  }
}

async function currentUserHome() {
  return await env("HOME");
}

async function originalWinePaths() {
  const home = (await currentUserHome()).replace(/\/$/, "");
  const substitute = (path: string) => path.replace("/Users/{user}", home);
  return [substitute(ORIGINAL_YAAGL_WINE64), substitute(ORIGINAL_YAAGL_WINE)];
}

function createProcessListProvider(knownPaths: readonly string[]) {
  return {
    async listProcesses(): Promise<ProcessListEntry[]> {
      const output = (await exec(["/bin/ps", "-axww", "-o", "pid=,args="]))
        .stdOut;
      return output
        .split("\n")
        .map(line => /^\s*(\d+)\s+(.*)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(match => {
          const commandLine = match[2];
          const configuredPath = knownPaths.find(
            path => commandLine === path || commandLine.startsWith(`${path} `)
          );
          const gameRunning = new RegExp(
            `(?:^|[\\\\/])${ZZZ_EXECUTABLE.replace(
              ".",
              "\\."
            )}(?:["']?)(?:\\s|$)`,
            "i"
          ).test(commandLine);
          return {
            pid: Number(match[1]),
            name: gameRunning ? ZZZ_EXECUTABLE : undefined,
            executablePath: configuredPath,
            commandLine,
          };
        });
    },
  };
}

function createDependencies(
  fileSystem: GameLockFileSystem
): GameLockDependencies {
  return {
    fileSystem,
    canonicalizePath,
    sha256,
    isProcessAlive,
    createNonce: randomHex,
    now: Date.now,
  };
}

async function* withGameDirectoryLock(
  gameDirectory: string,
  createTask: () => ReturnType<ChannelClient["launch"]>,
  verifyGraphicsIntegrity = false
) {
  const [canonicalGameDirectory, canonicalSharedDirectory] = await Promise.all([
    canonicalizePath(gameDirectory),
    canonicalizePath(ZZZ_SHARED_GAME_DIRECTORY),
  ]);
  if (canonicalGameDirectory !== canonicalSharedDirectory) {
    throw new Error(
      `Yaagl ZZZ DX12 only uses the shared game directory ${ZZZ_SHARED_GAME_DIRECTORY}; received ${gameDirectory}`
    );
  }

  const gameExecutablePath = join(gameDirectory, ZZZ_EXECUTABLE);
  const knownWineExecutablePaths = await originalWinePaths();
  const knownPaths = [
    ORIGINAL_YAAGL_EXECUTABLE,
    ...knownWineExecutablePaths,
    gameExecutablePath,
  ];
  const conflicts = await checkProcessConflicts({
    gameExecutablePath,
    processListProvider: createProcessListProvider(knownPaths),
    canonicalizePath,
    knownYaaglExecutablePaths: [ORIGINAL_YAAGL_EXECUTABLE],
    knownWineExecutablePaths,
    ignoredPids: [Number(NL_PID)],
  });
  if (conflicts.length > 0) {
    const first = conflicts[0];
    throw new Error(
      `ZZZ game directory is already in use (${first.kind}, PID ${first.process.pid}). Close the existing game or Yaagl ZZZ OS first.`
    );
  }

  const fileSystem = new NeutralinoGameLockFileSystem();
  const acquired = await acquireGameLock({
    gamePath: gameDirectory,
    lockDirectory: resolve("./locks/game"),
    ownerPid: Number(NL_PID),
    dependencies: createDependencies(fileSystem),
  });
  if (!acquired.acquired) {
    throw new Error(
      `ZZZ game directory is locked by another launcher (${acquired.conflict.reason}).`
    );
  }

  let graphicsBefore: GraphicsSnapshot | undefined;
  try {
    if (verifyGraphicsIntegrity) {
      await assertNoLegacyVulkanBackup(gameDirectory);
      graphicsBefore = await snapshotZzzGraphicsFiles(gameDirectory);
    }
    yield* createTask();
  } finally {
    try {
      if (graphicsBefore) {
        await assertNoLegacyVulkanBackup(gameDirectory);
        assertGraphicsSnapshotUnchanged(
          graphicsBefore,
          await snapshotZzzGraphicsFiles(gameDirectory)
        );
      }
    } finally {
      await releaseGameLock(acquired.lock, fileSystem);
    }
  }
}

/** Protects every operation that can read or mutate the shared ZZZ tree. */
export function protectZzzDx12Client(client: ChannelClient): ChannelClient {
  return {
    ...client,
    install(selection: string) {
      return withGameDirectoryLock(selection, () => client.install(selection));
    },
    update() {
      return withGameDirectoryLock(client.installDir(), () => client.update());
    },
    predownload() {
      return withGameDirectoryLock(client.installDir(), () =>
        client.predownload()
      );
    },
    launch(config: Config) {
      return withGameDirectoryLock(
        client.installDir(),
        () => client.launch(config),
        true
      );
    },
    checkIntegrity() {
      return withGameDirectoryLock(client.installDir(), () =>
        client.checkIntegrity()
      );
    },
  };
}
