import { join } from "path-browserify";
import { CommonUpdateProgram } from "../../../common-update-ui";
import { Server } from "../../../constants";
import {
  mkdirp,
  removeFile,
  writeBinary,
  writeFile,
  readBinary,
  resolve,
  utf16le,
  log,
  exec,
  getKeyOrDefault,
  removeFileIfExists,
} from "../../../utils";
import { Wine } from "../../../wine";
import { Config } from "@config";
import { putLocal, patchProgram, patchRevertProgram } from "../patch";
import { NAP_CN_BLOCK_URL, NAP_OS_BLOCK_URL } from "../../secret";
import { gt } from "semver";
import {
  createD3DMetalLaunchArguments,
  createD3DMetalLaunchEnvironment,
  createD3DMetalZzzRtShimEnvironment,
  D3DMETAL_VERSION,
  D3DMETAL_ZZZ_RT_SHIM_RELATIVE_PATH,
  D3DMETAL_UNORM_REPLACEMENT_RELATIVE_PATH,
  validateD3DMetalZzzRtShim,
  validateD3DMetalWine,
} from "../../../wine/d3dmetal";
import {
  captureFreshD3DMetalPlayerLog,
  collectD3DMetalModuleSnapshot,
  collectD3DMetalSystemLog,
  createD3DMetalDiagnosticPaths,
  createZzzPlayerLogPath,
  D3DMetalLaunchProfile,
  fingerprintD3DMetalPlayerLog,
  writePendingD3DMetalRuntimeEvidence,
  writeD3DMetalLaunchProfile,
  writeD3DMetalRuntimeEvidence,
} from "../../../diagnostics/d3dmetal";

