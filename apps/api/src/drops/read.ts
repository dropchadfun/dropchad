/**
 * The read side for both chains, merged.
 *
 * The EVM side comes from the indexer, as before. The Solana side comes from our own `drops`
 * table plus a direct read of the cluster, `src/chain/svm/reader.ts`, because there is no Solana
 * indexer yet. The two are put side by side here so the routes
 * stay small, and every entry says where it came from: `source: "indexer"` or `source: "rpc"`.
 *
 * **Units are never added across chains.** Wei and lamports are different numbers about
 * different coins. Totals are reported per chain, each with its symbol and decimals, and the
 * unit free counts — drops, wallets, claims — are the only things summed for `chain=all`.
 */
import { chains } from "@dropchad/chains";
import { and, desc, eq, inArray } from "drizzle-orm";

import { isTokenDrop, usdOf, type CountedDrop } from "../boards/compute.js";
import { filterIncludes, unitOf, type ChainFilter } from "../chain/filter.js";
import type { SvmReader } from "../chain/svm/reader.js";
import type { Database } from "../db/client.js";
import { drops, type DropRow } from "../db/schema.js";
import { IndexerUnavailableError, type BoardDrop, type IndexerClient } from "../indexer/client.js";

export interface ReadDeps {
  readonly db: Database;
  readonly indexer: IndexerClient;
  /** Absent when no Solana RPC url is configured. Then Solana simply has no read side. */
  readonly solana?: SvmReader | undefined;
  /** The chain the indexer follows: `CHAIN_KEY`. Its rows carry no key of their own. */
  readonly indexerChainKey: string;
}

/** Our Solana rows in scope for a filter, newest first. */
export async function solanaRows(
  deps: ReadDeps,
  filter: ChainFilter,
  limit?: number,
): Promise<DropRow[]> {
  if (deps.solana === undefined || !filter.families.has("svm")) return [];
  const keys = chains
    .filter((c) => c.family === "svm" && filterIncludes(filter, c.key))
    .map((c) => c.key);
  if (keys.length === 0) return [];
  const query = deps.db
    .select()
    .from(drops)
    .where(inArray(drops.chainKey, keys))
    .orderBy(desc(drops.createdAt));
  return limit === undefined ? query : query.limit(limit);
}

export interface ListEntryLike {
  readonly address: string;
  /** Unix seconds as a string. An indexer row always has it; the sort treats a missing one as oldest. */
  readonly createdAt?: string;
  readonly source?: string;
}

export interface MergedList {
  readonly drops: ListEntryLike[];
  readonly sources: {
    readonly indexer: { readonly available: boolean; readonly chainKey: string };
    readonly solana: {
      readonly configured: boolean;
      readonly available: boolean;
      readonly chainKey: string | null;
    };
  };
}

/**
 * `GET /api/drops`, the rows behind `live now` and latest drops: **our handle drops only**, both
 * chains, newest first, cut at `limit`.: a
 * multisend is on no public list, and neither is a drop we did not create.
 *
 * The list starts from our own rows, never from the indexer's list: the indexer's newest rows
 * are all multisend today, so filtering them would leave nothing even once handle drops exist.
 * Each EVM row takes its chain side from the indexer, one `getDrop` per row, and a row the
 * indexer has not seen yet is left out until it has. An indexer that is down throws
 * `IndexerUnavailableError` for the route to turn into its 503. Each Solana row is read back from
 * the cluster as before.
 */
