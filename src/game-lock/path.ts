export type CanonicalizePath = (path: string) => Promise<string>;

/**
 * Applies platform-independent lexical normalization to a path that has
 * already been resolved by the caller's platform adapter.
 */
export function normalizePath(path: string): string {
  const value = path.replaceAll("\\", "/");
  let root = "";
  let remainder = value;
  let absolute = false;

  const drive = /^([A-Za-z]:)(\/|$)/.exec(remainder);
  if (drive !== null) {
    root = drive[1];
    remainder = remainder.slice(root.length);
    absolute = remainder.startsWith("/");
    remainder = remainder.replace(/^\/+/, "");
  } else if (remainder.startsWith("//")) {
    root = "//";
    absolute = true;
    remainder = remainder.replace(/^\/+/, "");
  } else if (remainder.startsWith("/")) {
    root = "/";
    absolute = true;
    remainder = remainder.replace(/^\/+/, "");
  }

  const segments: string[] = [];
  for (const segment of remainder.split("/")) {
    if (segment === "" || segment === ".") continue;

    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }

    segments.push(segment);
  }

  if (root === "//") return `//${segments.join("/")}`;
  if (root === "/") return `/${segments.join("/")}`;
  if (root !== "") {
    return `${root}${absolute ? "/" : ""}${segments.join("/")}`;
  }

  return segments.join("/") || ".";
}

export async function canonicalizeGamePath(
  gamePath: string,
  canonicalizePath: CanonicalizePath
): Promise<string> {
  return normalizePath(await canonicalizePath(gamePath));
}

export function pathBasename(path: string): string {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? normalized;
}

export function joinLockPath(directory: string, fileName: string): string {
  if (directory === "") return fileName;

  const separator =
    directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}
