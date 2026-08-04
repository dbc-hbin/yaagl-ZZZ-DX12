import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFP64CodecPatch,
  FP64_CODEC_PATCH_SITES,
  inspectFP64CodecPatch,
} from "./metalir-fp64-codec-patch.mjs";

const fixtureSize = Math.max(
  ...FP64_CODEC_PATCH_SITES.map(
    site => site.offset + site.expectedOriginal.length
  )
);

function pristineFixture() {
  const fixture = Buffer.alloc(fixtureSize);
  for (const site of FP64_CODEC_PATCH_SITES) {
    site.expectedOriginal.copy(fixture, site.offset);
  }
  return fixture;
}

describe("GPTK 4.0b2 Metal IR FP64 codec patch", () => {
  it("recognizes and patches exactly the three locked sites", () => {
    const pristine = pristineFixture();
    assert.equal(inspectFP64CodecPatch(pristine).mode, "original");

    const patched = applyFP64CodecPatch(pristine);
    const inspection = inspectFP64CodecPatch(patched);
    assert.equal(inspection.mode, "patched");
    assert.deepEqual(
      inspection.sites.map(site => site.state),
      ["patched", "patched", "patched"]
    );

    const changed = [];
    for (let index = 0; index < pristine.length; index += 1) {
      if (pristine[index] !== patched[index]) changed.push(index);
    }
    assert.deepEqual(changed, [
      0xa19f8b,
      0xa1a147,
      0xa1a148,
      0xa1a149,
      0xa1a14a,
      0xa1a14b,
      0xa1b900,
      0xa1b901,
    ]);
  });

  it("fails closed on a partial or already patched binary", () => {
    const partial = pristineFixture();
    FP64_CODEC_PATCH_SITES[0].patched.copy(
      partial,
      FP64_CODEC_PATCH_SITES[0].offset
    );
    assert.equal(inspectFP64CodecPatch(partial).mode, "unknown-or-partial");
    assert.throws(() => applyFP64CodecPatch(partial), /refusing patch/);
  });

  it("reports truncated input without throwing", () => {
    const inspection = inspectFP64CodecPatch(Buffer.alloc(8));
    assert.equal(inspection.mode, "unknown-or-partial");
    assert.ok(inspection.sites.every(site => site.value === "truncated"));
  });
});
