import { describe, expect, it } from "vitest";
import { WineDistribution } from "./distro";
import { assertWineArchiveIdentity } from "./runtime-manifest";

const pinnedDistro: WineDistribution = {
  id: "test-wine",
  displayName: "Test Wine",
  remoteUrl: "https://example.invalid/wine.tar.xz",
  archiveSha256: "a".repeat(64),
  archiveSize: 123,
  wineVersion: "wine-11.0",
  attributes: { renderBackend: "d3dmetal" },
};

describe("Wine archive identity", () => {
  it("accepts only the pinned size and SHA-256", () => {
    expect(() =>
      assertWineArchiveIdentity({
        distro: pinnedDistro,
        actualSha256: "A".repeat(64),
        actualSize: 123,
      })
    ).not.toThrow();
    expect(() =>
      assertWineArchiveIdentity({
        distro: pinnedDistro,
        actualSha256: "b".repeat(64),
        actualSize: 123,
      })
    ).toThrow("Wine archive SHA-256 mismatch");
    expect(() =>
      assertWineArchiveIdentity({
        distro: pinnedDistro,
        actualSha256: "a".repeat(64),
        actualSize: 122,
      })
    ).toThrow("Wine archive size mismatch");
  });

  it("rejects an unpinned D3DMetal distribution", () => {
    expect(() =>
      assertWineArchiveIdentity({
        distro: { ...pinnedDistro, archiveSha256: undefined },
        actualSha256: "a".repeat(64),
        actualSize: 123,
      })
    ).toThrow("Wine distribution is not pinned");
  });
});
