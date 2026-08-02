import { describe, expect, it } from "vitest";
import {
  assertGraphicsSnapshotUnchanged,
  changedGraphicsFiles,
  isProtectedZzzRootGraphicsDll,
  ZZZ_GAME_EXECUTABLE,
} from "./graphics-integrity";

describe("shared ZZZ graphics integrity", () => {
  it.each([
    "nvngx_dlss.dll",
    "nvngx_dlssd.dll",
    "nvngx_dlssg.dll",
    "sl.common.dll",
    "sl.interposer.dll",
    "amd_fidelityfx_upscaler_dx12.dll",
  ])("protects %s", fileName => {
    expect(isProtectedZzzRootGraphicsDll(fileName)).toBe(true);
  });

  it.each(["dxgi.dll", "ZenlessZoneZero.exe", "sl-not-a-module.dll"])(
    "does not expand the protected root set to %s",
    fileName => {
      expect(isProtectedZzzRootGraphicsDll(fileName)).toBe(false);
    }
  );

  it("reports hash changes, additions, and removals deterministically", () => {
    expect(
      changedGraphicsFiles(
        { "a.dll": "same", "removed.dll": "old", "changed.dll": "old" },
        { "a.dll": "same", "added.dll": "new", "changed.dll": "new" }
      )
    ).toEqual(["added.dll", "changed.dll", "removed.dll"]);

    expect(() =>
      assertGraphicsSnapshotUnchanged({ "a.dll": "same" }, { "a.dll": "same" })
    ).not.toThrow();
    expect(() =>
      assertGraphicsSnapshotUnchanged({ "a.dll": "old" }, { "a.dll": "new" })
    ).toThrow("Shared ZZZ graphics files changed during launch: a.dll");
  });

  it("keeps the shared game executable in the launch snapshot contract", () => {
    expect(ZZZ_GAME_EXECUTABLE).toBe("ZenlessZoneZero.exe");
  });
});
