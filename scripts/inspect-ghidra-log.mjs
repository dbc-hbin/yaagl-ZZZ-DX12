import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("usage: inspect-ghidra-log.mjs <path>");

const text = await readFile(path, "utf8");
const headings = [
  "Graphics compile",
  "Compute compile",
  "D3DMStageCache/CompileRTFunction",
  "EncodeDispatchRays",
  "DispatchRaysIndirect encoder",
];

for (const heading of headings) {
  const marker = `=== ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) continue;
  const next = text.indexOf("\n=== ", start + marker.length);
  process.stdout.write(text.slice(start, next < 0 ? text.length : next));
  process.stdout.write("\n");
}
