import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

const source = await readFile("src/wine/d3dmetal.ts", "utf8");
const readExpected = name => {
  const match = new RegExp(`${name} =\\n  "([0-9a-f]{64})" as const;`).exec(source);
  if (!match) {
    throw new Error(`Unable to read ${name}`);
  }
  return match[1];
};

const expectedProbe = readExpected("D3DMETAL_METAL_IR_PROBE_SHA256");
const expectedReplacement = readExpected("D3DMETAL_UNORM_REPLACEMENT_SHA256");

const checks = [
  {
    label: "source probe",
    path: "sidecar/diagnostics/libyaagl-metal-ir-capture.dylib",
    expected: expectedProbe,
  },
  {
    label: "app probe",
    path: "Yaagl ZZZ DX12.app/Contents/Resources/sidecar/diagnostics/libyaagl-metal-ir-capture.dylib",
    expected: expectedProbe,
  },
  {
    label: "source replacement",
    path: "sidecar/diagnostics/zzz-rt-unorm-float.dxil",
    expected: expectedReplacement,
  },
  {
    label: "app replacement",
    path: "Yaagl ZZZ DX12.app/Contents/Resources/sidecar/diagnostics/zzz-rt-unorm-float.dxil",
    expected: expectedReplacement,
  },
];

const observed = {};
for (const check of checks) {
  const bytes = await readFile(check.path);
  const actual = sha256(bytes);
  if (actual !== check.expected) {
    throw new Error(`${check.label} hash mismatch: ${actual}`);
  }
  observed[check.label] = actual;
}

const assetsDir = "dist/assets";
const entries = await readdir(assetsDir, { withFileTypes: true });
let embedded = false;
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const bundle = await readFile(join(assetsDir, entry.name));
  if (bundle.includes(Buffer.from(expectedProbe))) {
    embedded = true;
    break;
  }
}
if (!embedded) throw new Error("Frontend bundle does not embed the probe hash");

console.log(
  JSON.stringify(
    {
      expectedProbe,
      expectedReplacement,
      observed,
      frontendBundleEmbedsProbeHash: embedded,
    },
    null,
    2
  )
);
