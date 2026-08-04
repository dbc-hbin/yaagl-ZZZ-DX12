import { exec } from "@utils";

export function parseD3DMetalRuntimeFileIdentity(
  output: string,
  expectedFiles: number
) {
  const lines = output.trim().split("\n");
  if (
    lines.length !== expectedFiles ||
    lines.some(
      line =>
        !/^[0-9]+:[0-9]+:[0-9]+:[0-9]+(?:\.[0-9]+)?:[0-9]+(?:\.[0-9]+)?$/.test(
          line
        )
    )
  ) {
    throw new Error("Unable to identify D3DMetal runtime files");
  }
  return lines.join("|");
}

export async function fingerprintD3DMetalRuntimeFiles(
  paths: readonly string[]
) {
  const format = ["%d", "%i", "%z", "%Fm", "%Fc"].join(":");
  const result = await exec(["/usr/bin/stat", "-f", format, ...paths]);
  return parseD3DMetalRuntimeFileIdentity(result.stdOut, paths.length);
}

export class RuntimeValidationCache<T> {
  private entry: { identity: string; value: T } | undefined;

  get(identity: string) {
    return this.entry?.identity === identity ? this.entry.value : undefined;
  }

  set(identity: string, value: T) {
    this.entry = { identity, value };
  }

  clear() {
    this.entry = undefined;
  }
}
