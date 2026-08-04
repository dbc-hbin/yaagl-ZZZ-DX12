import { describe, expect, it } from "vitest";
import {
  parseD3DMetalRuntimeFileIdentity,
  RuntimeValidationCache,
} from "./d3dmetal-validation-cache";

describe("D3DMetal runtime validation cache", () => {
  it("parses exact stat identities for the expected file count", () => {
    expect(
      parseD3DMetalRuntimeFileIdentity(
        "1:2:3:4.125:5.25\n6:7:8:9.5:10.75\n",
        2
      )
    ).toBe("1:2:3:4.125:5.25|6:7:8:9.5:10.75");
  });

  it("rejects missing, extra, or malformed identity records", () => {
    expect(() => parseD3DMetalRuntimeFileIdentity("1:2:3:4:5\n", 2)).toThrow();
    expect(() =>
      parseD3DMetalRuntimeFileIdentity("1:2:3:4:5\n6:7:8:9:10\n", 1)
    ).toThrow();
    expect(() => parseD3DMetalRuntimeFileIdentity("1:2:bad:4:5\n", 1)).toThrow();
  });

  it("reuses only the exact identity and invalidates on change", () => {
    const cache = new RuntimeValidationCache<{ value: number }>();
    const validation = { value: 7 };
    expect(cache.get("a")).toBeUndefined();
    cache.set("a", validation);
    expect(cache.get("a")).toBe(validation);
    expect(cache.get("b")).toBeUndefined();
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});
