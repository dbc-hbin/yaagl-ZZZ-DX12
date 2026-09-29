import { describe, expect, it, vi } from "vitest";

const exec = vi.fn();

vi.mock("@utils", () => ({
  exec: (args: string[]) => exec(args),
  fileOrDirExists: vi.fn(),
  generateRandomString: vi.fn(),
  mkdirp: vi.fn(),
  removeFile: vi.fn(),
  resolve: (path: string) => path,
}));

const { verifyD3DMetalArchive, D3DMETAL_WINE_11_17 } = await import(
  "./d3dmetal"
);

function fakeArchive(size: number, sha256: string) {
  exec.mockImplementation(async (args: string[]) => ({
    stdOut: args[0] === "/usr/bin/stat" ? `${size}\n` : `${sha256}  archive\n`,
  }));
}

describe("verifyD3DMetalArchive", () => {
  const pinned = D3DMETAL_WINE_11_17;

  it("accepts an archive matching the runtime pins", async () => {
    fakeArchive(pinned.archiveSize, pinned.archiveSha256);
    await expect(
      verifyD3DMetalArchive(pinned, "archive")
    ).resolves.toBeUndefined();
  });

  it("rejects an archive with the right size but another runtime's hash", async () => {
    fakeArchive(pinned.archiveSize, "f".repeat(64));
    await expect(verifyD3DMetalArchive(pinned, "archive")).rejects.toThrow(
      "SHA-256 mismatch"
    );
  });

  it("rejects a size mismatch before hashing", async () => {
    fakeArchive(pinned.archiveSize + 1, pinned.archiveSha256);
    await expect(verifyD3DMetalArchive(pinned, "archive")).rejects.toThrow(
      "size mismatch"
    );
  });
});
