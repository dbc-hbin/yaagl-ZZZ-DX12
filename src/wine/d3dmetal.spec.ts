import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aria2 } from "@aria2";
import type { Locale } from "@locale";
import { createCommonUpdateUI } from "@common-update-ui";
import {
  exec,
  fileOrDirExists,
  getKeyOrDefault,
  removeFile,
  rmrf_dangerously,
  setKey,
  tar_extract_directory,
  _safeRelaunch,
} from "@utils";
import { createD3DMetalLicenseUI } from "./d3dmetal-license";
import { createWine } from "./wine";
import { getWineDistributions } from "./distro";
import { createWineInstallProgram } from "./wine-install-program";
import {
  D3DMETAL_RUNTIME_ID,
  D3DMETAL_RUNTIME_URL,
  loadD3DMetalLicense,
} from "./d3dmetal";

vi.mock("@utils", () => ({
  exec: vi.fn(),
  fileOrDirExists: vi.fn(),
  generateRandomString: vi.fn(() => "unique"),
  getKeyOrDefault: vi.fn(),
  humanFileSize: vi.fn(() => "0 B"),
  mkdirp: vi.fn(),
  removeFile: vi.fn(),
  resolve: vi.fn((path: string) => `/test/${path.replace(/^\.\//, "")}`),
  rmrf_dangerously: vi.fn(),
  setKey: vi.fn(),
  tar_extract: vi.fn(),
  tar_extract_directory: vi.fn(),
  xattrRemove: vi.fn(),
  _safeRelaunch: vi.fn(),
}));
vi.mock("@common-update-ui", () => ({ createCommonUpdateUI: vi.fn() }));
vi.mock("./d3dmetal-license", () => ({ createD3DMetalLicenseUI: vi.fn() }));
vi.mock("./wine", () => ({ createWine: vi.fn() }));
vi.mock("./cert", () => ({ addCertsToWine: vi.fn() }));
vi.mock("./mf", () => ({ installMediaFoundation: vi.fn() }));
vi.mock("../hosts", () => ({ ensureHosts: vi.fn() }));
vi.mock("../clients", () => ({ DEFAULT_WINE_DISTRO_TAG: "9.9-dxmt" }));
vi.mock("../clients/secret", () => ({ ENSURE_HOSTS: [] }));

const release =
  "https://github.com/dbc-hbin/wine-yaagl-d3dmetal/releases/download/wine-11.20-gptk4.0b3-1";
const archiveHash =
  "a1a6f1dab9bb373091f4b7756505b706e29c9c72e805c011d8107192574920aa";
const licenseHash =
  "5abb2d059be217663b00e8fd37e14411d374e11d17e3b744eebd49b8d17118c8";
