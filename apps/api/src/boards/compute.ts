/**
 * Top chads.: the board decides who really gives.
 *
 * The indexer hands over one row per final, verified drop with the drop's `creatorCommitment`.
 * A commitment is `keccak256(abi.encode(xUserId, nonce))`, so it is unique
 * per drop and says nothing on its own about who made it. Our `drops` table is the only thing
 * that maps a commitment back to an X id, and `profiles` is the only thing that gives that id a
 * face. So the join is: indexed drop -> our drop, on the commitment -> profile, on the X id.
 *
 * A drop whose commitment we do not know is **not attributed to anyone**, however big it is. That
 * is the same rule seen from the other side: only a drop the relayer made through this api
 * can be tied to a chad, and a stray factory event never buys a rank.
 *
 * **Only handle drops count **. A multisend is
 * on no board. A handle drop counts **people**: the X ids behind its claimed leaves, never the
 * wallets paid, so one X id is one person on every drop inside one chain; across chains the
 * counts add up. `load.ts` does the
 * reads and hands in `CountedDrop` rows; everything here works on those.
 *
 * **Two chains, one board, one honest number.** A chad's totals are kept **per chain**, in that
 * chain's own unit, `byChain`. Coins are never added to each other. What adds up is the usd from
 * the price frozen on each drop at activation, native coins only; the usd boards
 * rank on that, `most wallets fed` ranks on wallets, and the response says `rankedBy` out loud.
 *
 * **Claimed, never funded.** Every number here comes from final claims: the indexer's summed
 * claims and claimed indexes on the EVM side, `total_claimed` and the bitmap on Solana. What a
 * sender funded is never read. A drop nobody claimed is not on any board.
 *
 * Everything here is pure. The route does the reads and hands the rows in.
 */
import { findChain } from "@dropchad/chains";

import type { ChainFilter } from "../chain/filter.js";

/** `day` is the last 24 hours, `week` the last 7 days, by drop creation time. */
export const BOARD_RANGES = ["day", "week", "all"] as const;
export type BoardRange = (typeof BOARD_RANGES)[number];

/**
 * The sender kinds. Self declared on the profile page, so a kind proves
 * nothing; it is a label, not a badge. `chad` is the default: a NULL column reads as `chad`, so
 * nobody needed a migration and nobody is unclassified.
 */
