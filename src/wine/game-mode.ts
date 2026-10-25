import { dirname, join } from "path-browserify";
import { exec, readFile, stats } from "@utils";
import { getCorrectWineBinary } from "./wine";

const GAME_MODE_SUPERVISOR = "libexec/yaagl-game-mode/game-policy-supervisor";
const GAME_MODE_HOST = "libexec/yaagl-game-mode/ZZZ.app/Contents/MacOS/wine";

// Check hardware rather than the launcher's architecture (which may be Rosetta).
export async function preflightGameMode(): Promise<string> {
  const [version, hardware] = await Promise.all([
    exec(["/usr/bin/sw_vers", "-productVersion"]),
    exec(["/usr/sbin/sysctl", "-n", "hw.optional.arm64"]),
  ]);
  if (
    Number(version.stdOut.trim().split(".")[0]) < 26 ||
    !/^\d+\./.test(version.stdOut.trim()) ||
    hardware.stdOut.trim() !== "1"
  ) {
    throw new Error("Game Mode requires Apple Silicon and macOS 26 or later.");
  }
  const root = dirname(dirname(await getCorrectWineBinary()));
  const manifest = JSON.parse(
    await readFile(join(root, "yaagl-d3dmetal-runtime.json"))
  );
  if (
    manifest.gameMode?.version !== 3 ||
    manifest.gameMode?.target !== "zzz" ||
    manifest.gameMode?.supervisor !== GAME_MODE_SUPERVISOR ||
    manifest.gameMode?.host !== GAME_MODE_HOST
  ) {
    throw new Error(
      "The selected Wine runtime does not support ZZZ Game Mode."
    );
  }
  const supervisor = join(root, GAME_MODE_SUPERVISOR);
  if (!(await stats(supervisor)).isFile) {
    throw new Error(
      "The selected Wine runtime's Game Mode supervisor is missing."
    );
  }
  if (!(await stats(join(root, GAME_MODE_HOST))).isFile) {
    throw new Error("The selected Wine runtime's Game Mode host is missing.");
  }
  return supervisor;
}
