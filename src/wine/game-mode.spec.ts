import { beforeEach, describe, expect, it, vi } from "vitest";
import { exec, readFile, stats } from "@utils";
import { getCorrectWineBinary } from "./wine";
import { preflightGameMode } from "./game-mode";

vi.mock("@utils", () => ({
  exec: vi.fn(),
  readFile: vi.fn(),
  stats: vi.fn(),
}));
vi.mock("./wine", () => ({ getCorrectWineBinary: vi.fn() }));

const supervisor = "libexec/yaagl-game-mode/game-policy-supervisor";
const host = "libexec/yaagl-game-mode/ZZZ.app/Contents/MacOS/wine";
const manifest = { gameMode: { version: 3, target: "zzz", supervisor, host } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCorrectWineBinary).mockResolvedValue(
    "/selected/runtime/bin/wine"
  );
  vi.mocked(exec).mockImplementation(async command => ({
    pid: 1,
    exitCode: 0,
    stdOut: command[0] === "/usr/bin/sw_vers" ? "26.0\n" : "1\n",
    stdErr: "",
  }));
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(manifest));
  vi.mocked(stats).mockResolvedValue({
    isFile: true,
    isDirectory: false,
    size: 1,
  });
});

describe("Game Mode capability preflight", () => {
  it("returns the supervisor from the selected runtime", async () => {
    await expect(preflightGameMode()).resolves.toBe(
      `/selected/runtime/${supervisor}`
    );
    expect(readFile).toHaveBeenCalledWith(
      "/selected/runtime/yaagl-d3dmetal-runtime.json"
    );
    expect(stats).toHaveBeenCalledWith(`/selected/runtime/${supervisor}`);
    expect(stats).toHaveBeenCalledWith(`/selected/runtime/${host}`);
  });

  it.each(["25.6", "unknown"])(
    "rejects unsupported macOS version %s",
    async version => {
      vi.mocked(exec).mockResolvedValue({
        pid: 1,
        exitCode: 0,
        stdOut: version,
        stdErr: "",
      });
      await expect(preflightGameMode()).rejects.toThrow();
      expect(readFile).not.toHaveBeenCalled();
    }
  );

  it("rejects non-Apple-Silicon hardware", async () => {
    vi.mocked(exec).mockImplementation(async command => ({
      pid: 1,
      exitCode: 0,
      stdErr: "",
      stdOut: command[0] === "/usr/bin/sw_vers" ? "26.0" : "0",
    }));
    await expect(preflightGameMode()).rejects.toThrow();
  });

  it.each([
    {},
    { gameMode: { ...manifest.gameMode, version: 1 } },
    { gameMode: { ...manifest.gameMode, version: 2 } },
    { gameMode: { ...manifest.gameMode, version: 4 } },
    { gameMode: { version: 3, target: "zzz", supervisor } },
    { gameMode: { version: 3, target: "zzz", host } },
    { gameMode: { ...manifest.gameMode, target: "other" } },
    { gameMode: { ...manifest.gameMode, supervisor: "../wine" } },
    { gameMode: { ...manifest.gameMode, host: "../wine" } },
  ])("rejects incompatible capability metadata", async value => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(value));
    await expect(preflightGameMode()).rejects.toThrow();
    expect(stats).not.toHaveBeenCalled();
  });

  it("rejects a missing supervisor", async () => {
    vi.mocked(stats).mockRejectedValue(new Error("missing"));
    await expect(preflightGameMode()).rejects.toThrow();
  });
  it("rejects a supervisor path that is a directory", async () => {
    vi.mocked(stats).mockResolvedValue({
      isFile: false,
      isDirectory: true,
      size: 0,
    });
    await expect(preflightGameMode()).rejects.toThrow();
  });

  it("rejects a missing host", async () => {
    vi.mocked(stats).mockImplementation(async path => {
      if (path === `/selected/runtime/${host}`) throw new Error("missing");
      return { isFile: true, isDirectory: false, size: 1 };
    });
    await expect(preflightGameMode()).rejects.toThrow();
    expect(stats).toHaveBeenCalledWith(`/selected/runtime/${host}`);
  });

  it("rejects a host path that is a directory", async () => {
    vi.mocked(stats).mockImplementation(async path => ({
      isFile: path !== `/selected/runtime/${host}`,
      isDirectory: path === `/selected/runtime/${host}`,
      size: 0,
    }));
    await expect(preflightGameMode()).rejects.toThrow();
    expect(stats).toHaveBeenCalledWith(`/selected/runtime/${host}`);
  });
});
