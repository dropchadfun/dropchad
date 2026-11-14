/**
 * The trending block: three cards, up to three
 * items each, best first.
 *
 * - `chad`, chad of the day: SOL and ETH drops only, by people, then usd.
 * - `coin`, top coin: one sender with one coin (chain and token address), by people, then the
 *   claimed amount in whole coins; never a stablecoin.
 *   With no item, `newest` is the newest counted token drop ever, one drop; the
 *   route reads it, the Telegram post never does.
 * - `drop`, just dropped: the newest funded handle drops, any coin, by the funding time, no
 *   window, claims do not matter.
 *
 * Chad of the day and top coin count as the board: `load.ts` hands in the same `CountedDrop`
 * rows, so handle drops only, final claims only, people are X ids, the last 24 hours only,
 * rolling, on the creation time, never a longer range. Just dropped takes the
 * `FundedDrop` rows `loadFundedDrops` read on chain at final.
 *
 * Everything here is pure. The route does the reads.
 */
import { findChain, findQuickToken } from "@dropchad/chains";

import type { ChainFilter } from "../chain/filter.js";
import type { TokenInfo } from "../drops/token-info.js";
import {
  totalsByChad,
  isTokenDrop,
  DAY_SECONDS,
  type BoardProfile,
  type ChainTotals,
  type CountedDrop,
} from "./compute.js";

/** Items per card. */
export const TRENDING_ITEMS = 3;

/** Always the last 24 hours. */
export type TrendingRange = "day";

export interface TrendingCard<T> {
  readonly range: TrendingRange;
  readonly items: readonly T[];
}

export interface ChadItem {
  readonly profile: BoardProfile;
  /** The board's number: X ids, the chains added up. */
  readonly people: number;
  readonly drops: number;
  /** Unix seconds of the newest counted drop. */
  readonly lastDropAt: number;
  /** The chain with the most people paid; its badge and its amount. */
  readonly chainKey: string;
  /** Claimed on that chain, in its base unit. */
  readonly amount: bigint;
}

export interface CoinItem {
  readonly token: TokenInfo;
  readonly chainKey: string;
  /** The sender's drops of this coin. */
  readonly drops: number;
  /** Distinct X ids over the sender's drops of it. */
  readonly people: number;
  /** The one sender of this item. */
  readonly sender: BoardProfile;
  /** The address of the sender's newest drop of it, the card's link. */
  readonly newestDrop: string;
  /** What those drops paid out, final claims only, base units. */
  readonly total: bigint;
}

/** Top coin with no item: the newest counted token drop ever, one drop. */
export interface NewestCoin extends CoinItem {
  /** The drop's creation time, unix seconds. */
  readonly createdAt: number;
}

/** A handle drop the chain says was funded, read at final. */
export interface FundedDrop {
  /** Canonical form, `canonicalAddress`. */
  readonly address: string;
  readonly chainKey: string;
  /** The sender, from our `drops` row. */
  readonly xUserId: string;
  /** Unix seconds. */
  readonly createdAt: number;
  /** The chain's funding time, `activatedAt`, unix seconds. */
  readonly fundedAt: number;
  /** The drop's leaves, one per person. */
  readonly receivers: number;
  /** The drop's total in its own unit, base units. */
  readonly total: bigint;
  /** `null` on a SOL or ETH drop. */
  readonly token: TokenInfo | null;
}

export interface DropItem {
  readonly address: string;
  readonly chainKey: string;
  readonly sender: BoardProfile;
  /** The drop's leaves, one per person. */
  readonly receivers: number;
  /** The drop's total in its own unit, base units. */
  readonly total: bigint;
  /** `null` on a SOL or ETH drop. */
  readonly token: TokenInfo | null;
  /** The chain's funding time, unix seconds. */
  readonly fundedAt: number;
}

export interface TrendingCards {
  readonly chad: TrendingCard<ChadItem>;
  readonly coin: TrendingCard<CoinItem> & {
    /** Set only by the route's read when `items` is empty. */
    readonly newest?: NewestCoin | null;
  };
  /** No window, so no `range`. */
  readonly drop: { readonly items: readonly DropItem[] };
}

