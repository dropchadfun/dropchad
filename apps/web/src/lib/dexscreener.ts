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
 * The box the logo is drawn in on the top coin card: one step bigger
 * than the 18px X, so its light outline mark looks as big as the X icons on the other cards.
 */
export const DEXSCREENER_ICON_PX = 19;

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
