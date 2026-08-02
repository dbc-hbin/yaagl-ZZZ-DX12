import { Aria2 } from "@aria2";
import { CommonUpdateProgram, createCommonUpdateUI } from "@common-update-ui";
import { Locale } from "@locale";
import {
  rmrf_dangerously,
  humanFileSize,
  tar_extract,
  removeFile,
  xattrRemove,
  setKey,
  exec,
  generateRandomString,
  resolve,
  tar_extract_directory,
  cp,
  fileOrDirExists,
  readFile,
  removeFileIfExists,
  writeFile,
} from "@utils";
import { ENSURE_HOSTS } from "../clients/secret";
import { ensureHosts } from "../hosts";
import { createWine } from "./wine";
import { installMediaFoundation } from "./mf";
import { WineDistribution } from "./distro";
import { addCertsToWine } from "./cert";
import { overlayD3DMetalRuntime } from "./d3dmetal";
import { installSteamSupport } from "./steam";
import type { GptkRuntimeManifest } from "../gptk";
import { validateCachedRuntime } from "../gptk";
import { createNeutralinoGptkHost } from "../gptk/neutralino-adapter";
import {
  assertWineArchiveIdentity,
  createWineRuntimeManifest,
  readArchiveIdentity,
} from "./runtime-manifest";
import {
  parseWineInstallTransaction,
  serializeWineInstallTransaction,
  WineInstallTransaction,
} from "./install-transaction";

