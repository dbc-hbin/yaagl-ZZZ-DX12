#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const METAL_IR_CONVERTER_4_0_BETA_2_SHA256 =
  "75974d49ad4dd1bdf17ab3cd666ae7cac43e7f7a5760237699ab33ecd3d31daf";

/**
 * Experimental narrow fix for the codec-shaped FP64 islands observed in the
 * twelve captured ZZZ shaders. The three sites are all inside
 * AIRBuilder::patchFP64Operations in GPTK 4.0 beta 2.
 *
 * This deliberately does not claim to be a general FP64 lowering fix. In
 * particular, the constrained-SIToFP branch still uses the converter's
 * existing constrained-UIToFP intrinsic. Captured shaders use the normal
 * non-constrained path; product validation must keep that limitation visible.
 */
export const FP64_CODEC_PATCH_SITES = [
  {
    name: "accept-i32-ui-to-fp-source",
    offset: 0xa19f8b,
    expectedOriginal: Buffer.from([0xd8]),
    patched: Buffer.from([0xf0]),
  },
  {
    name: "route-si-to-fp-to-integer-cast-handler",
    offset: 0xa1b900,
    expectedOriginal: Buffer.from([0xf7, 0xfa, 0xff, 0xff]),
    patched: Buffer.from([0xb5, 0xe1, 0xff, 0xff]),
  },
  {
    name: "select-signed-or-unsigned-fp-cast-opcode",
    offset: 0xa1a147,
    expectedOriginal: Buffer.from([0xbe, 0x2b, 0x00, 0x00, 0x00]),
    // lea -0x1c(%rbp), %esi; nop; nop
    // ValueID 71 (UIToFP) -> opcode 43, ValueID 72 (SIToFP) -> opcode 44.
    patched: Buffer.from([0x8d, 0x75, 0xe4, 0x90, 0x90]),
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesAt(bytes, site) {
  const length = Math.max(site.expectedOriginal.length, site.patched.length);
  if (site.offset + length > bytes.length) return null;
  return bytes.subarray(site.offset, site.offset + length);
}

export function inspectFP64CodecPatch(bytes) {
  const sites = FP64_CODEC_PATCH_SITES.map(site => {
    const value = bytesAt(bytes, site);
    let state = "unknown";
    if (value?.equals(site.expectedOriginal)) state = "original";
    if (value?.equals(site.patched)) state = "patched";
    return {
      name: site.name,
      offset: site.offset,
      state,
      value: value?.toString("hex") ?? "truncated",
    };
  });
  const states = new Set(sites.map(site => site.state));
  return {
    sha256: sha256(bytes),
    mode:
      states.size === 1 && states.has("original")
        ? "original"
        : states.size === 1 && states.has("patched")
          ? "patched"
          : "unknown-or-partial",
    sites,
  };
}

export function applyFP64CodecPatch(bytes) {
  const output = Buffer.from(bytes);
  const inspection = inspectFP64CodecPatch(output);
  if (inspection.mode !== "original") {
    throw new Error(
      `refusing patch: expected all original sites, got ${inspection.mode}: ` +
        inspection.sites.map(site => `${site.name}=${site.value}`).join(", ")
    );
  }
  for (const site of FP64_CODEC_PATCH_SITES) {
    site.patched.copy(output, site.offset);
  }
  return output;
}

async function patchFile(inputPath, outputPath) {
  const input = await readFile(inputPath);
  const inputHash = sha256(input);
  if (inputHash !== METAL_IR_CONVERTER_4_0_BETA_2_SHA256) {
    throw new Error(
      `refusing patch: expected SHA-256 ${METAL_IR_CONVERTER_4_0_BETA_2_SHA256}, got ${inputHash}`
    );
  }

  const output = applyFP64CodecPatch(input);
  const inputStat = await stat(inputPath);
  const temporaryPath = `${outputPath}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, output);
  await chmod(temporaryPath, inputStat.mode);
  await rename(temporaryPath, outputPath);
  return inspectFP64CodecPatch(output);
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "inspect" && args.length === 1) {
    console.log(JSON.stringify(inspectFP64CodecPatch(await readFile(args[0])), null, 2));
    return;
  }
  if (command === "patch" && args.length === 2) {
    console.log(JSON.stringify(await patchFile(args[0], args[1]), null, 2));
    return;
  }
  throw new Error(
    "Usage: metalir-fp64-codec-patch.mjs inspect <binary> | patch <pristine-binary> <output>"
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
