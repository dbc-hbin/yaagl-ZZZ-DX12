import type { Aria2 } from "@aria2";
import { join } from "path-browserify";
import {
  exec,
  fileOrDirExists,
  generateRandomString,
  mkdirp,
  removeFile,
  resolve,
} from "@utils";

export interface D3DMetalRuntime {
  id: string;
  remoteUrl: string;
  archiveSize: number;
  archiveSha256: string;
  helperSha256: string;
}

const WINE_RELEASES =
  "https://github.com/dbc-hbin/wine-yaagl-d3dmetal/releases/download";

// Pins from the independently published Wine release. Every runtime shares
// the GPTK 4.0b2 license and native cache below.
export const D3DMETAL_WINE_11_17: D3DMetalRuntime = {
  id: "wine-11.17-d3dmetal-gptk4.0b2-6",
  remoteUrl: `${WINE_RELEASES}/wine-11.17-gptk4.0b2-6/wine-11.17-d3dmetal-gptk4.0b2-macos26.tar.xz`,
  archiveSize: 237660428,
  archiveSha256:
    "afe6c949a0ce1900723bb41356d30240a071fc9b1518f0b878910f7bb7dec07c",
  helperSha256:
    "dd95f9be1c49ed8eb55f3b0b46a7bb4b4c2c95e57d6b81d30b5b8f776f613114",
};

export const D3DMETAL_RUNTIMES: D3DMetalRuntime[] = [D3DMETAL_WINE_11_17];

const OFFICIAL_RELEASE =
  "https://github.com/dbc-hbin/d3dmetal-redistributable/releases/download/gptk-4.0b2";
const LICENSE_SHA256 =
  "5abb2d059be217663b00e8fd37e14411d374e11d17e3b744eebd49b8d17118c8";

async function sha256File(path: string): Promise<string> {
  const output = (
    await exec(["/usr/bin/shasum", "-a", "256", path])
  ).stdOut.trim();
  const hash = /^([a-f0-9]{64})\s/i.exec(output);
  if (!hash) throw new Error(`Could not hash D3DMetal artifact: ${path}`);
  return hash[1].toLowerCase();
}

async function assertFileHash(path: string, expected: string) {
  if ((await sha256File(path)) !== expected) {
    throw new Error(`D3DMetal artifact SHA-256 mismatch: ${path}`);
  }
}

export async function verifyD3DMetalArchive(
  runtime: D3DMetalRuntime,
  path: string
) {
  const size = Number(
    (await exec(["/usr/bin/stat", "-f", "%z", path])).stdOut.trim()
  );
  if (size !== runtime.archiveSize) {
    throw new Error("D3DMetal Wine archive size mismatch");
  }
  await assertFileHash(path, runtime.archiveSha256);
}

export async function loadD3DMetalLicense(aria2: Aria2): Promise<string> {
  const directory = resolve("./d3dmetal-license");
  const license = join(directory, "License.rtf");
  await mkdirp(directory);
  if (
    !(await fileOrDirExists(license)) ||
    (await sha256File(license)) !== LICENSE_SHA256
  ) {
    const downloaded = join(
      directory,
      `License.${generateRandomString(16)}.rtf`
    );
    try {
      for await (const _ of aria2.doStreamingDownload({
        uri: `${OFFICIAL_RELEASE}/License.rtf`,
        absDst: downloaded,
      })) {
        /* License is small; UI remains in loading state. */
      }
      await assertFileHash(downloaded, LICENSE_SHA256);
      await exec(["/bin/mv", "-f", downloaded, license]);
    } finally {
      if (await fileOrDirExists(downloaded)) await removeFile(downloaded);
    }
  }
  await assertFileHash(license, LICENSE_SHA256);
  const text = (
    await exec(["/usr/bin/textutil", "-convert", "txt", "-stdout", license])
  ).stdOut;
  if (!text.trim())
    throw new Error("Verified Apple license converted to empty text");
  return text;
}

export async function prepareD3DMetalWine(
  runtime: D3DMetalRuntime,
  wineRoot: string
) {
  const helper = join(
    wineRoot,
    "libexec/yaagl-d3dmetal/prepare-d3dmetal-runtime"
  );
  await assertFileHash(helper, runtime.helperSha256);
  await exec(["/usr/bin/codesign", "--verify", "--strict", helper]);
  const output = join(wineRoot, "lib/external");
  const prepared = join(wineRoot, ".prepared-d3dmetal");
  await exec([
    helper,
    "--output",
    prepared,
    "--cache",
    resolve("./d3dmetal-native-cache"),
    "--accept-apple-license",
  ]);
  // The native helper validates its inputs, signatures and finished output
  // before publishing the prepared directory.
  for (const name of [
    "D3DMetal.framework",
    "prepared-d3dmetal.json",
    "License.rtf",
    "Acknowledgements.rtf",
    "SHA256SUMS",
  ]) {
    await exec(["/bin/mv", join(prepared, name), join(output, name)]);
  }
  await exec(["/bin/rmdir", prepared]);
}
