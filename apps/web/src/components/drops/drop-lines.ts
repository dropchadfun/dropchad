/**
 * The text lines of a drop.
 *
 * Rows and cards, `linesOfCard`. The columns and the chain badge already carry the amount, the
 * chain and the age, so the two lines never repeat them:
 *
 * - Line one: the title the sender gave, else the asset, `SOL drop`, `ETH drop`, `BONK drop`.
 * - Line two: the sender, `@samplechad`, or `unknown sender`. The main tag pill sits next to it.
 *
 * The drop page, `dropLines`, has its own headline: there are no columns, so without a title it
 * says what happened, `samplechad dropped 0.003 SOL`, present tense until it is finished, and the
 * chain and the age take the second line.
 *
 * Never an invented title. "chad move" is voice, not a fallback.
 */
import type { DropCardData } from "@/components/drops/drop-card-data";
import type { TokenInfo } from "@/lib/api";
import { shortChainName } from "@/lib/chains";
import { formatAmount, formatPeople, percent, timeAgo } from "@/lib/format";
import { dropUnit, tickerShow } from "@/lib/token";

export const UNKNOWN_SENDER = "unknown sender";

export interface CardLines {
  readonly first: string;
  /** `null` is `unknown sender`. */
  readonly sender: { readonly handle: string } | null;
}

/** Rows and cards. Plain text on line one, the sender on line two. */
export function linesOfCard(card: DropCardData): CardLines {
  return {
    // A token with no ticker is `token drop`, never `tokens drop`.
    first:
      card.title ??
      (card.token && card.token.symbol === null
        ? "token drop"
        : `${dropUnit(card.chainId, card.token).symbol} drop`),
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
  /** The X handle, no `@`. */
  readonly handle: string | null;
  readonly amountWei: string;
  readonly chainId: number;
  /** A token drop's token: the amount is in it. */
  readonly token?: TokenInfo | null;
  /** Unix seconds. `null` when neither side has told us yet. */
  readonly createdAt: number | null;
  /** `dropped` once it is done or expired, `is dropping` before that, funding included. */
  readonly finished: boolean;
}

export type SecondLine =
  /** The sender slot: `@handle`, or whatever the screen shows for an unknown sender. */
  | { readonly kind: "sender" }
  /** The sender is in the first line already: the chain and the age instead. */
  | { readonly kind: "meta"; readonly text: string };

export interface DropLines {
  readonly first: string;
  readonly second: SecondLine;
}

/**
 * The headline in two parts, so a long ticker can be one size smaller (,
 * ): the words and the amount, then the unit. A token's ticker as `$TEST`, cut over
 * 10 letters; `tokens` with no ticker; the coin as it is. With a title, the title alone.
 */
export function headlineParts(input: DropLinesInput): {
  lead: string;
  amount: string | null;
  unit: string | null;
  small: boolean;
} {
  if (input.title !== null) return { lead: input.title, amount: null, unit: null, small: false };
  const verb = input.finished ? "dropped" : "is dropping";
  const unit = dropUnit(input.chainId, input.token);
  const amount = formatAmount(input.amountWei, unit.decimals);
  // The words may wrap on the phone; the amount and the unit stay together, never cut.
  const lead = `${input.handle === null ? "" : `${input.handle} `}${verb} `;
  const ticker = input.token?.symbol ?? null;
  if (ticker === null) return { lead, amount, unit: unit.symbol, small: false };
  const shown = tickerShow(ticker);
  return { lead, amount, unit: `$${shown.text}`, small: shown.small };
}

/** The drop page headline. */
export function dropLines(input: DropLinesInput, now = Date.now()): DropLines {
  if (input.title !== null) return { first: input.title, second: { kind: "sender" } };
  const parts = headlineParts(input);
  const first = `${parts.lead}${parts.amount ?? ""} ${parts.unit ?? ""}`;
  if (input.handle === null) return { first, second: { kind: "sender" } };
  const chain = shortChainName(input.chainId);
  const meta = input.createdAt === null ? chain : `${chain} · ${timeAgo(input.createdAt, now)}`;
  return { first, second: { kind: "meta", text: meta } };
}
