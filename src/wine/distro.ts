import { getKey } from "@utils";
import { DEFAULT_WINE_DISTRO_TAG } from "../clients";
import { Github } from "../github";

export interface WineDistributionAttributes {
  renderBackend: "dxmt" | "d3dmetal";
  winePath: string; // Path to the wine directory inside the archive
}

export interface WineDistribution {
  id: string;
  displayName: string;
  remoteUrl: string;
  archiveSha256?: string;
  archiveSize?: number;
  wineVersion?: string;
  attributes: Partial<WineDistributionAttributes>;
}

const YAAGL_BUILTIN_WINE: WineDistribution[] = [
  {
    id: "11.0-1-crossover-signed-experimental",
    displayName: "Wine 11.0-1 Crossover (signed, experimental)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-crossover-11.0-1-signed/wine-crossover-11.0-1-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine",
    },
  },
  {
    id: "11.0-dxmt-signed-with-patches",
    displayName: "Wine 11.0 DXMT (signed, with patches)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-11.0-signed/wine-devel-11.0-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine",
    },
  },
  {
    id: "11.8-dxmt-signed-experimental",
    displayName: "Wine 11.8 DXMT (signed, experimental)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-11.8-signed/wine-devel-11.8-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine",
    },
  },
  {
    id: "11.4-dxmt-signed",
    displayName: "Wine 11.4 DXMT (signed)",
    remoteUrl:
      "https://github.com/dawn-winery/dawn-signed/releases/download/wine-gcenx-11.4-osx64/wine-devel-11.4-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine-devel-11.4-osx64-signed/Contents/Resources/wine",
    },
  },
  {
    id: "11.0-dxmt-signed",
    displayName: "Wine 11.0 DXMT (signed)",
    remoteUrl:
      "https://github.com/dawn-winery/dawn-signed/releases/download/wine-stable-gcenx-11.0-osx64/wine-stable-11.0-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "Wine Stable.app/Contents/Resources/wine",
    },
  },

  {
    id: "9.9-dxmt",
    displayName: "Wine 9.9 DXMT",
    remoteUrl:
      "https://github.com/3Shain/wine/releases/download/v9.9-mingw/wine.tar.gz",
    attributes: {
      renderBackend: "dxmt",
    },
  },
];

const ZZZ_D3DMETAL_WINE: WineDistribution = {
  id: "11.0-1-crossover-signed-experimental",
  displayName: "Wine 11.0-1 Crossover + GPTK 4.0b2 D3DMetal",
  remoteUrl:
    "https://github.com/yaagl/anime-game-wine/releases/download/wine-crossover-11.0-1-signed/wine-crossover-11.0-1-osx64-signed.tar.xz",
  archiveSha256:
    "89fa7e90fb626523a90d5867a03c6be785d017176739c6320a3b86c7838c3a35",
  archiveSize: 456021524,
  wineVersion: "wine-11.0",
  attributes: {
    renderBackend: "d3dmetal",
    winePath: "wine",
  },
};

export async function getWineDistributions(): Promise<WineDistribution[]> {
  if (import.meta.env["YAAGL_CHANNEL_CLIENT"] === "naposdx12") {
    return [ZZZ_D3DMETAL_WINE];
  }
  return YAAGL_BUILTIN_WINE;
}

export type WineStatus =
  | {
      wineReady: false;
      wineDistribution: WineDistribution;
    }
  | {
      wineReady: true;
      wineDistribution: WineDistribution;
    };

export async function checkWine(github: Github): Promise<WineStatus> {
  const wine_versions = await getWineDistributions();
  const defaultDistro = wine_versions.find(
    x => x.id == DEFAULT_WINE_DISTRO_TAG
  );
  if (!defaultDistro) {
    throw new Error(
      "can not find default wine version: " + DEFAULT_WINE_DISTRO_TAG
    );
  }
  try {
    const wineState = await getKey("wine_state");
    if (wineState == "update") {
      const update_wine_tag = await getKey("wine_update_tag");
      return {
        wineReady: false,
        wineDistribution:
          wine_versions.find(x => x.id == update_wine_tag) ?? defaultDistro,
      } as const;
    }
    const currrent_wine_tag = await getKey("wine_tag");
    const wineDistribution = wine_versions.find(x => x.id == currrent_wine_tag);
    if (wineDistribution) {
      return { wineReady: true, wineDistribution } as const;
    } else {
      // Force re-install for unknown wine version
      return {
        wineReady: false,
        wineDistribution: defaultDistro,
      };
    }
  } catch (e) {
    return {
      wineReady: false,
      wineDistribution: defaultDistro,
    } as const;
  }
}