export async function* launchGameProgram({
  gameDir,
  gameExecutable,
  wine,
  config,
  server,
}: {
  gameDir: string;
  gameExecutable: string;
  wine: Wine;
  config: Config;
  server: Server;
}): CommonUpdateProgram {
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "PATCHING"];

  await fixWebview(wine, server);
  await wine.setProps(config);

  const args: string[] = [];
  if (wine.attributes.renderBackend !== "d3dmetal" && config.resolutionCustom) {
    args.push("-screen-width", config.resolutionWidth);
    args.push("-screen-height", config.resolutionHeight);
    args.push("-screen-fullscreen", "0");
  }
  const cmd = `@echo off
cd "%~dp0"
copy "${wine.toWinePath(
    join(gameDir, atob("SG9Zb0tQcm90ZWN0LnN5cw=="))
  )}" "%WINDIR%\\system32\\"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(join(gameDir, gameExecutable))}" ${args.join(" ")}`;
  await writeFile(resolve("config.bat"), cmd);
  yield* patchProgram(gameDir, wine, server, config);
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  let launchStartedAt: Date | undefined;
  let d3dMetalDiagnostics:
    | ReturnType<typeof createD3DMetalDiagnosticPaths>
    | undefined;
  let launchError: unknown;
  let launchExitCode: number | null = null;
  let validatedD3DMetalVersion: typeof D3DMETAL_VERSION | undefined;
  let d3dMetalLaunchProfile: D3DMetalLaunchProfile | undefined;
  let playerLogSource: string | undefined;
  let playerLogBefore:
    | Awaited<ReturnType<typeof fingerprintD3DMetalPlayerLog>>
    | undefined;
  let moduleSnapshotPromise:
    | ReturnType<typeof collectD3DMetalModuleSnapshot>
    | undefined;
  let rtShimValidation:
    | Awaited<ReturnType<typeof validateD3DMetalZzzRtShim>>
    | undefined;
  let launchFinished = false;
  try {
    yield ["setStateText", "GAME_RUNNING"];
    launchStartedAt = new Date();
    const logfile = resolve(`./logs/game_${launchStartedAt.getTime()}.log`);
    d3dMetalDiagnostics =
      wine.attributes.renderBackend === "d3dmetal"
        ? createD3DMetalDiagnosticPaths(
            resolve("./logs"),
            launchStartedAt.getTime()
          )
        : undefined;
    if (d3dMetalDiagnostics) {
      try {
        await writePendingD3DMetalRuntimeEvidence({
          destination: d3dMetalDiagnostics.evidence,
          createdAt: launchStartedAt.toISOString(),
        });
        playerLogSource = createZzzPlayerLogPath(wine.prefix);
        playerLogBefore = await fingerprintD3DMetalPlayerLog(playerLogSource);
        const shimPath = resolve(`./${D3DMETAL_ZZZ_RT_SHIM_RELATIVE_PATH}`);
        const replacementPath = resolve(
          `./${D3DMETAL_UNORM_REPLACEMENT_RELATIVE_PATH}`
        );
        try {
          rtShimValidation = await validateD3DMetalZzzRtShim({
            wineRoot: wine.root,
            shimPath,
            replacementPath,
          });
        } catch (error) {
          // The RT shim is optional for launch authority. Never regress the
          // proven direct D3DMetal city path because its artifact is absent.
          await log(`ZZZ RT shim unavailable: ${String(error)}`);
        }
      } catch (error) {
        await log(`D3DMetal diagnostics unavailable: ${String(error)}`);
        d3dMetalDiagnostics = undefined;
      }
    }

    if (config.blockNet) {
      const tmpScriptPath = "/tmp/yaagl_network_block_script.sh";
      const blockUrl =
        server.id == "nap_global" ? NAP_OS_BLOCK_URL : NAP_CN_BLOCK_URL;

      const commands = [
        `#!/bin/sh`,

        `HOSTS_FILE="/etc/hosts"`,
        `ENTRY="0.0.0.0 ${blockUrl}"`,
        `PAD_START="# Temporarily Added by Yaagl"`,
        `PAD_END="# End of section"`,

        `if ! grep -qF "$ENTRY" "$HOSTS_FILE"; then`,
        `sudo bash -c "echo -e '$PAD_START\n$ENTRY\n$PAD_END' >> '/etc/hosts'"`,
        `fi`,
        `sleep 20`,
        `sudo sed -i.bak "/$PAD_START/,/$PAD_END/d" "$HOSTS_FILE"`,

        `rm ${tmpScriptPath}`,
      ];

      await writeFile(tmpScriptPath, commands.join("\n"));
      await exec(
        [
          "osascript",
          "-e",
          `do shell script "source ${tmpScriptPath} > /dev/null 2>&1 &" with administrator privileges`,
        ],
        {},
        false
      );
    }

    const launchProgram =
      wine.attributes.renderBackend === "d3dmetal" || config.steamPatch
        ? "C:\\windows\\system32\\steam.exe"
        : "cmd";
    const launchArguments =
      wine.attributes.renderBackend === "d3dmetal"
        ? createD3DMetalLaunchArguments(
            wine.toWinePath(join(gameDir, gameExecutable))
          )
        : config.steamPatch
        ? [wine.toWinePath(join(gameDir, gameExecutable))]
        : ["/c", `${wine.toWinePath(resolve("./config.bat"))} `];
    const launchEnvironment = {
      MTL_HUD_ENABLED: config.metalHud ? "1" : "",
      ...(wine.attributes.renderBackend === "d3dmetal"
        ? {}
        : {
            WINE_ENABLE_TIMEOUT_FIX: config.timeoutFix ? "1" : "0",
          }),
      ...(wine.attributes.renderBackend === "d3dmetal"
        ? {
            ...createD3DMetalLaunchEnvironment(config.d3dMetalGpuSpoof),
            ...(rtShimValidation
              ? createD3DMetalZzzRtShimEnvironment({
                  shimPath: rtShimValidation.shimPath,
                  replacementPath: rtShimValidation.replacementPath,
                  d3dMetalPath: rtShimValidation.d3dMetalPath,
                  providerPath: rtShimValidation.providerPath,
                  dxcompilerPath: rtShimValidation.dxcompilerPath,
                })
              : {}),
          }
        : {}),
      ...(wine.attributes.renderBackend == "dxmt"
        ? {
            WINEMSYNC: "1",
            DXMT_LOG_PATH: yaaglDir,
            DXMT_CONFIG_FILE: join(yaaglDir, "dxmt.conf"),
            GST_PLUGIN_FEATURE_RANK: "atdec:MAX,avdec_h264:MAX",
          }
        : wine.attributes.renderBackend === "d3dmetal"
        ? {}
        : {
            WINEESYNC: "1",
          }),
      ...(config.proxyEnabled
        ? {
            HTTP_PROXY: config.proxyHost,
            HTTPS_PROXY: config.proxyHost,
          }
        : {}),
    };

    if (d3dMetalDiagnostics) {
      try {
        validatedD3DMetalVersion = await validateD3DMetalWine(wine.root);
        d3dMetalLaunchProfile = {
          createdAt: launchStartedAt.toISOString(),
          wineTag: "11.0-1-crossover-signed-experimental",
          d3dMetalVersion: validatedD3DMetalVersion,
          launchProgram,
          gameExecutable: wine.toWinePath(join(gameDir, gameExecutable)),
          arguments: launchArguments,
          environment: launchEnvironment,
          gpuSpoof: config.d3dMetalGpuSpoof,
          launchExitCode: null,
          ...(rtShimValidation
            ? {
                rtShim: {
                  path: rtShimValidation.shimPath,
                  hash: rtShimValidation.shimHash,
                  d3dMetalHash: rtShimValidation.d3dMetalHash,
                  providerHash: rtShimValidation.providerHash,
                  dxcompilerHash: rtShimValidation.dxcompilerHash,
                  replacementHash: rtShimValidation.replacementHash,
                },
              }
            : {}),
        };
        const launchProfile = d3dMetalLaunchProfile;
        await writeD3DMetalLaunchProfile(
          d3dMetalDiagnostics.profile,
          launchProfile
        );
        moduleSnapshotPromise = collectD3DMetalModuleSnapshot({
          destination: d3dMetalDiagnostics.moduleSnapshot,
          gameExecutable: launchProfile.gameExecutable,
          launchFinished: () => launchFinished,
        });
      } catch (error) {
        await log(`D3DMetal launch diagnostics unavailable: ${String(error)}`);
        d3dMetalDiagnostics = undefined;
        d3dMetalLaunchProfile = undefined;
        moduleSnapshotPromise = undefined;
      }
    }

    try {
      const launchResult = await wine.exec2(
        launchProgram,
        launchArguments,
        launchEnvironment,
        d3dMetalDiagnostics?.wineLog ?? logfile
      );
      launchExitCode = launchResult.exitCode;
      await wine.waitUntilServerOff();
    } finally {
      launchFinished = true;
      if (moduleSnapshotPromise) {
        try {
          const snapshot = await moduleSnapshotPromise;
          await log(
            `D3DMetal module snapshot captured=${String(
              snapshot.captured
            )} complete=${String(snapshot.complete)}`
          );
        } catch (error) {
          await log(
            `Failed to collect D3DMetal module snapshot: ${String(error)}`
          );
        }
      }
      if (d3dMetalLaunchProfile) {
        if (launchExitCode === null && launchError) {
          launchExitCode = -1;
        }
        d3dMetalLaunchProfile.launchExitCode = launchExitCode;
        try {
          await writeD3DMetalLaunchProfile(
            d3dMetalDiagnostics!.profile,
            d3dMetalLaunchProfile
          );
        } catch (error) {
          await log(
            `Failed to finalize D3DMetal launch profile: ${String(error)}`
          );
        }
      }
    }
  } catch (e: unknown) {
    launchError = e;
    await log(String(e));
  } finally {
    if (d3dMetalDiagnostics && launchStartedAt) {
      if (playerLogSource) {
        try {
          const captured = await captureFreshD3DMetalPlayerLog({
            source: playerLogSource,
            destination: d3dMetalDiagnostics.playerLog,
            before: playerLogBefore,
          });
          if (!captured) {
            await log("D3DMetal Player.log was missing or stale for this run");
          }
        } catch (error) {
          await log(`Failed to capture D3DMetal Player.log: ${String(error)}`);
        }
      }
      try {
        await collectD3DMetalSystemLog({
          destination: d3dMetalDiagnostics.systemLog,
          since: launchStartedAt,
        });
      } catch (error) {
        await log(`Failed to collect D3DMetal unified log: ${String(error)}`);
      }
      try {
        const evidence = await writeD3DMetalRuntimeEvidence({
          wineLog: d3dMetalDiagnostics.wineLog,
          systemLog: d3dMetalDiagnostics.systemLog,
          playerLog: d3dMetalDiagnostics.playerLog,
          moduleSnapshot: d3dMetalDiagnostics.moduleSnapshot,
          metalIrProbe: d3dMetalDiagnostics.metalIrProbe,
          destination: d3dMetalDiagnostics.evidence,
          launchProfile: d3dMetalLaunchProfile,
          validatedD3DMetalVersion,
          createdAt: launchStartedAt.toISOString(),
        });
        await log(
          `D3DMetal runtime evidence verified=${String(
            evidence.verified
          )} dxrVerified=${String(
            evidence.dxrVerified
          )} dxrPipelineFailed=${String(
            evidence.dxrPipelineFailed
          )} rtPsoFailures=${String(
            evidence.dxrPipelineDiagnostics.rayTracingPsoFailureCount
          )} stateObjectFailureStage=${
            evidence.dxrPipelineDiagnostics.stateObjectFailureStage ?? "unknown"
          } rejectedSubobject=${
            evidence.dxrPipelineDiagnostics.rejectedSubobject ?? "unknown"
          }`
        );
      } catch (error) {
        await log(
          `Failed to write D3DMetal runtime evidence: ${String(error)}`
        );
      }
    }
    if (
      wine.attributes.renderBackend !== "d3dmetal" &&
      config.resolutionCustom
    ) {
      try {
        await revertResolutionRegistry(wine, server);
      } catch (error) {
        await log(`Failed to restore resolution registry: ${String(error)}`);
      }
    }

    await removeFileIfExists(resolve("config.bat"));
    yield ["setStateText", "REVERT_PATCHING"];
    yield* patchRevertProgram(gameDir, wine, server, config);
  }

  if (launchError && wine.attributes.renderBackend === "d3dmetal") {
    throw launchError;
  }
}