const archive = "/test/wine.d3dmetal.unique.tar.xz";
const stage = "/test/wine.d3dmetal.unique.staging";
const prefix = "/test/prefix";
const active = "/test/wine";
const license = "/test/d3dmetal-license/License.rtf";
const downloadedLicense = "/test/d3dmetal-license/License.unique.rtf";
let files: Set<string>;
let failure: string;
let cachedLicenseHash: string;
const events: string[] = [];
const wineExec = vi.fn();
const download = vi.fn();
const aria2 = { doStreamingDownload: download } as unknown as Aria2;

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  failure = "";
  cachedLicenseHash = licenseHash;
  events.length = 0;
  files = new Set([active, prefix]);
  vi.stubGlobal("Neutralino", { app: { exit: vi.fn() } });
  vi.mocked(fileOrDirExists).mockImplementation(async path => files.has(path));
  vi.mocked(getKeyOrDefault).mockResolvedValue("9.9-dxmt");
  vi.mocked(removeFile).mockImplementation(async path => {
    files.delete(path);
  });
  vi.mocked(rmrf_dangerously).mockImplementation(async path => {
    events.push(`remove:${path}`);
    files.delete(path);
    return { pid: 1, exitCode: 0, stdOut: "", stdErr: "" };
  });
  vi.mocked(tar_extract_directory).mockImplementation(async () => {
    events.push("extract");
    files.add(stage);
    if (failure === "extract") throw new Error("extract failed");
    return { pid: 1, exitCode: 0, stdOut: "", stdErr: "" };
  });
  vi.mocked(exec).mockImplementation(async command => {
    const args = command.map(String);
    let stdOut = "";
    switch (args[0]) {
      case "mkdir":
        files.add(args[2]);
        break;
      case "/usr/bin/stat":
        stdOut = failure === "size" ? "1" : "307352548";
        break;
      case "/usr/bin/shasum": {
        const path = args[3];
        let hash = licenseHash;
        if (path === archive) {
          hash = failure === "hash" ? "0".repeat(64) : archiveHash;
        } else if (path === license) {
          hash = cachedLicenseHash;
        } else if (failure === "license") {
          hash = "0".repeat(64);
        }
        stdOut = `${hash}  ${path}`;
        break;
      }
      case "/usr/bin/codesign":
        events.push("signature");
        expect(args).toEqual([
          "/usr/bin/codesign",
          "--verify",
          "--strict",
          `${stage}/lib/external/D3DMetal.framework`,
        ]);
        if (failure === "signature") throw new Error("signature failed");
        break;
      case "/bin/mv": {
        const source = args[args.length - 2];
        const destination = args[args.length - 1];
        events.push(`move:${source}`);
        if (failure === "move" && source === stage)
          throw new Error("move failed");
        files.delete(source);
        files.add(destination);
        if (destination === license) cachedLicenseHash = licenseHash;
        break;
      }
      case "/usr/bin/textutil":
        stdOut = failure === "empty-license" ? " " : "Verified Apple license";
        break;
      default:
        throw new Error(`Unexpected command: ${args.join(" ")}`);
    }
    return { pid: 1, exitCode: 0, stdOut, stdErr: "" };
  });
  download.mockImplementation(async function* ({ absDst }: { absDst: string }) {
    files.add(absDst);
    if (failure === "download") throw new Error("download failed");
    // Aria2 may initially report an unknown total.
    yield {
      totalLength: BigInt(0),
      completedLength: BigInt(0),
      downloadSpeed: BigInt(0),
    };
    yield {
      totalLength: BigInt(10),
      completedLength: BigInt(10),
      downloadSpeed: BigInt(10),
    };
  });
  wineExec.mockImplementation(async () => {
    if (failure === "initialize") throw new Error("wineboot failed");
    return { pid: 1, exitCode: 0, stdOut: "", stdErr: "" };
  });
  const unexpectedWineOperation = () => {
    throw new Error("Unexpected Wine operation in installer fixture");
  };
  vi.mocked(createWine).mockResolvedValue({
    exec: wineExec,
    exec2: unexpectedWineOperation,
    waitUntilServerOff: unexpectedWineOperation,
    cmd: unexpectedWineOperation,
    toWinePath: unexpectedWineOperation,
    prefix,
    openCmdWindow: unexpectedWineOperation,
    setProps: unexpectedWineOperation,
    setNVExtension: unexpectedWineOperation,
    attributes: { renderBackend: "d3dmetal", supportsD3d12: true },
  });
});

async function openInstaller() {
  const distro = (await getWineDistributions()).find(
    x => x.id === D3DMETAL_RUNTIME_ID
  );
  if (!distro) throw new Error("Bundled distribution missing");
  await createWineInstallProgram({
    aria2,
    locale: {} as Locale,
    wineAbsPrefix: prefix,
    wineDistro: distro,
  });
  return vi.mocked(createD3DMetalLicenseUI).mock.calls[0][0];
}

async function install() {
  const consent = await openInstaller();
  consent.onAccept();
  const program = vi.mocked(createCommonUpdateUI).mock.calls[0][1];
  for await (const _ of program()) {
    // Consume the real installer generator through the UI boundary.
  }
}

