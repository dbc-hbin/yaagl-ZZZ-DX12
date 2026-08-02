import { describe, expect, it } from "vitest";
import {
  createCommandQueue,
  findMountedReadOnlyImage,
  readHostTextInChunks,
} from "./neutralino-adapter";

const source = "/Users/test/Downloads/Game_Porting_Toolkit_4.0_beta_2.dmg";

describe("mounted GPTK image discovery", () => {
  it("reuses only an exact, read-only mounted source", () => {
    expect(
      findMountedReadOnlyImage(
        {
          images: [
            {
              "image-path": source,
              writeable: false,
              "system-entities": [
                { "dev-entry": "/dev/disk7" },
                {
                  "dev-entry": "/dev/disk7s2",
                  "mount-point": "/Volumes/Game Porting Toolkit",
                },
              ],
            },
          ],
        },
        source
      )
    ).toEqual({
      mountPoint: "/Volumes/Game Porting Toolkit",
      device: "/dev/disk7s2",
    });
  });

  it("rejects writable, unmounted, and differently sourced images", () => {
    expect(
      findMountedReadOnlyImage(
        {
          images: [
            {
              "image-path": source,
              writeable: true,
              "system-entities": [{ "mount-point": "/Volumes/Writable GPTK" }],
            },
          ],
        },
        source
      )
    ).toBeUndefined();
    expect(
      findMountedReadOnlyImage(
        {
          images: [
            {
              "image-path": source,
              writeable: false,
              "system-entities": [{ "dev-entry": "/dev/disk7" }],
            },
          ],
        },
        source
      )
    ).toBeUndefined();
    expect(
      findMountedReadOnlyImage(
        {
          images: [
            {
              "image-path": "/tmp/not-the-selected-image.dmg",
              writeable: false,
              "system-entities": [
                { "mount-point": "/Volumes/Game Porting Toolkit" },
              ],
            },
          ],
        },
        source
      )
    ).toBeUndefined();
  });
});

describe("GPTK host command queue", () => {
  it("runs overlapping operations in FIFO order", async () => {
    const enqueue = createCommandQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = enqueue(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return 1;
    });
    const second = enqueue(async () => {
      events.push("second:start");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("continues after a rejected operation", async () => {
    const enqueue = createCommandQueue();
    const failure = enqueue(async () => {
      throw new Error("expected failure");
    });
    const success = enqueue(async () => "recovered");

    await expect(failure).rejects.toThrow("expected failure");
    await expect(success).resolves.toBe("recovered");
  });
});

describe("GPTK host text reader", () => {
  it("reassembles UTF-8 text across byte chunk boundaries", async () => {
    const expected = `${"x".repeat(767)}한글🙂${"y".repeat(900)}`;
    const bytes = new TextEncoder().encode(expected);
    const offsets: number[] = [];

    const actual = await readHostTextInChunks(
      "/tmp/manifest.json",
      bytes.byteLength,
      async (offset, size) => {
        offsets.push(offset);
        const chunk = bytes.subarray(offset, offset + size);
        let binary = "";
        for (const byte of chunk) binary += String.fromCharCode(byte);
        return btoa(binary);
      }
    );

    expect(actual).toBe(expected);
    expect(offsets).toEqual([0, 768, 1536]);
  });

  it("rejects incomplete host reads", async () => {
    await expect(
      readHostTextInChunks("/tmp/manifest.json", 4, async () => btoa("abc"))
    ).rejects.toThrow("Unable to read complete GPTK text file");
  });
});
