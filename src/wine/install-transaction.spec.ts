import { describe, expect, it } from "vitest";
import {
  parseWineInstallTransaction,
  serializeWineInstallTransaction,
  WineInstallTransaction,
} from "./install-transaction";

const transaction: WineInstallTransaction = {
  schemaVersion: 1,
  generation: "ABCDEF0123456789",
  phase: "publishing",
  hadWine: true,
  hadPrefix: true,
};

describe("Wine install transaction marker", () => {
  it("round-trips a supported pair transaction", () => {
    expect(
      parseWineInstallTransaction(serializeWineInstallTransaction(transaction))
    ).toEqual(transaction);
    expect(
      parseWineInstallTransaction(
        serializeWineInstallTransaction({
          ...transaction,
          phase: "committed",
          hadWine: false,
          hadPrefix: false,
        })
      )
    ).toMatchObject({ phase: "committed", hadWine: false, hadPrefix: false });
  });

  it("rejects malformed markers instead of guessing a recovery policy", () => {
    expect(() => parseWineInstallTransaction("not json")).toThrow(
      "not valid JSON"
    );
    expect(() =>
      parseWineInstallTransaction(
        JSON.stringify({ ...transaction, generation: "../unsafe" })
      )
    ).toThrow("unsupported schema");
    expect(() =>
      parseWineInstallTransaction(
        JSON.stringify({ ...transaction, phase: "unknown" })
      )
    ).toThrow("unsupported schema");
  });
});