export async function createWineInstallProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
  locale,
  gptkRuntime,
}: {
  aria2: Aria2;
  locale: Locale;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
  gptkRuntime?: {
    runtimeRoot: string;
    manifest: GptkRuntimeManifest;
  };
}) {
  async function* program(): CommonUpdateProgram {
    const wineBinaryDir = resolve("./wine");
    const wineStagingDir = resolve("./wine.staging");
    const winePreviousDir = resolve("./wine.previous");
    const prefixStagingDir = `${wineAbsPrefix}.staging`;
    const prefixPreviousDir = `${wineAbsPrefix}.previous`;
    const transactionPath = resolve("./wine-install-transaction.json");
    const transactionStagingPath = `${transactionPath}.staging`;
    const isD3DMetal = wineDistro.attributes.renderBackend === "d3dmetal";

    const writeTransaction = async (transaction: WineInstallTransaction) => {
      await removeFileIfExists(transactionStagingPath);
      await writeFile(
        transactionStagingPath,
        serializeWineInstallTransaction(transaction)
      );
      await exec(["/bin/mv", "-f", transactionStagingPath, transactionPath]);
    };

    const rollbackComponent = async ({
      current,
      previous,
      hadCurrent,
    }: {
      current: string;
      previous: string;
      hadCurrent: boolean;
    }) => {
      const hasPrevious = await fileOrDirExists(previous);
      if (hadCurrent && hasPrevious) {
        if (await fileOrDirExists(current)) await rmrf_dangerously(current);
        await exec(["/bin/mv", previous, current]);
      } else if (!hadCurrent) {
        if (await fileOrDirExists(current)) await rmrf_dangerously(current);
        if (hasPrevious) await rmrf_dangerously(previous);
      }
      // hadCurrent=true with no backup means publication had not moved this
      // component yet, so the existing current tree is already the old one.
    };

    const recoverInterruptedInstall = async () => {
      const hasTransaction = await fileOrDirExists(transactionPath);
      if (!hasTransaction) {
        const hasWinePrevious = await fileOrDirExists(winePreviousDir);
        const hasPrefixPrevious = await fileOrDirExists(prefixPreviousDir);
        if (hasWinePrevious !== hasPrefixPrevious) {
          throw new Error(
            "Incomplete legacy Wine install backup; preserving both trees for manual recovery"
          );
        }
        if (hasWinePrevious && hasPrefixPrevious) {
          if (await fileOrDirExists(wineBinaryDir)) {
            await rmrf_dangerously(wineBinaryDir);
          }
          if (await fileOrDirExists(wineAbsPrefix)) {
            await rmrf_dangerously(wineAbsPrefix);
          }
          await exec(["/bin/mv", winePreviousDir, wineBinaryDir]);
          await exec(["/bin/mv", prefixPreviousDir, wineAbsPrefix]);
        }
        return;
      }

      const transaction = parseWineInstallTransaction(
        await readFile(transactionPath)
      );
      if (transaction.phase === "committed") {
        if (
          !(await fileOrDirExists(wineBinaryDir)) ||
          !(await fileOrDirExists(wineAbsPrefix))
        ) {
          throw new Error(
            `Committed Wine install ${transaction.generation} is incomplete; preserving recovery data`
          );
        }
        await rmrf_dangerously(winePreviousDir);
        await rmrf_dangerously(prefixPreviousDir);
      } else {
        await rollbackComponent({
          current: wineBinaryDir,
          previous: winePreviousDir,
          hadCurrent: transaction.hadWine,
        });
        await rollbackComponent({
          current: wineAbsPrefix,
          previous: prefixPreviousDir,
          hadCurrent: transaction.hadPrefix,
        });
      }
      await removeFileIfExists(transactionPath);
    };

    if (isD3DMetal && !gptkRuntime) {
      throw new Error(
        "A validated GPTK 4.0b2 manifest is required for D3DMetal Wine"
      );
    }

    await recoverInterruptedInstall();
    await removeFileIfExists(transactionStagingPath);
    await rmrf_dangerously(wineStagingDir);
    await rmrf_dangerously(prefixStagingDir);

    yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
    const isXZ = wineDistro.remoteUrl.endsWith(".xz");
    const wineTarPath = resolve("./wine.tar." + (isXZ ? "xz" : "gz"));
    for await (const progress of aria2.doStreamingDownload({
      uri: wineDistro.remoteUrl,
      absDst: wineTarPath,
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(100)) / progress.totalLength),
      ];
      yield [
        "setStateText",
        "DOWNLOADING_ENVIRONMENT_SPEED",
        `${humanFileSize(Number(progress.downloadSpeed))}`,
      ];
    }

    const archiveIdentity = await readArchiveIdentity(wineTarPath);
    if (isD3DMetal) {
      try {
        assertWineArchiveIdentity({
          distro: wineDistro,
          actualSha256: archiveIdentity.sha256,
          actualSize: archiveIdentity.size,
        });
      } catch (error) {
        await removeFile(wineTarPath);
        throw error;
      }
    }

    yield ["setStateText", "EXTRACT_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    await exec(["mkdir", "-p", wineStagingDir]);
    if (wineDistro.attributes.winePath) {
      await tar_extract_directory(
        resolve("./wine.tar." + (isXZ ? "xz" : "gz")),
        wineStagingDir,
        wineDistro.attributes.winePath,
        isXZ
      );
    } else {
      await tar_extract(
        resolve("./wine.tar." + (isXZ ? "xz" : "gz")),
        wineStagingDir
      );
    }
    await removeFile(wineTarPath);

    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];

    await addCertsToWine(wineStagingDir);
    if (isD3DMetal && gptkRuntime) {
      const currentManifest = await validateCachedRuntime(
        createNeutralinoGptkHost(),
        gptkRuntime.runtimeRoot
      );
      if (
        JSON.stringify(currentManifest) !== JSON.stringify(gptkRuntime.manifest)
      ) {
        throw new Error(
          "GPTK runtime changed after validation; restart the launcher"
        );
      }
      await overlayD3DMetalRuntime({
        runtimeRoot: gptkRuntime.runtimeRoot,
        wineRoot: wineStagingDir,
      });
    }
    await xattrRemove("com.apple.quarantine", wineStagingDir);

    if (isD3DMetal) {
      await createWineRuntimeManifest({
        wineRoot: wineStagingDir,
        distro: wineDistro,
        archiveSha256: archiveIdentity.sha256,
        archiveSize: archiveIdentity.size,
      });
    }

    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];

    yield ["setUndeterminedProgress"];
    // ZZZ's signed Crossover + Steam + timeout-fix path does not require the
    // hosts launch workaround. Keep this isolated launcher from prompting for
    // administrator access or changing the user's system network settings.
    if (!isD3DMetal) {
      await ensureHosts(ENSURE_HOSTS);
    }

    const wine = await createWine({
      prefix: prefixStagingDir,
      distro: wineDistro,
      wineRoot: wineStagingDir,
    });
    await wine.exec("wineboot", ["-u"], {}, "/dev/null");
    await wine.exec("winecfg", ["-v", "win10"], {}, "/dev/null");

    if (isD3DMetal) {
      const system32Dir = resolve(
        `${prefixStagingDir}/drive_c/windows/system32`
      );
      await cp(
        `${wineStagingDir}/lib/wine/x86_64-windows/nvngx.dll`,
        `${system32Dir}/nvngx.dll`
      );
      await cp(
        `${wineStagingDir}/lib/wine/x86_64-windows/nvapi64.dll`,
        `${system32Dir}/nvapi64.dll`
      );
      await installSteamSupport(prefixStagingDir);
      await wine.waitUntilServerOff();
    }

    // FIXME: don't abuse import.meta.env
    if (
      String(import.meta.env["YAAGL_CHANNEL_CLIENT"]).startsWith("bh3") ||
      String(import.meta.env["YAAGL_CHANNEL_CLIENT"]).startsWith("cbjq")
    ) {
      yield* installMediaFoundation(aria2, wine);
    }

    // Publish the fully configured Wine tree and prefix only after every setup
    // step succeeds. Keep the previous prefix intact until both are ready.
    const transaction: WineInstallTransaction = {
      schemaVersion: 1,
      generation: generateRandomString(16),
      phase: "publishing",
      hadWine: await fileOrDirExists(wineBinaryDir),
      hadPrefix: await fileOrDirExists(wineAbsPrefix),
    };
    await writeTransaction(transaction);
    if (transaction.hadWine) {
      await exec(["/bin/mv", wineBinaryDir, winePreviousDir]);
    }
    if (transaction.hadPrefix) {
      await exec(["/bin/mv", wineAbsPrefix, prefixPreviousDir]);
    }
    try {
      await exec(["/bin/mv", wineStagingDir, wineBinaryDir]);
      await exec(["/bin/mv", prefixStagingDir, wineAbsPrefix]);
      await writeTransaction({ ...transaction, phase: "committed" });
    } catch (error) {
      await recoverInterruptedInstall();
      throw error;
    }
    await rmrf_dangerously(winePreviousDir);
    await rmrf_dangerously(prefixPreviousDir);
    await removeFileIfExists(transactionPath);

    await setKey("wine_state", "ready");
    await setKey("wine_tag", wineDistro.id);
    await setKey("wine_update_url", null);
    await setKey("wine_update_tag", null);
    const netbiosname = `DESKTOP-${generateRandomString(7)}`; // exactly 15 chars
    await setKey("wine_netbiosname", netbiosname);
    yield ["setStateText", "INSTALL_DONE"];
  }

  return createCommonUpdateUI(locale, program);
}
