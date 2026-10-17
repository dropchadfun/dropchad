/**
 * The Telegram channel post text. Telegram HTML with
 * only `a` and `code`; one empty line between the rows. Every word a stranger chose (the handle,
 * the title, the token's name and ticker) is escaped, and the title and the name sit in `<code>`,
 * Every link is built here from a fixed host, never taken from user text.
 */
import { findChain, findQuickToken } from "@dropchad/chains";

export interface TelegramPostFacts {
  readonly dropAddress: string;
  /** Our chain key: `solana`, `robinhood`, or a testnet key. */
  readonly chainKey: string;
  /** The sender's X handle as it is now, without `@`. */
  readonly senderHandle: string;
  /** Base units: what was dropped. */
  readonly amount: string;
  readonly decimals: number;
  /** The chain's coin, `SOL` or `ETH`; the unit when there is no token. */
  readonly coinSymbol: string;
  readonly receivers: number;
  readonly title: string | null;
  /** A token drop's token; `null` on a SOL or ETH drop. */
  readonly token: {
    readonly address: string;
    readonly name: string | null;
    readonly symbol: string | null;
  } | null;
}

export interface TokenLink {
  readonly label: string;
  readonly url: string;
}

/** The X handle charset; anything else is shown as text with no link. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/** The token's name is cut here. */
const NAME_MAX = 32;

/**
 * The token pages, by mainnet chain key. Checked by hand in the browser
 * Axiom is Solana only.
 */
const TOKEN_PAGES: Readonly<Record<string, readonly ((address: string) => TokenLink)[]>> = {
  solana: [
    (a) => ({ label: "dexscreener", url: `https://dexscreener.com/solana/${a}` }),
    (a) => ({ label: "axiom", url: `https://axiom.trade/t/${a}` }),
    (a) => ({ label: "gmgn", url: `https://gmgn.ai/sol/token/${a}` }),
  ],
  robinhood: [
    (a) => ({ label: "dexscreener", url: `https://dexscreener.com/robinhood/${a}` }),
    (a) => ({ label: "gmgn", url: `https://gmgn.ai/robinhood/token/${a}` }),
  ],
};

/** Telegram's HTML: `&`, `<`, `>` and the quote, its named entities. */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Control characters and newlines: exactly what a one line row must not hold. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** One line: control characters and newlines become spaces, runs of spaces one. */
function oneLine(text: string): string {
  return text.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim();
}

/** Base units to whole coins, exact: every decimal, no comma, like the drop page. */
export function exactAmount(base: string, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(base || "0");
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${(value / scale).toString()}${fraction ? `.${fraction}` : ""}`;
}

function link(url: string, text: string): string {
  return `<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(text)}</a>`;
}

function code(text: string): string {
  return `<code>${escapeTelegramHtml(text)}</code>`;
}

/** `solana`, `robinhood`, and on a testnet `solana devnet`, `robinhood testnet`. */
export function chainName(chainKey: string): string {
  return chainKey.replace(/-/g, " ");
}

/** The token links for this chain, or none: a testnet, a stablecoin, a chain with no names. */
export function tokenLinks(chainKey: string, address: string): TokenLink[] {
  if (findChain(chainKey)?.kind !== "mainnet") return [];
  if (findQuickToken(chainKey, address) !== undefined) return [];
  return (TOKEN_PAGES[chainKey] ?? []).map((page) => page(address));
}

export function buildTelegramPost(facts: TelegramPostFacts, siteUrl: string): string {
  const rows: string[] = ["🤌 NEW DROP"];

  const handle = facts.senderHandle;
  rows.push(
    X_HANDLE.test(handle)
      ? `from ${link(`https://x.com/${handle}`, handle)}`
      : `from ${escapeTelegramHtml(handle)}`,
  );

  const token = facts.token;
  const unit = token === null ? facts.coinSymbol : (token.symbol ?? "tokens");
  const whom = facts.receivers === 1 ? "1 chad" : `${String(facts.receivers)} chads`;
  rows.push(
    `${exactAmount(facts.amount, facts.decimals)} ${escapeTelegramHtml(oneLine(unit))} to ${whom}`,
  );

  if (token !== null) {
    const named = oneLine(token.name ?? "") || oneLine(token.symbol ?? "");
    const address = code(token.address);
    rows.push(named === "" ? address : `${code(named.slice(0, NAME_MAX))}, ${address}`);
  }

  rows.push(`chain: ${escapeTelegramHtml(chainName(facts.chainKey))}`);

  const title = oneLine(facts.title ?? "");
  if (title !== "") rows.push(`message: ${code(title)}`);

  if (token !== null) {
    const links = tokenLinks(facts.chainKey, token.address);
    if (links.length > 0) rows.push(links.map((l) => link(l.url, l.label)).join(" | "));
  }

  rows.push(link(`${siteUrl.replace(/\/+$/, "")}/d/${facts.dropAddress}`, "dropchad.com"));
  return rows.join("\n\n");
}
