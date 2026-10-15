import { findChainByChainId } from "@dropchad/chains";

import { quickTokenAt } from "@/lib/chains";

/**
 * Dexscreener's name for each chain, by our chain key. `robinhood` is
 * the name Dexscreener's own api uses for Robinhood Chain, and its token page was checked in
 * the browser.
 */
export const DEXSCREENER_CHAINS: Readonly<Record<string, string>> = {
  solana: "solana",
  robinhood: "robinhood",
};

/** The official Dexscreener logo, byte for byte. Never drawn or recoloured. */
export const DEXSCREENER_LOGO = "/launchpads/dexscreener-logo.png";

/**
 * The token on Dexscreener, or `null`: on a testnet (it has no testnet data), on a chain with no
 * name in the map, and on a stablecoin.
 */
export function dexscreenerUrl(chainId: number, token: string): string | null {
  const chain = findChainByChainId(chainId);
  if (chain?.kind !== "mainnet") return null;
  const name = DEXSCREENER_CHAINS[chain.key];
  if (name === undefined) return null;
  if (quickTokenAt(chainId, token) !== undefined) return null;
  return `https://dexscreener.com/${name}/${token}`;
}
