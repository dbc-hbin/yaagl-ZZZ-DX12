import { describe, expect, it } from "vitest";
import { addTerminationHook, GLOBAL_onClose } from "./neu";

// A successful close stays settled for the module lifetime (the app exits),
// so the whole lifecycle is one ordered scenario on the module-level registry.
describe("termination hooks", () => {
  it("keeps unregister order across aborted closes and settles a close whose hook unregisters mid-run once", async () => {
    const calls: string[] = [];
    addTerminationHook(async () => {
      calls.push("aria2");
      return true;
    });
    const removeVeto = addTerminationHook(async () => {
      calls.push("veto");
      return false;
    });

    // An aborted close is not cached: the next close runs hooks again.
    expect(await GLOBAL_onClose(false)).toBe(false);
    expect(calls).toEqual(["veto"]);
    // Unregister after an odd number of closes must remove the veto itself.
    removeVeto();

    const wineStopped = Promise.withResolvers<void>();
    let wineRuns = 0;
    const removeWine = addTerminationHook(async () => {
      wineRuns++;
      calls.push("wine");
      await wineStopped.promise;
      return true;
    });

    let firstDone = false;
    const first = GLOBAL_onClose(false).then(done => {
      firstDone = true;
      return done;
    });
    const second = GLOBAL_onClose(false);
    await Promise.resolve();

    // The game flow finishes and unregisters while the Wine hook is pending.
    removeWine();
    await Promise.resolve();
    expect(firstDone).toBe(false);

    wineStopped.resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(wineRuns).toBe(1);
    expect(calls).toEqual(["veto", "wine", "aria2"]);
  });
});
