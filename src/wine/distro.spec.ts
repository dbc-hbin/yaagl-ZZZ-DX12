import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@utils", () => ({
  getKey: async (key: string) => {
    const value = store.get(key);
    if (value === undefined) throw new Error(`missing key ${key}`);
    return value;
  },
}));
vi.mock("../clients", () => ({
  DEFAULT_WINE_DISTRO_TAG: "11.0-1-crossover-signed-experimental",
}));

const { checkWine } = await import("./distro");
const { D3DMETAL_WINE_11_17, D3DMETAL_WINE_CX26_3 } = await import(
  "./d3dmetal"
);
const github = {} as Parameters<typeof checkWine>[0];
const PRIVATE_CX = "wine-cx26.3-d3dmetal-gptk4.0b2-1";

describe("checkWine", () => {
  beforeEach(() => store.clear());

  it("reinstalls a private CX build as the published CX runtime", async () => {
    store.set("wine_state", "ready");
    store.set("wine_tag", PRIVATE_CX);
    const status = await checkWine(github);
    expect(status.wineReady).toBe(false);
    expect(status.wineDistribution.id).toBe(D3DMETAL_WINE_CX26_3.id);
    expect(status.wineDistribution.attributes.renderBackend).toBe("d3dmetal");
  });

  it("resolves a pending private CX update to the published CX runtime", async () => {
    store.set("wine_state", "update");
    store.set("wine_update_tag", PRIVATE_CX);
    store.set("wine_tag", D3DMETAL_WINE_11_17.id);
    const status = await checkWine(github);
    expect(status.wineReady).toBe(false);
    expect(status.wineDistribution.id).toBe(D3DMETAL_WINE_CX26_3.id);
  });

  it("keeps an installed 11.17 runtime ready", async () => {
    store.set("wine_state", "ready");
    store.set("wine_tag", D3DMETAL_WINE_11_17.id);
    const status = await checkWine(github);
    expect(status.wineReady).toBe(true);
    expect(status.wineDistribution.id).toBe(D3DMETAL_WINE_11_17.id);
  });

  it("still falls back to the client default for other unknown tags", async () => {
    store.set("wine_state", "ready");
    store.set("wine_tag", "some-removed-build");
    const status = await checkWine(github);
    expect(status.wineReady).toBe(false);
    expect(status.wineDistribution.id).toBe(
      "11.0-1-crossover-signed-experimental"
    );
  });
});
