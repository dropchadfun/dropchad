/**
 * The trending post text. Telegram HTML with only `a`, `code` and
 * `b`, and `b` only around our fixed titles; on a mainnet site the beta title and one
 * fixed `i` row under the last line; one empty line between the blocks;
 * short rows and a plain last line; the chad amount and the coin total first.
 * Handles only, never the profile name; the ticker escaped and in `<code>`; every link built here
 * from a fixed host. No times, so the same cards give the same text and nothing is edited.
 */
import { findChain, findQuickToken } from "@dropchad/chains";

import type { TrendingCards } from "../boards/trending.js";
import type { TokenInfo } from "../drops/token-info.js";
import { readableAmount } from "./alert-send.js";
import { code, escapeTelegramHtml, link, oneLine, X_HANDLE } from "./post.js";

export type TrendingNetwork = "testnet" | "mainnet";

/** The ticker is cut here.4. */
const TICKER_MAX = 32;

/** The last row, plain text.6. */
const LAST_LINE = "full info on dropchad.com";

/** On a mainnet site, right under the last row, the only `i`.6. */
const MAINNET_LINE = "<i>we never dm you and never ask for anything</i>";

const SHORT_UNITS: readonly (readonly [bigint, string])[] = [
  [10n ** 12n, "T"],
  [10n ** 9n, "B"],
  [10n ** 6n, "M"],
  [10n ** 3n, "K"],
];

/** Tenths as text: `15` is `1.5`, `10` is `1`, never a trailing `.0`. */
function tenthsText(tenths: bigint): string {
  const whole = (tenths / 10n).toLocaleString("en-US");
  const tenth = tenths % 10n;
  return tenth === 0n ? whole : `${whole}.${tenth.toString()}`;
}

/**
 * The short form, as on the front page: `950`, `1K`, `1.5M`; one decimal at most,
 * rounded down; `<0.1` above zero that rounds to nothing.
 */
export function shortAmount(value: bigint, decimals: number): string {
  if (value <= 0n) return "0";
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  for (const [unit, suffix] of SHORT_UNITS) {
    if (whole >= unit) return `${tenthsText((value * 10n) / (scale * unit))}${suffix}`;
  }
  const tenths = (value * 10n) / scale;
  return tenths === 0n ? "<0.1" : tenthsText(tenths);
}

/** The chain's coin: its symbol and decimals, as the channel post. */
function coinOf(chainKey: string): { symbol: string; decimals: number } {
  const chain = findChain(chainKey);
  return { symbol: chain?.nativeSymbol ?? "", decimals: chain?.family === "svm" ? 9 : 18 };
}

function coinAmount(base: bigint, chainKey: string): string {
  const coin = coinOf(chainKey);
  return readableAmount(base, coin.decimals, coin.symbol);
}

/** `2K coins`, `1 coin` for exactly 1. */
function coinsText(total: bigint, decimals: number): string {
  return total === 10n ** BigInt(decimals) ? "1 coin" : `${shortAmount(total, decimals)} coins`;
}

/** `$BONK`, never a second `$`; no ticker is `tokens`; cut at 32 characters. */
function tickerText(symbol: string | null): string {
  const ticker = oneLine(symbol ?? "");
  if (ticker === "") return "tokens";
  return (ticker.startsWith("$") ? ticker : `$${ticker}`).slice(0, TICKER_MAX);
}

/** A drop's total: the coin, a stablecoin short with its ticker, another token with `coins`. */
function dropAmount(total: bigint, chainKey: string, token: TokenInfo | null): string {
  if (token === null) return coinAmount(total, chainKey);
  const quick = findQuickToken(chainKey, token.mint);
  if (quick === undefined) return coinsText(total, token.decimals);
  return `${shortAmount(total, token.decimals)} ${escapeTelegramHtml(quick.symbol)}`;
}

/** The X handle, linked when it is a real handle, otherwise plain text. */
function who(handle: string): string {
  return X_HANDLE.test(handle)
    ? link(`https://x.com/${handle}`, handle)
    : escapeTelegramHtml(handle);
}

/** The fixed titles, the only text ever in `<b>`. Never user text. */
type Title =
  | "🧪 TESTNET, test coins only"
  | "🤌 TRENDING"
  | "🤌 TRENDING (beta version)"
  | "chads of the day"
  | "top coins"
  | "just dropped";

function bold(title: Title): string {
  return `<b>${title}</b>`;
}

function block(title: Title, rows: readonly string[], empty: string): string {
  if (rows.length === 0) return `${bold(title)}\n${empty}`;
  return [bold(title), ...rows.slice(0, 3).map((row, i) => `${String(i + 1)}. ${row}`)].join("\n");
}

export function buildTrendingPost(cards: TrendingCards, network: TrendingNetwork): string {
  const blocks: string[] = [];
  const mainnet = network === "mainnet";
  if (!mainnet) blocks.push(bold("🧪 TESTNET, test coins only"));
  blocks.push(bold(mainnet ? "🤌 TRENDING (beta version)" : "🤌 TRENDING"));
  blocks.push(
    block(
      "chads of the day",
      cards.chad.items.map(
        (item) => `${who(item.profile.handle)} ${coinAmount(item.amount, item.chainKey)}`,
      ),
      "no SOL or ETH drops today.",
    ),
  );
  blocks.push(
    block(
      "top coins",
      cards.coin.items.map(
        (item) =>
          `${shortAmount(item.total, item.token.decimals)} ${code(tickerText(item.token.symbol))} by ${who(item.sender.handle)}`,
      ),
      "no coin drops today.",
    ),
  );
  blocks.push(
    block(
      "just dropped",
      cards.drop.items.map(
        (item) =>
          `${dropAmount(item.total, item.chainKey, item.token)} by ${who(item.sender.handle)}`,
      ),
      "no drops yet.",
    ),
  );
  blocks.push(mainnet ? `${LAST_LINE}\n${MAINNET_LINE}` : LAST_LINE);
  return blocks.join("\n\n");
}

/** The one button: `open dropchad`, to the site. */
export function trendingButton(siteUrl: string) {
  return {
    inline_keyboard: [[{ text: "open dropchad", url: siteUrl.replace(/\/+$/, "") }]],
  };
}