export const PROFILE_KINDS = ["chad", "kol", "project"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** The board tabs: the kinds plus `all` for the everyone tab. */
export const BOARD_KINDS = ["all", ...PROFILE_KINDS] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

/** NULL and anything the api never wrote, the old `dev`, are `chad`. */
export function profileKind(raw: string | null | undefined): ProfileKind {
  return raw === "kol" || raw === "project" ? raw : "chad";
}

/**
 * The tags a chad can pick for themselves, one to three. One flat
 * list, `chad` first and a normal pick, `musician` after `streamer`. The first
 * of a saved list is the main tag. Self picked, so a tag proves nothing. `project` is not a tag,
 * it is the kind a project tag derives.
 */
export const PROFILE_TAGS = [
  "chad",
  "kol",
  "dev",
  "streamer",
  "musician",
  "trader",
  "community",
  "memecoin",
  "utility",
  "nft",
] as const;
export type ProfileTag = (typeof PROFILE_TAGS)[number];
/** The tags that make a project. */
export const PROJECT_TAGS: readonly ProfileTag[] = ["memecoin", "utility", "nft"];

/** How many tags one chad can hold. */
export const MAX_TAGS = 3;

/** A saved set cannot change for this long. `routes/me.ts` enforces it. */
export const TAG_LOCK_DAYS = 30;
export const TAG_LOCK_MS = TAG_LOCK_DAYS * 24 * 60 * 60 * 1000;

/**
 * A stored `tags` column as the public value, in order. NULL is none; a value the api never
 * wrote, a repeat or anything past the third is left out.
 */
export function profileTags(raw: readonly string[] | null | undefined): ProfileTag[] {
  const out: ProfileTag[] = [];
  for (const tag of raw ?? []) {
    if (out.length === MAX_TAGS) break;
    if ((PROFILE_TAGS as readonly string[]).includes(tag) && !out.includes(tag as ProfileTag)) {
      out.push(tag as ProfileTag);
    }
  }
  return out;
}

/** The moment the set can change again: the save plus the lock. NULL when never saved. */
export function tagLockedUntil(setAt: Date | null | undefined): Date | null {
  return setAt === null || setAt === undefined ? null : new Date(setAt.getTime() + TAG_LOCK_MS);
}

/**
 * The kind, derived from the main tag, the first one, on every save. A project tag as the main
 * tag makes a project, `kol` makes a kol, everything else (`musician` included) and no tag makes
 * a chad; the other tags never change it. The boards keep reading `kind`.
 */
export function kindFromTags(tags: readonly ProfileTag[]): ProfileKind {
  const first = tags[0];
  if (first !== undefined && PROJECT_TAGS.includes(first)) return "project";
  if (first === "kol") return "kol";
  return "chad";
}

/**
 * Earned badges, never picked. `project` is the green verified project badge, `cto` the orange
 * takeover badge, `streamer` the blue one for a connected twitch or kick channel. None of the
 * proofs exist yet, so today every profile carries an empty list.
 */
export const PROFILE_BADGES = ["project", "cto", "streamer"] as const;
export type ProfileBadge = (typeof PROFILE_BADGES)[number];

export const DAY_SECONDS = 24 * 60 * 60;
export const WEEK_SECONDS = 7 * DAY_SECONDS;

export interface BoardProfile {
  readonly xUserId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly profileImageUrl: string | null;
  readonly kind: ProfileKind;
  /** One to three, in the order tapped; empty when never picked. */
  readonly tags: ProfileTag[];
  /** ISO time. The save plus 30 days, whether or not that is in the past. NULL when never saved. */
  readonly tagLockedUntil: string | null;
  readonly badges: ProfileBadge[];
}

/** A `profiles` row, or the same columns selected, as the public shape. */
export function boardProfile(
  row: Omit<BoardProfile, "kind" | "tags" | "tagLockedUntil" | "badges"> & {
    kind: string | null;
    tags: readonly string[] | null;
    tagSetAt: Date | null;
  },
): BoardProfile {
  return {
    xUserId: row.xUserId,
    handle: row.handle,
    displayName: row.displayName,
    profileImageUrl: row.profileImageUrl,
    kind: profileKind(row.kind),
    tags: profileTags(row.tags),
    tagLockedUntil: tagLockedUntil(row.tagSetAt)?.toISOString() ?? null,
    // Nothing earns a badge yet. The shape is fixed so the page can be built against it.
    badges: [],
  };
}

/** One chad on one chain, in that chain's base unit. */
export interface ChainTotals {
  readonly chainKey: string;
  readonly total: bigint;
  readonly biggestDrop: bigint;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  /** Payouts: every final claim on this chain. */
  readonly claimCount: number;
  /** Usd from the prices frozen at activation. Unpriced drops add zero. */
  readonly usd: number;
}

/** What one chad has given. Amounts stay `bigint` until the edge. */
export interface ChadTotals {
  readonly profile: BoardProfile;
  /**
   * The total in the **selected** chain's unit when the board is filtered to one chain. With
   * every chain in scope it is the EVM family's wei, which is what this field always carried,
   * and `byChain` is where the other chains are.
   */
  readonly totalWei: bigint;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  /** Payouts, every final claim, the chains added up like the people. */
  readonly claimCount: number;
  readonly biggestDropWei: bigint;
  /** Unix seconds of the newest drop counted. */
  readonly lastDropAt: number;
  /** Usd across every chain in `byChain`: usd adds up where coins do not. Unpriced drops are zero. */
  readonly usd: number;
  readonly byChain: readonly ChainTotals[];
  /** Different tokens dropped, by mint. Never an amount. */
  readonly tokens: number;
}

/**
 * Which drops a total counts. `native`: SOL and ETH drops only, `best dropchad` and
 * `dropper`. `token`: token drops only, `best token`. `all`: every drop, the tiles and the
 * profile. Whatever the scope, a token amount never enters a coin total or the usd.
 */
export type AssetScope = "native" | "token" | "all";

export type RankedBy = "totalWei" | "uniqueReceivers" | "usd";

/** Base units to usd with the price frozen on the drop. `null` price, or an unknown chain, is zero. */
export function usdOf(amount: bigint, chainKey: string, priceUsd: number | null): number {
  if (priceUsd === null) return 0;
  const chain = findChain(chainKey);
  if (chain === undefined) return 0;
  // The same rule as `routes/drops.ts`: lamports on Solana, wei on the EVM.
  const decimals = chain.family === "svm" ? 9 : 18;
  return (Number(amount) / 10 ** decimals) * priceUsd;
}

/** One handle drop that counts. Built by `load.ts`, pure from here on. */
export interface CountedDrop {
  /** Canonical form, `canonicalAddress`. */
  readonly address: string;
  readonly chainKey: string;
  /** The sender, from our `drops` row. */
  readonly xUserId: string;
  /** Unix seconds. */
  readonly createdAt: number;
  /** The final claimed amount, in the chain's base unit. */
  readonly claimed: bigint;
  /** The final claims, one per claimed leaf. Never zero: a drop nobody claimed is not counted. */
  readonly claimCount: number;
  /** The X ids behind the claimed leaves. People, never wallets. */
  readonly people: readonly string[];
  /** The usd price frozen at activation. `null` counts zero. */
  readonly priceUsd: number | null;
  /** A token drop's token, from our row's `asset`; `null` or absent on a SOL or ETH drop. */
  readonly mint?: string | null;
}

/** A token drop: its asset is a token, not the chain's coin. */
export function isTokenDrop(drop: CountedDrop): boolean {
  return drop.mint !== undefined && drop.mint !== null;
}

export interface BoardRow extends ChadTotals {
  readonly rank: number;
}

/**
 * Group counted handle drops by chad. `profilesById` from `profiles`; a drop whose sender has no
 * profile is dropped on the floor, see the header.
 */
export function totalsByChad(
  counted: readonly CountedDrop[],
  profilesById: ReadonlyMap<string, BoardProfile>,
  options: {
    /** Which chains' amounts fill `totalWei`: one key, or the whole EVM family for `all`. */
    readonly filter: ChainFilter;
    /** Chain keys of the EVM family, for the `all` case. */
    readonly evmChainKeys: ReadonlySet<string>;
    /** Which drops count. `all` when absent. */
    readonly assets?: AssetScope;
  },
): ChadTotals[] {
  const assets = options.assets ?? "all";
  interface PerChain {
    total: bigint;
    biggest: bigint;
    drops: number;
    receivers: Set<string>;
    claims: number;
    usd: number;
  }
  const acc = new Map<
    string,
    {
      profile: BoardProfile;
      drops: number;
      last: number;
      chains: Map<string, PerChain>;
      mints: Set<string>;
    }
  >();

  for (const drop of counted) {
    const xUserId = drop.xUserId;
    const profile = profilesById.get(xUserId);
    if (profile === undefined) continue;
    // Boards rank claimed money, never funded. A drop with no final claim is
    // worth nothing here: not a drop, not a date, not a row. Funding alone buys no rank, and
    // `dropCount` is a tie break, so it would. `load.ts` never hands one in; this says so twice.
    if (drop.claimCount === 0) continue;
    const isToken = isTokenDrop(drop);
    if ((assets === "native" && isToken) || (assets === "token" && !isToken)) continue;

    const chainKey = drop.chainKey;
    const amount = drop.claimed;
    const createdAt = drop.createdAt;
    const entry = acc.get(xUserId) ?? {
      profile,
      drops: 0,
      last: 0,
      chains: new Map<string, PerChain>(),
      mints: new Set<string>(),
    };
    const chain = entry.chains.get(chainKey) ?? {
      total: 0n,
      biggest: 0n,
      drops: 0,
      receivers: new Set<string>(),
      claims: 0,
      usd: 0,
    };
    // A token amount is never added to a coin, and a token never gets usd.
    if (isToken) {
      entry.mints.add(drop.mint as string);
    } else {
      chain.total += amount;
      chain.usd += usdOf(amount, chainKey, drop.priceUsd);
      if (amount > chain.biggest) chain.biggest = amount;
    }
    chain.drops += 1;
    chain.claims += drop.claimCount;
    entry.drops += 1;
    for (const person of drop.people) chain.receivers.add(person);
    if (createdAt > entry.last) entry.last = createdAt;
    entry.chains.set(chainKey, chain);
    acc.set(xUserId, entry);
  }

  // Which chains' amounts the headline fields sum: the selected ones, or the EVM family for all.
  const headline = (chainKey: string): boolean =>
    options.filter.keys === null
      ? options.evmChainKeys.has(chainKey)
      : options.filter.keys.has(chainKey);

  return [...acc.values()].map((entry) => {
    const byChain = [...entry.chains.entries()].map(([chainKey, chain]) => ({
      chainKey,
      total: chain.total,
      biggestDrop: chain.biggest,
      dropCount: chain.drops,
      uniqueReceivers: chain.receivers.size,
      claimCount: chain.claims,
      usd: chain.usd,
    }));
    const counted = byChain.filter((chain) => headline(chain.chainKey));
    return {
      profile: entry.profile,
      usd: byChain.reduce((sum, chain) => sum + chain.usd, 0),
      totalWei: counted.reduce((sum, chain) => sum + chain.total, 0n),
      dropCount: entry.drops,
      // People are counted per chain: once inside one chain, the chains
      // added up. `load.ts` hands in only the filtered chains, so one chain is that chain's own.
      uniqueReceivers: byChain.reduce((n, chain) => n + chain.uniqueReceivers, 0),
      claimCount: byChain.reduce((n, chain) => n + chain.claimCount, 0),
      biggestDropWei: counted.reduce(
        (max, chain) => (chain.biggestDrop > max ? chain.biggestDrop : max),
        0n,
      ),
      lastDropAt: entry.last,
      byChain,
      tokens: entry.mints.size,
    };
  });
}

/**
 * The three boards. `fed` is people fed, live on every chain view, no price
 * needed. `dropper` is everyone by usd. Both count SOL and ETH drops only. `project`, `best
 * token`, counts token drops only. Usd is the price frozen at activation; a drop
 * with no price counts zero.
 */
export const BOARD_TYPES = ["fed", "dropper", "project"] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

/** How a board is ordered, whatever the chain filter. */
/**
 * `fed` and `project` rank by the number of people paid -09-16: `best
 * dropchad` and `best token`. `dropper` is the usd board, kept in the api for later, no tab.
 */
export function rankedByFor(board: BoardType): RankedBy {
  return board === "dropper" ? "usd" : "uniqueReceivers";
}

/** The drops a board counts. */
export function assetScopeFor(board: BoardType): AssetScope {
  return board === "project" ? "token" : "native";
}

/**
 * Order and rank. Biggest total first; on a tie, more unique receivers, then the earlier chad.
 * `kind` other than `all` keeps only profiles with exactly that kind. Nobody is unclassified:
 * a profile that never picked is `chad`.
 */
export function rankBoard(
  totals: readonly ChadTotals[],
  kind: BoardKind,
  rankedBy: RankedBy = "totalWei",
): BoardRow[] {
  const byTotal = (a: ChadTotals, b: ChadTotals) => {
    if (a.totalWei !== b.totalWei) return a.totalWei > b.totalWei ? -1 : 1;
    if (a.uniqueReceivers !== b.uniqueReceivers) return b.uniqueReceivers - a.uniqueReceivers;
    return a.profile.xUserId < b.profile.xUserId ? -1 : 1;
  };
  const byReceivers = (a: ChadTotals, b: ChadTotals) => {
    if (a.uniqueReceivers !== b.uniqueReceivers) return b.uniqueReceivers - a.uniqueReceivers;
    if (a.dropCount !== b.dropCount) return b.dropCount - a.dropCount;
    return a.profile.xUserId < b.profile.xUserId ? -1 : 1;
  };
  const byUsd = (a: ChadTotals, b: ChadTotals) => {
    if (a.usd !== b.usd) return b.usd - a.usd;
    return byReceivers(a, b);
  };
  const sorters: Record<RankedBy, (a: ChadTotals, b: ChadTotals) => number> = {
    totalWei: byTotal,
    uniqueReceivers: byReceivers,
    usd: byUsd,
  };
  return totals
    .filter((entry) => kind === "all" || entry.profile.kind === kind)
    .sort(sorters[rankedBy])
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** The JSON shape. Wei becomes a decimal string here and nowhere else. */
export function boardRowJson(row: BoardRow) {
  return {
    rank: row.rank,
    profile: row.profile,
    totalWei: row.totalWei.toString(),
    dropCount: row.dropCount,
    uniqueReceivers: row.uniqueReceivers,
    claimCount: row.claimCount,
    // Two decimals is a display number. The float underneath is not money.
    usd: Math.round(row.usd * 100) / 100,
    biggestDropWei: row.biggestDropWei.toString(),
    lastDropAt: row.lastDropAt,
    byChain: row.byChain.map((chain) => ({
      chainKey: chain.chainKey,
      total: chain.total.toString(),
      biggestDrop: chain.biggestDrop.toString(),
      dropCount: chain.dropCount,
      uniqueReceivers: chain.uniqueReceivers,
      claimCount: chain.claimCount,
      usd: Math.round(chain.usd * 100) / 100,
    })),
  };
}
