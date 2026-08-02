export const WINE_INSTALL_TRANSACTION_SCHEMA = 1 as const;

export interface WineInstallTransaction {
  schemaVersion: typeof WINE_INSTALL_TRANSACTION_SCHEMA;
  generation: string;
  phase: "publishing" | "committed";
  hadWine: boolean;
  hadPrefix: boolean;
}

export function parseWineInstallTransaction(
  contents: string
): WineInstallTransaction {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Wine install transaction is not valid JSON: ${String(error)}`
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Wine install transaction is invalid");
  }
  const transaction = value as Partial<WineInstallTransaction>;
  if (
    transaction.schemaVersion !== WINE_INSTALL_TRANSACTION_SCHEMA ||
    typeof transaction.generation !== "string" ||
    !/^[A-Z0-9]{16}$/.test(transaction.generation) ||
    (transaction.phase !== "publishing" && transaction.phase !== "committed") ||
    typeof transaction.hadWine !== "boolean" ||
    typeof transaction.hadPrefix !== "boolean"
  ) {
    throw new Error("Wine install transaction has an unsupported schema");
  }
  return transaction as WineInstallTransaction;
}

export function serializeWineInstallTransaction(
  transaction: WineInstallTransaction
) {
  return `${JSON.stringify(transaction, null, 2)}\n`;
}
