import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await readFile("src/wine/d3dmetal.ts", "utf8");
const match =
  /D3DMETAL_ZZZ_RT_SHIM_SHA256 =\n  "([0-9a-f]{64})" as const;/.exec(source);
if (!match) throw new Error("Unable to read expected ZZZ RT shim hash");
const paths = ["sidecar/runtime/libyaagl-zzz-rt-shim.dylib"];
if (process.argv[2] !== "--source-only") {
  paths.push(
    "Yaagl ZZZ DX12.app/Contents/Resources/sidecar/runtime/libyaagl-zzz-rt-shim.dylib"
  );
}
for (const path of paths) {
  const actual = sha256(await readFile(path));
  if (actual !== match[1])
    throw new Error(`${path}: expected ${match[1]}, found ${actual}`);
}
console.log(match[1]);