export async function handleDropList(
  deps: ReadDeps,
  filter: ChainFilter,
  limit: number,
): Promise<MergedList> {
  const evmKeys =
    filter.families.has("evm") && filterIncludes(filter, deps.indexerChainKey)
      ? [deps.indexerChainKey]
      : [];
  const svmKeys =
    deps.solana === undefined || !filter.families.has("svm")
      ? []
      : chains.filter((c) => c.family === "svm" && filterIncludes(filter, c.key)).map((c) => c.key);
  const keys = [...evmKeys, ...svmKeys];
  const rows =
    keys.length === 0
      ? []
      : await deps.db
          .select()
          .from(drops)
          .where(and(eq(drops.mode, "handle"), inArray(drops.chainKey, keys)))
          .orderBy(desc(drops.createdAt))
          .limit(limit);

  const evmRows = rows.filter((row) => evmKeys.includes(row.chainKey));
  // The EVM chain is in scope but no row needs the indexer: still answer 503 when it is down, as
  // this route always has, rather than an empty list that looks like the truth.
  if (evmKeys.length > 0 && evmRows.length === 0 && !(await deps.indexer.isHealthy()))
    throw new IndexerUnavailableError();
  const evm = (
    await Promise.all(
      evmRows.map(async (row) => indexedEntry(await deps.indexer.getDrop(row.address))),
    )
  ).filter((entry): entry is ListEntryLike => entry !== null);

  let solanaAvailable = deps.solana !== undefined;
  let solana: ListEntryLike[] = [];
  const svmRows = rows.filter((row) => svmKeys.includes(row.chainKey));
  if (deps.solana !== undefined && svmRows.length > 0) {
    try {
      // Every Solana row in one batched read, fresh at `confirmed`.
      solana = await deps.solana.indexedDrops(svmRows, "confirmed");
    } catch (error) {
      // The cluster is unreachable. The EVM list is still worth having; the flag says why the
      // Solana half is missing.
      console.error("solana read side unavailable", error);
      solanaAvailable = false;
    }
  }
  const merged = [...evm, ...solana]
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, limit);
  return {
    drops: merged,
    sources: {
      indexer: { available: true, chainKey: deps.indexerChainKey },
      solana: {
        configured: deps.solana !== undefined,
        available: solanaAvailable,
        chainKey: deps.solana?.chainKey ?? null,
      },
    },
  };
}

/** The indexer's `getDrop` answer as a list entry, or `null` when it does not know the drop. */
function indexedEntry(answer: unknown): ListEntryLike | null {
  if (typeof answer !== "object" || answer === null) return null;
  const drop = (answer as { drop?: unknown }).drop;
  if (typeof drop !== "object" || drop === null) return null;
  if (typeof (drop as { address?: unknown }).address !== "string") return null;
  const entry = drop as ListEntryLike;
  return { ...entry, source: entry.source ?? "indexer" };
}

export interface ChainTotal {
  readonly chainKey: string;
  readonly family: "evm" | "svm" | "tvm";
  readonly symbol: string;
  readonly decimals: number;
  /** Base units of that chain, as a decimal string. */
  readonly droppedTotal: string;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  readonly claimCount: number;
  readonly available: boolean;
  /** Usd from the prices frozen at activation, native coin only. `null` when it could not be read. */
  readonly usd: number | null;
}

/**
 * One item of the coin line under the `total dropped` tile. The api fills
 * the list, the page formats and shows it.
 */
export type DroppedItem =
  | {
      readonly kind: "coin";
      readonly symbol: string;
      readonly decimals: number;
      /** Base units, as a decimal string. */
      readonly amount: string;
    }
  | { readonly kind: "tokens"; readonly count: number };

/**
 * The list rule: one item per coin that has moved, never a zero, in the
 * order given, which is chain display order; then a token count as the last item when it is
 * above zero. Token drops do not exist yet, so every caller passes zero today; when they
 * do, `tokenDrops` is the number of token drops with a final claim.
 */
export function droppedList(
  coins: ReadonlyArray<{ symbol: string; decimals: number; amount: bigint | string }>,
  tokenDrops: number,
): DroppedItem[] {
  const items: DroppedItem[] = [];
  for (const coin of coins) {
    const amount = typeof coin.amount === "bigint" ? coin.amount : BigInt(coin.amount || "0");
    if (amount <= 0n) continue;
    items.push({
      kind: "coin",
      symbol: coin.symbol,
      decimals: coin.decimals,
      amount: amount.toString(),
    });
  }
  if (tokenDrops > 0) items.push({ kind: "tokens", count: tokenDrops });
  return items;
}

export interface MergedStats {
  readonly chain: string;
  readonly finality: "final";
  /** The EVM wei total, as this field always was. Never has lamports in it. */
  readonly droppedTotalWei: string;
  /** Unit free, summed across the chains in scope. */
  readonly dropCount: number;
  /** People: distinct X ids per chain, the chains in scope added up. */
  readonly uniqueReceivers: number;
  readonly claimCount: number;
  /** Usd summed across the chains in scope: usd adds up where coins do not. `null` if any chain could not be read. */
  readonly usd: number | null;
  readonly totals: ChainTotal[];
  /** The coin line under the tile: what moved, per coin, tokens last. */
  readonly dropped: DroppedItem[];
}