export interface TrendingOptions {
  readonly filter: ChainFilter;
  /** Chain keys of the EVM family, as `totalsByChad` needs them. */
  readonly evmChainKeys: ReadonlySet<string>;
  readonly nowSeconds: number;
}

/** Most people; on a tie the Solana family first, then the chain key. */
function topChain(chains: readonly ChainTotals[]): ChainTotals | undefined {
  const svm = (key: string) => (findChain(key)?.family === "svm" ? 0 : 1);
  return [...chains].sort((a, b) => {
    if (a.uniqueReceivers !== b.uniqueReceivers) return b.uniqueReceivers - a.uniqueReceivers;
    if (svm(a.chainKey) !== svm(b.chainKey)) return svm(a.chainKey) - svm(b.chainKey);
    return a.chainKey < b.chainKey ? -1 : 1;
  })[0];
}

export function chadItems(
  counted: readonly CountedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
  options: TrendingOptions,
): ChadItem[] {
  const totals = totalsByChad(counted, profilesById, {
    filter: options.filter,
    evmChainKeys: options.evmChainKeys,
    assets: "native",
  });
  // Most people, then usd, then more drops, then the lower X id.
  return [...totals]
    .sort((a, b) => {
      if (a.uniqueReceivers !== b.uniqueReceivers) return b.uniqueReceivers - a.uniqueReceivers;
      if (a.usd !== b.usd) return b.usd - a.usd;
      if (a.dropCount !== b.dropCount) return b.dropCount - a.dropCount;
      return a.profile.xUserId < b.profile.xUserId ? -1 : 1;
    })
    .slice(0, TRENDING_ITEMS)
    .flatMap((row) => {
      const chain = topChain(row.byChain);
      if (chain === undefined) return [];
      return [
        {
          profile: row.profile,
          people: row.uniqueReceivers,
          drops: row.dropCount,
          lastDropAt: row.lastDropAt,
          chainKey: chain.chainKey,
          amount: chain.total,
        },
      ];
    });
}

/** The drops a card may count: a final claim and a sender with a profile, as on the board. */
function countable(
  counted: readonly CountedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
): CountedDrop[] {
  return counted.filter((drop) => drop.claimCount > 0 && profilesById.has(drop.xUserId));
}

/** Earlier first, then the lower address, so every order is the same order. */
const byCreated = (a: CountedDrop, b: CountedDrop) =>
  a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.address < b.address ? -1 : 1;

/** A stablecoin: a quick token of its chain, by exact address. */
function isStablecoin(drop: CountedDrop): boolean {
  return isTokenDrop(drop) && findQuickToken(drop.chainKey, drop.mint as string) !== undefined;
}

/** `a` minus `b` in whole coins, exact: each amount over its own decimals. */
function compareWhole(a: bigint, aDecimals: number, b: bigint, bDecimals: number): number {
  const left = a * 10n ** BigInt(bDecimals);
  const right = b * 10n ** BigInt(aDecimals);
  return left === right ? 0 : left > right ? 1 : -1;
}

export function coinItems(
  counted: readonly CountedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
): CoinItem[] {
  // One item per sender and coin.
  const byItem = new Map<string, CountedDrop[]>();
  for (const drop of countable(counted, profilesById)) {
    if (!isTokenDrop(drop)) continue;
    // Never a stablecoin.
    if (isStablecoin(drop)) continue;
    const key = `${drop.chainKey}#${(drop.mint as string).toLowerCase()}#${drop.xUserId}`;
    byItem.set(key, [...(byItem.get(key) ?? []), drop]);
  }

  const coins = [...byItem.values()].flatMap((list) => {
    const ordered = [...list].sort(byCreated);
    const first = ordered[0];
    const newest = ordered[ordered.length - 1];
    const token = ordered.find((drop) => drop.token !== undefined && drop.token !== null)?.token;
    if (first === undefined || newest === undefined || token === undefined || token === null) {
      return [];
    }
    const people = new Set(ordered.flatMap((drop) => drop.people));
    return [
      {
        token,
        chainKey: first.chainKey,
        drops: ordered.length,
        people: people.size,
        sender: profilesById.get(first.xUserId) as BoardProfile,
        newestDrop: newest.address,
        // Claimed, never funded, as on the board.
        total: ordered.reduce((sum, drop) => sum + drop.claimed, 0n),
        firstAt: first.createdAt,
        firstAddress: first.address,
      },
    ];
  });

  return coins
    .sort((a, b) => {
      if (a.people !== b.people) return b.people - a.people;
      const whole = compareWhole(b.total, b.token.decimals, a.total, a.token.decimals);
      if (whole !== 0) return whole;
      if (a.firstAt !== b.firstAt) return a.firstAt - b.firstAt;
      return a.firstAddress < b.firstAddress ? -1 : 1;
    })
    .slice(0, TRENDING_ITEMS)
    .map(({ firstAt: _firstAt, firstAddress: _firstAddress, ...item }) => item);
}

