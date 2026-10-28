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

export const D3DMETAL_RUNTIME_ID = "wine-11.20-d3dmetal-gptk4.0b3-2";
const D3DMETAL_RELEASE =
  "https://github.com/dbc-hbin/wine-yaagl-d3dmetal/releases/download/wine-11.20-gptk4.0b3-2";
const D3DMETAL_ARCHIVE_NAME = "wine-11.20-d3dmetal-gptk4.0b3-macos26.tar.xz";
export const D3DMETAL_RUNTIME_URL = `${D3DMETAL_RELEASE}/${D3DMETAL_ARCHIVE_NAME}`;
// Pins from the independently published Wine release.
const D3DMETAL_ARCHIVE_SHA256 =
  "238994c8fdad7f5464f8c0d6451a680bb3dd0396c5b3e18f4fb4775b015a84d9";
const D3DMETAL_ARCHIVE_SIZE = 307840868;
const LICENSE_SHA256 =
  "5abb2d059be217663b00e8fd37e14411d374e11d17e3b744eebd49b8d17118c8";

async function sha256File(path: string): Promise<string> {
  const output = (
    await exec(["/usr/bin/shasum", "-a", "256", path])
  ).stdOut.trim();
  // shasum prefixes an escape marker when the filename contains a backslash.
  const hash = /^\\?([a-f0-9]{64})\s/i.exec(output);
  if (!hash) throw new Error(`Could not hash D3DMetal artifact: ${path}`);
  return hash[1].toLowerCase();
}

async function assertFileHash(path: string, expected: string) {
  if ((await sha256File(path)) !== expected) {
    throw new Error(`D3DMetal artifact SHA-256 mismatch: ${path}`);
  }
}

export async function verifyD3DMetalArchive(path: string) {
  const size = Number(
    (await exec(["/usr/bin/stat", "-f", "%z", path])).stdOut.trim()
  );
  if (size !== D3DMETAL_ARCHIVE_SIZE) {
    throw new Error("D3DMetal Wine archive size mismatch");
  }
  await assertFileHash(path, D3DMETAL_ARCHIVE_SHA256);
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
        uri: `${D3DMETAL_RELEASE}/License.rtf`,
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

export async function verifyD3DMetalWine(wineRoot: string) {
  await exec([
    "/usr/bin/codesign",
    "--verify",
    "--strict",
    join(wineRoot, "lib/external/D3DMetal.framework"),
  ]);
}
