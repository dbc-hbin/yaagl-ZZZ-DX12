export const MINIMUM_ZZZ_DX12_MACOS_MAJOR = 27;

export function parseMacOSMajor(version: string): number {
  const major = Number.parseInt(version.trim().split(".")[0], 10);
  if (!Number.isSafeInteger(major)) {
    throw new Error(`Unable to determine macOS version: ${version}`);
  }
  return major;
}

export function assertZzzDx12Platform({
  macOSVersion,
  appleSilicon,
}: {
  macOSVersion: string;
  appleSilicon: boolean;
}) {
  if (!appleSilicon) {
    throw new Error("Yaagl ZZZ DX12 requires an Apple Silicon Mac.");
  }
  if (parseMacOSMajor(macOSVersion) < MINIMUM_ZZZ_DX12_MACOS_MAJOR) {
    throw new Error(
      `Yaagl ZZZ DX12 requires macOS ${MINIMUM_ZZZ_DX12_MACOS_MAJOR} or later (found ${macOSVersion}).`
    );
  }
}
