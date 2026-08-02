import { CanonicalizePath, normalizePath, pathBasename } from "./path";

const ZZZ_EXECUTABLE_NAME = "zenlesszonezero.exe";

export interface ProcessListEntry {
  pid: number;
  name?: string;
  executablePath?: string;
  /** Full argv when the provider can expose it. */
  arguments?: readonly string[];
  /** Used as a conservative fallback when structured argv is unavailable. */
  commandLine?: string;
}

export interface ProcessListProvider {
  listProcesses(): Promise<readonly ProcessListEntry[]>;
}

export type ProcessConflictKind = "game" | "yaagl" | "wine";

export interface ProcessConflict {
  kind: ProcessConflictKind;
  matchedBy: "executable-path" | "command-line" | "exact-name";
  process: ProcessListEntry;
}

export interface CheckProcessConflictsOptions {
  gameExecutablePath: string;
  processListProvider: ProcessListProvider;
  canonicalizePath: CanonicalizePath;
  knownYaaglExecutablePaths?: readonly string[];
  knownWineExecutablePaths?: readonly string[];
  gameExecutableAliases?: readonly string[];
  ignoredPids?: readonly number[];
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
}

function pathIdentity(path: string, caseInsensitive = false): string {
  const identity = normalizePath(unquote(path));
  return caseInsensitive ? identity.toLowerCase() : identity;
}

function comparablePathIdentity(path: string): string {
  const unquoted = unquote(path);
  return pathIdentity(unquoted, isWindowsPath(unquoted));
}

function isExactZzzName(value: string | undefined): boolean {
  return (
    value !== undefined &&
    pathBasename(unquote(value)).toLowerCase() === ZZZ_EXECUTABLE_NAME
  );
}

