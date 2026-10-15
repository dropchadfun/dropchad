/**
 * The `?chain=` filter the read routes take: a pill key, `all`, or a plain chain key.
 *
 * The frontend's chain switch works in **pill** keys, `robinhood` and `solana`, and a pill covers
 * the mainnet and every testnet of it, `apps/web/src/lib/chains.ts`. So `chain=robinhood` means
 * `robinhood` and `robinhood-testnet`, `chain=solana` means `solana` and `solana-devnet`, and a
 * testnet key names itself alone.
 */
import { chains, findChain, type Chain } from "@dropchad/chains";

export const ALL_CHAINS = "all";

export interface ChainFilter {
  /** What the caller asked for, echoed back. */
  readonly key: string;
  /** `null` means every chain. */
  readonly keys: ReadonlySet<string> | null;
  /** The families in scope, so a route can skip the indexer or the Solana reader entirely. */
  readonly families: ReadonlySet<Chain["family"]>;
}

/** `undefined` when the key names no chain at all. */
export function chainFilter(key: string | undefined): ChainFilter | undefined {
  if (key === undefined || key === ALL_CHAINS) {
    return { key: ALL_CHAINS, keys: null, families: new Set(chains.map((c) => c.family)) };
  }
  const chain = findChain(key);
  if (chain === undefined) return undefined;
  const covered = chains.filter((c) => c.key === chain.key || c.testnetOf === chain.key);
  return {
    key,
    keys: new Set(covered.map((c) => c.key)),
    families: new Set(covered.map((c) => c.family)),
  };
}

/** The pill a chain belongs to: itself, or the mainnet it is a testnet of. */
export function pillKeyOf(chainKey: string): string {
  return findChain(chainKey)?.testnetOf ?? chainKey;
}

export function filterIncludes(filter: ChainFilter, chainKey: string): boolean {
  return filter.keys === null || filter.keys.has(chainKey);
}

/** The coin a chain counts in. `ETH` and 18 for an unknown key, which is what it always was. */
export function unitOf(chainKey: string): {
  symbol: string;
  decimals: number;
  family: Chain["family"];
} {
  const chain = findChain(chainKey);
  if (chain === undefined) return { symbol: "ETH", decimals: 18, family: "evm" };
  return {
    symbol: chain.nativeSymbol,
    decimals: chain.family === "svm" ? 9 : 18,
    family: chain.family,
  };
}