/** Which chains the tiles cover, and whether the Solana read answered. */
export interface TileScope {
  /** The indexer's chain key when the filter keeps it, else `null`. */
  readonly evmChainKey: string | null;
  /** The Solana reader's chain key when it is configured and the filter keeps it, else `null`. */
  readonly solanaChainKey: string | null;
  readonly solanaAvailable: boolean;
}

/**
 * `/api/stats`, the three front page tiles, from the same counted handle drops as the boards,
 * Never the indexer's `/stats`: that counts every drop, multisend
 * included. A drop counts only with a final claim, the boards' rule.
 */
export function tileStats(
  counted: readonly CountedDrop[],
  filter: ChainFilter,
  scope: TileScope,
): MergedStats {
  const totals: ChainTotal[] = [];
  /** Different tokens, by chain and mint, for the `dropped` line. */
  const mints = new Set<string>();
  const sides: ReadonlyArray<readonly [string | null, boolean]> = [
    [scope.evmChainKey, true],
    [scope.solanaChainKey, scope.solanaAvailable],
  ];

  for (const [chainKey, available] of sides) {
    if (chainKey === null) continue;
    const unit = unitOf(chainKey);
    const base = {
      chainKey,
      family: unit.family,
      symbol: unit.symbol,
      decimals: unit.decimals,
    };
    if (!available) {
      totals.push({
        ...base,
        droppedTotal: "0",
        dropCount: 0,
        uniqueReceivers: 0,
        claimCount: 0,
        available: false,
        usd: null,
      });
      continue;
    }
    const mine = counted.filter((drop) => drop.chainKey === chainKey);
    // token drops count as drops, payouts and people, never as a coin or usd.
    const coins = mine.filter((drop) => !isTokenDrop(drop));
    for (const drop of mine) if (isTokenDrop(drop)) mints.add(`${chainKey}#${drop.mint as string}`);
    const people = new Set(mine.flatMap((drop) => drop.people));
    const usd = coins.reduce((sum, drop) => sum + usdOf(drop.claimed, chainKey, drop.priceUsd), 0);
    totals.push({
      ...base,
      droppedTotal: coins.reduce((sum, drop) => sum + drop.claimed, 0n).toString(),
      dropCount: mine.length,
      uniqueReceivers: people.size,
      claimCount: mine.reduce((n, drop) => n + drop.claimCount, 0),
      available: true,
      // Two decimals per chain, like the boards' `byChain`, `src/boards/compute.ts`.
      usd: Math.round(usd * 100) / 100,
    });
  }

  return {
    chain: filter.key,
    finality: "final",
    droppedTotalWei: totals
      .filter((t) => t.family === "evm")
      .reduce((sum, t) => sum + BigInt(t.droppedTotal), 0n)
      .toString(),
    dropCount: totals.reduce((n, t) => n + t.dropCount, 0),
    // People are counted per chain: the chains' counts added up.
    uniqueReceivers: totals.reduce((n, t) => n + t.uniqueReceivers, 0),
    claimCount: totals.reduce((n, t) => n + t.claimCount, 0),
    // Usd adds up where coins do not. Two decimals, like the boards.
    usd: totals.some((t) => t.usd === null)
      ? null
      : Math.round(totals.reduce((sum, t) => sum + (t.usd ?? 0), 0) * 100) / 100,
    totals,
    dropped: droppedList(
      totals.map((t) => ({ symbol: t.symbol, decimals: t.decimals, amount: t.droppedTotal })),
      mints.size,
    ),
  };
}

/** The Solana cluster could not be read; `cause` says why. */
export class SolanaUnavailableError extends Error {
  constructor(cause: unknown) {
    super("solana read unavailable", { cause });
    this.name = "SolanaUnavailableError";
  }
}

/**
 * The Solana half of the board's raw material, at `finalized`. Empty when out of scope. Throws
 * `SolanaUnavailableError` when the cluster read fails.
 */
export async function solanaBoardDrops(
  deps: ReadDeps,
  filter: ChainFilter,
  since: number | null,
): Promise<BoardDrop[]> {
  if (deps.solana === undefined || !filter.families.has("svm")) return [];
  if (!filterIncludes(filter, deps.solana.chainKey)) return [];
  const rows = await solanaRows(deps, filter);
  try {
    return await deps.solana.boardDrops(rows, since);
  } catch (error) {
    throw new SolanaUnavailableError(error);
  }
}