function tokenizeCommandLine(commandLine: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;

  for (const character of commandLine) {
    if (character === '"' || character === "'") {
      if (quote === character) {
        quote = undefined;
      } else if (quote === undefined) {
        quote = character;
      } else {
        token += character;
      }
      continue;
    }

    if (/\s/.test(character) && quote === undefined) {
      if (token !== "") {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += character;
  }

  if (token !== "") tokens.push(token);
  return tokens;
}

async function canonicalIdentity(
  path: string,
  canonicalizePath: CanonicalizePath
): Promise<string> {
  const unquoted = unquote(path);
  try {
    const canonical = await canonicalizePath(unquoted);
    return pathIdentity(
      canonical,
      isWindowsPath(unquoted) || isWindowsPath(canonical)
    );
  } catch {
    return comparablePathIdentity(unquoted);
  }
}

async function createPathIdentitySet(
  paths: readonly string[],
  canonicalizePath: CanonicalizePath
): Promise<{
  identities: Set<string>;
  basenames: Set<string>;
}> {
  const identities = await Promise.all(
    paths.map(path => canonicalIdentity(path, canonicalizePath))
  );
  return {
    identities: new Set(identities),
    basenames: new Set(
      paths.map(path => pathBasename(unquote(path)).toLowerCase())
    ),
  };
}

async function matchesConfiguredPath(
  candidate: string | undefined,
  matcher: {
    identities: ReadonlySet<string>;
    basenames: ReadonlySet<string>;
  },
  canonicalizePath: CanonicalizePath,
  canonicalizeAnyPath = false
): Promise<boolean> {
  if (candidate === undefined || matcher.identities.size === 0) return false;
  if (matcher.identities.has(comparablePathIdentity(candidate))) return true;
  if (
    !canonicalizeAnyPath &&
    !matcher.basenames.has(pathBasename(unquote(candidate)).toLowerCase())
  ) {
    return false;
  }
  return matcher.identities.has(
    await canonicalIdentity(candidate, canonicalizePath)
  );
}

async function matchesGameExecutable(
  candidate: string,
  canonicalGameExecutablePath: string,
  aliases: ReadonlySet<string>,
  canonicalizePath: CanonicalizePath,
  canonicalizeAnyPath = false
): Promise<boolean> {
  if (aliases.has(comparablePathIdentity(candidate))) return true;
  if (
    isExactZzzName(candidate) &&
    !candidate.includes("/") &&
    !candidate.includes("\\")
  ) {
    return true;
  }
  if (!canonicalizeAnyPath && !isExactZzzName(candidate)) return false;

  return (
    (await canonicalIdentity(candidate, canonicalizePath)) ===
    canonicalGameExecutablePath
  );
}

function processArguments(process: ProcessListEntry): readonly string[] {
  if (process.arguments !== undefined) return process.arguments;
  if (process.commandLine !== undefined) {
    return tokenizeCommandLine(process.commandLine);
  }
  return [];
}

async function matchKnownExecutable(
  process: ProcessListEntry,
  args: readonly string[],
  matcher: {
    identities: ReadonlySet<string>;
    basenames: ReadonlySet<string>;
  },
  canonicalizePath: CanonicalizePath
): Promise<"executable-path" | "command-line" | undefined> {
  if (
    await matchesConfiguredPath(
      process.executablePath,
      matcher,
      canonicalizePath,
      true
    )
  ) {
    return "executable-path";
  }

  if (
    args.length > 0 &&
    (await matchesConfiguredPath(args[0], matcher, canonicalizePath))
  ) {
    return "command-line";
  }

  return undefined;
}

export async function checkProcessConflicts({
  gameExecutablePath,
  processListProvider,
  canonicalizePath,
  knownYaaglExecutablePaths = [],
  knownWineExecutablePaths = [],
  gameExecutableAliases = [],
  ignoredPids = [],
}: CheckProcessConflictsOptions): Promise<ProcessConflict[]> {
  const [canonicalGameExecutablePath, yaaglPaths, winePaths, processes] =
    await Promise.all([
      canonicalIdentity(gameExecutablePath, canonicalizePath),
      createPathIdentitySet(knownYaaglExecutablePaths, canonicalizePath),
      createPathIdentitySet(knownWineExecutablePaths, canonicalizePath),
      processListProvider.listProcesses(),
    ]);
  const aliases = new Set(
    [gameExecutablePath, ...gameExecutableAliases].map(comparablePathIdentity)
  );
  const ignored = new Set(ignoredPids);
  const conflicts: ProcessConflict[] = [];

  for (const process of processes) {
    if (ignored.has(process.pid)) continue;

    if (isExactZzzName(process.name)) {
      conflicts.push({ kind: "game", matchedBy: "exact-name", process });
      continue;
    }

    if (
      process.executablePath !== undefined &&
      (await matchesGameExecutable(
        process.executablePath,
        canonicalGameExecutablePath,
        aliases,
        canonicalizePath,
        true
      ))
    ) {
      conflicts.push({
        kind: "game",
        matchedBy: "executable-path",
        process,
      });
      continue;
    }

    const args = processArguments(process);
    if (
      args.length > 0 &&
      (await matchesGameExecutable(
        args[0],
        canonicalGameExecutablePath,
        aliases,
        canonicalizePath
      ))
    ) {
      conflicts.push({ kind: "game", matchedBy: "command-line", process });
      continue;
    }

    const yaaglMatch = await matchKnownExecutable(
      process,
      args,
      yaaglPaths,
      canonicalizePath
    );
    if (yaaglMatch !== undefined) {
      conflicts.push({
        kind: "yaagl",
        matchedBy: yaaglMatch,
        process,
      });
      continue;
    }

    const wineMatch = await matchKnownExecutable(
      process,
      args,
      winePaths,
      canonicalizePath
    );
    if (wineMatch !== undefined) {
      conflicts.push({ kind: "wine", matchedBy: wineMatch, process });
      continue;
    }

    for (const argument of args.slice(1)) {
      if (
        await matchesGameExecutable(
          argument,
          canonicalGameExecutablePath,
          aliases,
          canonicalizePath
        )
      ) {
        conflicts.push({ kind: "game", matchedBy: "command-line", process });
        break;
      }
    }
  }

  return conflicts;
}
