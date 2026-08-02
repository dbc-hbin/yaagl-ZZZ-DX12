import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const binary = "sidecar/runtime/libyaagl-zzz-rt-shim.dylib";
const source = "src/wine/d3dmetal.ts";
const hash = createHash("sha256")
  .update(await readFile(binary))
  .digest("hex");
const text = await readFile(source, "utf8");
const pattern =
  /export const D3DMETAL_ZZZ_RT_SHIM_SHA256 =\n  "[0-9a-f]{64}" as const;/;
if (!pattern.test(text))
  throw new Error("ZZZ RT shim hash declaration is missing");
await writeFile(
  source,
  text.replace(
    pattern,
    `export const D3DMETAL_ZZZ_RT_SHIM_SHA256 =\n  "${hash}" as const;`
  )
);
console.log(hash);
