/**
 * The text lines of a drop.
 *
 * Rows and cards, `linesOfCard`. The columns and the chain badge already carry the amount, the
 * chain and the age, so the two lines never repeat them:
 *
 * - Line one: the title the sender gave, else the asset, `SOL drop`, `ETH drop`, `BONK drop`.
 * - Line two: the sender, `@samplechad`, or `unknown sender`. The main tag pill sits next to it.
 *
 * The drop page, `dropLines`, has the same line one, with a title or without
 * there are no columns, so the chain and the age take a line of their own under the sender.
 *
 * Never an invented title. "chad move" is voice, not a fallback.
 */
import type { DropCardData } from "@/components/drops/drop-card-data";
import type { TokenInfo } from "@/lib/api";
import { shortChainName } from "@/lib/chains";
import { formatPeople, percent, timeAgo } from "@/lib/format";
import { dropUnit } from "@/lib/token";

export const UNKNOWN_SENDER = "unknown sender";

export interface CardLines {
  readonly first: string;
  /** `null` is `unknown sender`. */
  readonly sender: { readonly handle: string } | null;
}

/** Line one: the title, else the asset. A token with no ticker is `token drop`. */
function firstLine(title: string | null, chainId: number, token: TokenInfo | null | undefined) {
  if (title !== null) return title;
  if (token && token.symbol === null) return "token drop";
  return `${dropUnit(chainId, token).symbol} drop`;
}

/** Rows and cards. Plain text on line one, the sender on line two. */
export function linesOfCard(card: DropCardData): CardLines {
  return {
    first: firstLine(card.title, card.chainId, card.token),
    sender: card.creator ? { handle: card.creator.handle } : null,
  };
}

/**
 * The phone row's one grey line under the title: the three numbers that are
 * columns on desktop. `3 people · 100% claimed · 2h ago`; people, the word the tiles and the
 * boards use: the rows list handle drops only, and a person is an X account.
 */
export function factsLine(card: DropCardData, now = Date.now()): string {
  return `${formatPeople(card.receivers)} · ${percent(card.claimed, card.receivers)} claimed · ${timeAgo(card.createdAt, now)}`;
}

export interface DropLinesInput {
  readonly title: string | null;
  readonly chainId: number;
  /** A token drop's token. */
  readonly token?: TokenInfo | null;
  /** Unix seconds. `null` when neither side has told us yet. */
  readonly createdAt: number | null;
}

export interface DropLines {
  /** The headline: the rows' line one. */
  readonly first: string;
  /** The grey line under the sender, `Solana test · 2h ago`, or the chain alone. */
  readonly meta: string;
}

/** The drop page headline and its chain and age line, the same with a title or without. */
export function dropLines(input: DropLinesInput, now = Date.now()): DropLines {
  const chain = shortChainName(input.chainId);
  return {
    first: firstLine(input.title, input.chainId, input.token),
    meta: input.createdAt === null ? chain : `${chain} · ${timeAgo(input.createdAt, now)}`,
  };
}
