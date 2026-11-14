/**
 * The trending block's words and links. Pure, so
 * the tests read them without a page. Every line is one string: the card cuts it with `…`.
 */
import { findQuickToken } from "@dropchad/chains";

import type { TrendingChad, TrendingCoin, TrendingDrop, TrendingNewestCoin } from "@/lib/api";
import { chainIdForKey } from "@/lib/chains";
import { formatAmount, formatPeople, shortAmount } from "@/lib/format";
import { dropUnit, NO_TICKER } from "@/lib/token";

/** The short form lives in `lib/format.ts`, shared with the lists. */
export { shortAmount };

/** Each card turns to its next item this often. */
export const TURN_MS = 8000;

export type TrendingKind = "chad" | "coin" | "drop";

/**
 * A card's words. Desktop: `handle` under the name, then on the
 * right `big`, `people` and `accent` in mint. Phone: `big`, `middle`, then `short` in mint.
 */
export interface TrendingLines {
  readonly big: string;
  /** The big line's number, never cut. */
  readonly amount: string;
  /**
   * The big line's unit after it, the ticker or the coin; cut with `…` when long. `coins` on
   * the top coin card.
   */
  readonly unit: string;
  /** The phone's middle line. */
  readonly middle: string;
  /** Desktop, under the big line. */
  readonly people: string;
  /** Desktop, the mint line under it. */
  readonly accent: string;
  /** Desktop, the handle spot: `@handle`, or `by @name +4` on the coin card. */
  readonly handle: string;
  /** The phone's mint line. */
  readonly short: string;
}

/** Chad of the day and top coin count the last 24 hours only. */
const TODAY = "today";

/** "just now", "12 min ago", "3 h ago", "2 d ago". Unix seconds in. */
export function agoText(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - at));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} d ago`;
}

/**
 * An amount with its unit: the chain's coin in its usual form, a token (ticker, else `tokens`)
 * in the short form.
 */
function amountOf(
  base: string,
  chainKey: string,
  token: Parameters<typeof dropUnit>[1],
): { big: string; amount: string; unit: string } {
  const unit = dropUnit(chainIdForKey(chainKey) ?? 0, token);
  const amount =
    token === null || token === undefined
      ? formatAmount(base, unit.decimals)
      : shortAmount(base, unit.decimals);
  return { big: `${amount} ${unit.symbol}`, amount, unit: unit.symbol };
}

export function chadLines(item: TrendingChad, now = Date.now()): TrendingLines {
  const ago = agoText(item.lastDropAt, now);
  return {
    ...amountOf(item.amount, item.chainKey, null),
    middle: `dropped to ${formatPeople(item.people)} ${TODAY}`,
    people: `to ${formatPeople(item.people)}`,
    accent: ago,
    handle: `@${item.profile.handle}`,
    short: ago,
  };
}

/**
 * The top coin's ticker in the name spot: `$` in front, never a
 * second one; no ticker is `tokens`, without one.
 */
export function tickerText(symbol: string | null | undefined): string {
  if (symbol === null || symbol === undefined || symbol === "") return NO_TICKER;
  return symbol.startsWith("$") ? symbol : `$${symbol}`;
}

export function coinLines(item: TrendingCoin): TrendingLines {
  // The item's one sender, never `+N`.
  const by = `by @${item.sender.handle}`;
  // `to N people` as on the other cards, no drop count.
  const reach = `to ${formatPeople(item.people)}`;
  // The number and `coins`: the ticker is only in the name spot.
  const { amount } = amountOf(item.total, item.chainKey, item.token);
  const unit = amount === "1" ? "coin" : "coins";
  return {
    big: `${amount} ${unit}`,
    amount,
    unit,
    middle: `${reach} ${TODAY}`,
    people: reach,
    accent: TODAY,
    handle: by,
    short: by,
  };
}

/**
 * The newest coin drop: the top coin lines, but no `today`; the mint line is its
 * age in whole days in the just dropped form, `3 d ago`, and the phone shows it in the spot of
 * `today`. Always 1 day or more old.
 */
export function newestCoinLines(item: TrendingNewestCoin, now = Date.now()): TrendingLines {
  const lines = coinLines(item);
  const ago = agoText(item.createdAt, now);
  return { ...lines, middle: `${lines.people} ${ago}`, accent: ago };
}

/** A stablecoin: a quick token of its chain, by exact address. */
function isStablecoin(chainKey: string, mint: string): boolean {
  return findQuickToken(chainKey, mint) !== undefined;
}

/**
 * Just dropped: the drop's total, a stablecoin with its ticker, any other token
 * with `coins`; then `to N people` and how long ago it was funded, phone and desktop.
 */
export function dropLines(item: TrendingDrop, now = Date.now()): TrendingLines {
  const ago = agoText(item.fundedAt, now);
  const reach = `to ${formatPeople(item.receivers)}`;
  const amount = amountOf(item.total, item.chainKey, item.token);
  const coins =
    item.token !== null && !isStablecoin(item.chainKey, item.token.mint)
      ? {
          big: `${amount.amount} ${amount.amount === "1" ? "coin" : "coins"}`,
          amount: amount.amount,
          unit: amount.amount === "1" ? "coin" : "coins",
        }
      : amount;
  return {
    ...coins,
    middle: reach,
    people: reach,
    accent: ago,
    handle: `@${item.sender.handle}`,
    short: ago,
  };
}

/** Where the whole card goes. */
export function cardHref(kind: "chad", item: TrendingChad): string;
export function cardHref(kind: "coin", item: TrendingCoin): string;
export function cardHref(kind: "drop", item: TrendingDrop): string;
export function cardHref(
  kind: TrendingKind,
  item: TrendingChad | TrendingCoin | TrendingDrop,
): string {
  if (kind === "chad") return `/u/${(item as TrendingChad).profile.handle}`;
  if (kind === "coin") return `/d/${(item as TrendingCoin).newestDrop}`;
  return `/d/${(item as TrendingDrop).address}`;
}

/** The item after this one, round the list. One item, or none, stays where it is. */
export function nextItem(index: number, count: number): number {
  return count <= 1 ? 0 : (index + 1) % count;
}

/** Which item a card shows, whether it has turned (for the flip), and its timer's start. */
export interface TurnState {
  readonly index: number;
  readonly turned: boolean;
  /** Goes up on a dot tap or a swipe, so the 8 seconds start again. */
  readonly epoch: number;
}

export type TurnAction =
  | { readonly type: "tick"; readonly count: number }
  | { readonly type: "pick"; readonly to: number; readonly count: number }
  | { readonly type: "step"; readonly by: 1 | -1; readonly count: number };

/**
 * One card's turns: the 8 second tick, a dot tap and a swipe. One
 * item, or none, never turns.
 */
export function turnReducer(state: TurnState, action: TurnAction): TurnState {
  const { count } = action;
  const at = state.index < count ? state.index : 0;
  if (action.type === "tick") {
    return count <= 1 ? state : { ...state, index: nextItem(at, count), turned: true };
  }
  if (action.type === "pick") {
    const to = action.to >= 0 && action.to < count ? action.to : 0;
    return { index: to, turned: state.turned || to !== at, epoch: state.epoch + 1 };
  }
  if (count <= 1) return state;
  return {
    index: (at + action.by + count) % count,
    turned: true,
    epoch: state.epoch + 1,
  };
}

/** A swipe must move this far sideways. */
export const SWIPE_PX = 40;

/**
 * A finished touch as a turn: left is the next item, right the last one, `0` when it was too
 * short or more up and down than sideways, so the page scrolls instead.
 */
export function swipeStep(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