/**
 * The newest counted token drop ever: the top coin rules, no window. Newest by
 * creation time, then the lower address. One drop as one item; `null` when there is none.
 */
export function newestCoin(
  counted: readonly CountedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
): NewestCoin | null {
  const coins = countable(counted, profilesById).filter(
    (drop) => isTokenDrop(drop) && !isStablecoin(drop) && drop.token != null,
  );
  const newest = coins.sort((a, b) =>
    a.createdAt !== b.createdAt ? b.createdAt - a.createdAt : a.address < b.address ? -1 : 1,
  )[0];
  if (newest === undefined || newest.token == null) return null;
  return {
    token: newest.token,
    chainKey: newest.chainKey,
    drops: 1,
    people: new Set(newest.people).size,
    sender: profilesById.get(newest.xUserId) as BoardProfile,
    newestDrop: newest.address,
    total: newest.claimed,
    createdAt: newest.createdAt,
  };
}

/**
 * Just dropped: the newest funding time first, then the newest creation, then the
 * lower address. Any coin, no window; a sender with no profile counts nowhere.
 */
export function dropItems(
  funded: readonly FundedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
): DropItem[] {
  return funded
    .filter((drop) => profilesById.has(drop.xUserId))
    .sort((a, b) => {
      if (a.fundedAt !== b.fundedAt) return b.fundedAt - a.fundedAt;
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      return a.address < b.address ? -1 : 1;
    })
    .slice(0, TRENDING_ITEMS)
    .map((drop) => ({
      address: drop.address,
      chainKey: drop.chainKey,
      sender: profilesById.get(drop.xUserId) as BoardProfile,
      receivers: drop.receivers,
      total: drop.total,
      token: drop.token,
      fundedAt: drop.fundedAt,
    }));
}

/**
 * The three cards. Chad of the day and top coin from the drops of the last 24 hours, an older
 * drop is cut here too; just dropped from the funded drops, no window.
 */
export function trendingCards(
  counted: readonly CountedDrop[],
  funded: readonly FundedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
  options: TrendingOptions,
): TrendingCards {
  const since = options.nowSeconds - DAY_SECONDS;
  const day = counted.filter((drop) => drop.createdAt >= since);
  return {
    chad: { range: "day", items: chadItems(day, profilesById, options) },
    coin: { range: "day", items: coinItems(day, profilesById) },
    drop: { items: dropItems(funded, profilesById) },
  };
}

/** The empty cards, for a chain that cannot be read. */
export const NO_TRENDING: TrendingCards = {
  chad: { range: "day", items: [] },
  coin: { range: "day", items: [] },
  drop: { items: [] },
};

/** The JSON shape. Base units become decimal strings here and nowhere else. */
export function trendingJson(cards: TrendingCards) {
  return {
    chad: {
      range: cards.chad.range,
      items: cards.chad.items.map((item) => ({ ...item, amount: item.amount.toString() })),
    },
    coin: {
      range: cards.coin.range,
      items: cards.coin.items.map((item) => ({ ...item, total: item.total.toString() })),
      newest:
        cards.coin.newest == null
          ? null
          : { ...cards.coin.newest, total: cards.coin.newest.total.toString() },
    },
    drop: {
      items: cards.drop.items.map((item) => ({ ...item, total: item.total.toString() })),
    },
  };
}