async function fixWebview(wine: Wine, server: Server) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "nap_cn") {
    key += "\u7edd\u533a\u96f6";
  } else if (server.id === "nap_global") {
    key += "\x5a\x65\x6e\x6c\x65\x73\x73\x5a\x6f\x6e\x65\x5a\x65\x72\x6f";
  } else {
    return;
  }

  const reg = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"MIHOYOSDK_WEBVIEW_RENDER_METHOD_h1573598267"=-`,
  ];

  try {
    await wine.exec("reg", ["query", key], {}, resolve("fix_webview.log"));

    // the output contains malformed CJK characters
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const output = decoder.decode(await readBinary(resolve("fix_webview.log")));

    for (let line of output.split("\n")) {
      line = line.trim();
      if (line.startsWith("HOYO_WEBVIEW_RENDER_METHOD_ABTEST_")) {
        const abtest = line.split(" ", 2)[0];
        reg.push(`"${abtest}"=-`);
      }
    }
  } catch (e: unknown) {
    return;
  }

  await writeBinary(resolve("fix_webview.reg"), utf16le(reg.join("\r\n")));
  await wine.exec(
    "reg",
    ["import", `${wine.toWinePath(resolve("./fix_webview.reg"))}`],
    {},
    "/dev/null"
  );
}

async function revertResolutionRegistry(wine: Wine, server: Server) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "nap_cn") {
    key += "\u7edd\u533a\u96f6";
  } else if (server.id === "nap_global") {
    key += "\x5a\x65\x6e\x6c\x65\x73\x73\x5a\x6f\x6e\x65\x5a\x65\x72\x6f";
  } else {
    return;
  }

  try {
    const reg = [`Windows Registry Editor Version 5.00`, ``, `[${key}]`];
    await wine.exec("reg", ["query", key], {}, resolve("fix_resolution.log"));
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const output = decoder.decode(
      await readBinary(resolve("fix_resolution.log"))
    );

    for (let line of output.split("\r\n")) {
      line = line.trim();
      if (
        line.startsWith("Screenmanager Is Fullscreen mode_") ||
        line.startsWith("Screenmanager Resolution_")
      ) {
        const value = line.split(" ", 2)[0]; // FIXME: spaces in key?
        // It seems that unity didn't use spaces in keys
        reg.push(`"${value}"=-`);
      }
    }

    if (reg.length > 3) {
      await writeBinary(
        resolve("fix_resolution.reg"),
        utf16le(reg.join("\r\n"))
      );
      await wine.exec(
        "reg",
        ["import", `${wine.toWinePath(resolve("./fix_resolution.reg"))}`],
        {},
        "/dev/null"
      );
    }
  } catch {
    return;
  }
}
