import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const binary = "sidecar/diagnostics/libyaagl-metal-ir-capture.dylib";
const identitySource = "src/wine/d3dmetal.ts";
const hash = createHash("sha256").update(await readFile(binary)).digest("hex");
const identityPattern = /export const D3DMETAL_METAL_IR_PROBE_SHA256 =\n  "[0-9a-f]{64}" as const;\n(?:\/\*\*[^\n]*\*\/\n)?export const D3DMETAL_METAL_IR_CAPTURE_SHA256 =\n  (?:"[0-9a-f]{64}" as const|D3DMETAL_METAL_IR_PROBE_SHA256);/;
const identityCurrent = await readFile(identitySource, "utf8");
if (!identityPattern.test(identityCurrent)) {
  throw new Error("Metal IR identity block is missing or ambiguous");
}
const identityReplacement = `export const D3DMETAL_METAL_IR_PROBE_SHA256 =\n  "${hash}" as const;\nexport const D3DMETAL_METAL_IR_CAPTURE_SHA256 =\n  D3DMETAL_METAL_IR_PROBE_SHA256;`;
await writeFile(
  identitySource,
  identityCurrent.replace(identityPattern, identityReplacement)
);

console.log(hash);
