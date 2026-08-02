export const ZZZ_VULKAN_DLL =
  "ZenlessZoneZero_Data/Plugins/x86_64/vulkan-1.dll";
export const ZZZ_VULKAN_DLL_BACKUP = `${ZZZ_VULKAN_DLL}.bak`;
export const ZZZ_GAME_EXECUTABLE = "ZenlessZoneZero.exe";
export const ZZZ_SHARED_GAME_DIRECTORY = "/Applications/ZenlessZoneZero";

export type GraphicsSnapshot = Readonly<Record<string, string>>;

export function isProtectedZzzRootGraphicsDll(fileName: string) {
  const normalized = fileName.toLowerCase();
  return (
    /^nvngx.*\.dll$/.test(normalized) ||
    /^sl\..*\.dll$/.test(normalized) ||
    /^amd_fidelityfx.*\.dll$/.test(normalized)
  );
}

export function changedGraphicsFiles(
  before: GraphicsSnapshot,
  after: GraphicsSnapshot
) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter(path => before[path] !== after[path])
    .sort((left, right) => left.localeCompare(right));
}

export function assertGraphicsSnapshotUnchanged(
  before: GraphicsSnapshot,
  after: GraphicsSnapshot
) {
  const changed = changedGraphicsFiles(before, after);
  if (changed.length > 0) {
    throw new Error(
      `Shared ZZZ graphics files changed during launch: ${changed.join(", ")}`
    );
  }
}
