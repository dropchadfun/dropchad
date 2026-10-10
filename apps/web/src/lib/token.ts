/**
 * the unit a drop's amounts are in.
 * A token drop is in its token: the ticker, else the word `tokens`
 * and the token's decimals. A SOL or ETH drop, or an answer from an api before 4f, keeps the chain's
 * coin. Never a usd number for a token.
 */
import type { TokenInfo } from "@/lib/api";
import { addressUrl, decimalsOf, familyOf, nativeSymbol, tokenExplorerUrl } from "@/lib/chains";

/** What a token with no ticker is called everywhere. */
export const NO_TICKER = "tokens";

/** `4zMM…ncDU`: the token box's card only, next to its copy button. */
export function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** The ticker and decimals an amount of this drop is shown in. */
export function dropUnit(
  chainId: number,
  token: TokenInfo | null | undefined,
): { symbol: string; decimals: number } {
  if (token === null || token === undefined) {
    return { symbol: nativeSymbol(chainId), decimals: decimalsOf(chainId) };
  }
  return { symbol: token.symbol ?? NO_TICKER, decimals: token.decimals };
}

/**
 * True when a logo image is done loading and has no picture: its 404 came back before React
 * attached `onError`, so that handler never ran. Robinhood tokens never have a logo (token step
 * ), so there it happens on every page load that is fast enough.
 */
export function logoFailedEarly(img: { complete: boolean; naturalWidth: number }): boolean {
  return img.complete && img.naturalWidth === 0;
}

/** The logo's fallback: the ticker's first letter, else the mint's, upper case. */
export function tokenLetter(token: TokenInfo): string {
  return (token.symbol ?? token.mint).slice(0, 1).toUpperCase();
}

/**
 * A ticker as the drop page and the share card show it: up to
 * 6 letters as it is; 7 to 10 one size smaller; over 10 the first 10 and `…`, smaller too.
 */
export function tickerShow(ticker: string): { text: string; small: boolean } {
  if (ticker.length <= 6) return { text: ticker, small: false };
  if (ticker.length <= 10) return { text: ticker, small: true };
  return { text: `${ticker.slice(0, 10)}…`, small: true };
}

/**
 * The token row's small link, always the explorer: on Solana the token on Solana explorer (the
 * devnet cluster on testnet), on Robinhood the explorer's token page. Dexscreener
 * is its own button since, so it is never here twice. Never a price on our own page,
 */
export function tokenPageLink(
  mint: string,
  chainId: number,
  testnet: boolean,
): { href: string; label: string } {
  const page = familyOf(chainId) === "evm" ? tokenExplorerUrl(chainId, mint) : null;
  if (page !== null) return { href: page, label: "explorer ↗" };
  if (testnet) {
    return {
      href:
        addressUrl(chainId, mint) ?? `https://explorer.solana.com/address/${mint}?cluster=devnet`,
      label: "explorer ↗",
    };
  }
  return {
    href: addressUrl(chainId, mint) ?? `https://explorer.solana.com/address/${mint}`,
    label: "explorer ↗",
  };
}