describe("bundled D3DMetal installer", () => {
  it("waits for explicit consent before downloading or replacing Wine", async () => {
    await openInstaller();
    expect(download).not.toHaveBeenCalled();
    expect(createCommonUpdateUI).not.toHaveBeenCalled();
    expect(rmrf_dangerously).not.toHaveBeenCalled();
  });

  it("validates the bundled framework before replacing the runtime and publishing readiness", async () => {
    await install();
    expect(D3DMETAL_RUNTIME_ID).toBe("wine-11.20-d3dmetal-gptk4.0b3-1");
    expect(D3DMETAL_RUNTIME_URL).toBe(
      `${release}/wine-11.20-d3dmetal-gptk4.0b3-macos26.tar.xz`
    );
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: D3DMETAL_RUNTIME_URL,
        absDst: archive,
      })
    );
    expect(tar_extract_directory).toHaveBeenCalledWith(
      archive,
      stage,
      "wine",
      true
    );
    expect(events).toEqual([
      "extract",
      "signature",
      `remove:${prefix}`,
      `remove:${active}`,
      `move:${stage}`,
    ]);
    expect(wineExec).toHaveBeenCalledWith(
      "wineboot",
      ["-u"],
      {},
      "/test/wineboot.log"
    );
    expect(vi.mocked(setKey).mock.calls.slice(0, 4)).toEqual([
      ["wine_tag", D3DMETAL_RUNTIME_ID],
      ["wine_state", "ready"],
      ["wine_update_url", null],
      ["wine_update_tag", null],
    ]);
    expect(files.has(archive)).toBe(false);
    expect(files.has(stage)).toBe(false);
  });

  it.each(["download", "size", "hash", "extract", "signature"])(
    "preserves the active runtime and prefix on %s failure",
    async point => {
      failure = point;
      await expect(install()).rejects.toThrow();
      expect(files.has(active)).toBe(true);
      expect(files.has(prefix)).toBe(true);
      expect(rmrf_dangerously).not.toHaveBeenCalledWith(active);
      expect(rmrf_dangerously).not.toHaveBeenCalledWith(prefix);
      expect(setKey).not.toHaveBeenCalled();
      expect(files.has(archive)).toBe(false);
      expect(files.has(stage)).toBe(false);
    }
  );

  it.each(["move", "initialize"])(
    "keeps the pending selector and cleans temporary files on %s failure",
    async point => {
      failure = point;
      await expect(install()).rejects.toThrow();
      expect(setKey).not.toHaveBeenCalled();
      expect(files.has(archive)).toBe(false);
      expect(files.has(stage)).toBe(false);
    }
  );

  it("restores an intact previous distribution even when it contains an Apple framework", async () => {
    files.add(`${active}/lib/external/D3DMetal.framework`);
    const consent = await openInstaller();
    await consent.onCancel();
    expect(_safeRelaunch).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    expect(setKey).toHaveBeenCalledWith("wine_state", "ready");
  });

  it("does not restore a stale selector over our bundled runtime after cancellation", async () => {
    files.add(`${active}/lib/external/D3DMetal.framework`);
    files.add(`${active}/yaagl-d3dmetal-runtime.json`);
    const consent = await openInstaller();
    await consent.onCancel();
    expect(_safeRelaunch).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
    expect(Neutralino.app.exit).toHaveBeenCalledWith(0);
  });
});

describe("verified Apple license", () => {
  it("downloads the license from the same pinned release and verifies before conversion", async () => {
    expect(await loadD3DMetalLicense(aria2)).toBe("Verified Apple license");
    expect(download).toHaveBeenCalledWith({
      uri: `${release}/License.rtf`,
      absDst: downloadedLicense,
    });
    expect(files.has(license)).toBe(true);
    expect(files.has(downloadedLicense)).toBe(false);
  });

  it("reuses a verified cached license without downloading", async () => {
    files.add(license);
    await loadD3DMetalLicense(aria2);
    expect(download).not.toHaveBeenCalled();
  });

  it("replaces an invalid cached license only after validating the download", async () => {
    files.add(license);
    cachedLicenseHash = "0".repeat(64);
    await loadD3DMetalLicense(aria2);
    expect(download).toHaveBeenCalledOnce();
    expect(cachedLicenseHash).toBe(licenseHash);
  });

  it.each(["license", "download"])(
    "rejects %s failure and removes the temporary license",
    async point => {
      failure = point;
      await expect(loadD3DMetalLicense(aria2)).rejects.toThrow();
      expect(files.has(license)).toBe(false);
      expect(files.has(downloadedLicense)).toBe(false);
      expect(exec).not.toHaveBeenCalledWith([
        "/usr/bin/textutil",
        "-convert",
        "txt",
        "-stdout",
        license,
      ]);
    }
  );

  it("rejects empty converted license text", async () => {
    files.add(license);
    failure = "empty-license";
    await expect(loadD3DMetalLicense(aria2)).rejects.toThrow("empty text");
  });
});
