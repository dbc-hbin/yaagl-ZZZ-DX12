import { describe, expect, it } from "vitest";
import { assertZzzDx12Platform, parseMacOSMajor } from "./zzz-dx12";

describe("ZZZ DX12 platform requirements", () => {
  it("accepts Apple Silicon on macOS 27 and later", () => {
    expect(() =>
      assertZzzDx12Platform({ macOSVersion: "27.0", appleSilicon: true })
    ).not.toThrow();
    expect(parseMacOSMajor("27.0.0")).toBe(27);
  });

  it("rejects Intel and older macOS releases", () => {
    expect(() =>
      assertZzzDx12Platform({ macOSVersion: "26.6", appleSilicon: false })
    ).toThrow(/Apple Silicon/);
    expect(() =>
      assertZzzDx12Platform({ macOSVersion: "26.6", appleSilicon: true })
    ).toThrow(/macOS 27/);
  });
});
