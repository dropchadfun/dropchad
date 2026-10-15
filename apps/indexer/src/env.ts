/**
 * The indexer's optional env lines, read in one place.
 *
 * **An empty line is not set.** `NAME=` with nothing after it gives `""`, and `??` only skips
 * `undefined`, so `process.env.X ?? default` took the empty string. an empty
 * `DROPCHAD_CHAIN=` and later an empty `FINALITY_CHECK_INTERVAL=` (read as `0`) crashed the
 * indexer on the server. Here empty or spaces means the default.
 *
 * A value that is written out but wrong throws at start and names the line, so it never becomes
 * a quiet `NaN` or `0`.
 */

type Env = Record<string, string | undefined>;

export interface IndexerEnv {
  /** `DROPCHAD_CHAIN`, which registry entry to index. */
  readonly chainKey: string;
  /** `CONFIRMATION_DEPTH`, blocks behind the head before a row is `final`. See ponder.config.ts. */
  readonly confirmationDepth: number;
  /** `FINALITY_CHECK_INTERVAL`, how often the promotion job runs, in blocks. */
  readonly finalityCheckInterval: number;
  /**
   * `INDEXER_LOCAL_CHAIN`, a local chain file for the anvil check
   * `src/local-chain.ts`. Refused in production: the server indexes the registry only.
   */
  readonly localChainFile: string | undefined;
}

/** The value, trimmed, or `undefined` when the name is missing, empty or only spaces. */
export function optionalEnv(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function wholeNumber(env: Env, name: string, fallback: number, min: number): number {
  const raw = optionalEnv(env, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new Error(
      `${name} must be a whole number of at least ${String(min)}, got "${raw}". ` +
        `Delete the line in apps/indexer/.env.local to use the default, ${String(fallback)}.`,
    );
  }
  return Number(raw);
}

export function readIndexerEnv(env: Env = process.env): IndexerEnv {
  const localChainFile = optionalEnv(env, "INDEXER_LOCAL_CHAIN");
  if (localChainFile !== undefined && env["NODE_ENV"] === "production") {
    throw new Error(
      "INDEXER_LOCAL_CHAIN is set, and NODE_ENV is production. The local chain file is for the " +
        "anvil check only. Delete the line in apps/indexer/.env.local.",
    );
  }
  return {
    chainKey: optionalEnv(env, "DROPCHAD_CHAIN") ?? "robinhood-testnet",
    confirmationDepth: wholeNumber(env, "CONFIRMATION_DEPTH", 64, 0),
    // A block interval of 0 is not something Ponder can run.
    finalityCheckInterval: wholeNumber(env, "FINALITY_CHECK_INTERVAL", 200, 1),
    localChainFile,
  };
}
