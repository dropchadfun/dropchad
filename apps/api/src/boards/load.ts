/**
 * The reads behind the board: indexed final drops in, chad totals out.
 *
 * Shared by `GET /api/boards`, `GET /api/users/:handle` and `GET /api/stats`, so the number on a
 * profile page and on a front page tile is the same number that ranks the chad on the board.
 * Two code paths would drift.
 *
 * **Only handle drops count**. The chain
 * rows come in, `countHandleDrops` keeps the ones that are our handle drops with a final claim,
 * and reads the X id behind every claimed leaf from `drop_handle_leaves`. The claimed leaves come
 * from the chain only: the indexer's `claimedIndexes` on the EVM, the bitmap on Solana. Never
 * from `handle_bindings`, which is what our api meant to happen, not what the chain says did.
 */
import { chains } from "@dropchad/chains";
import { and, desc, eq, inArray } from "drizzle-orm";
import { zeroAddress } from "viem";

import { canonicalAddress } from "../chain/address.js";
import { DEFAULT_PUBKEY_BASE58 } from "../chain/svm/pubkey.js";
import { filterIncludes, type ChainFilter } from "../chain/filter.js";
import type { SvmReader } from "../chain/svm/reader.js";
import { dropHandleLeaves, drops, profiles, type DropRow } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { Config } from "../config.js";
import { loadStreams } from "../auth/stream-links.js";
import type { BoardDrop, IndexerClient } from "../indexer/client.js";
import { solanaBoardDrops } from "../drops/read.js";
import { tokenInfoOf } from "../drops/token-info.js";
import {
  boardProfile,
  totalsByChad,
  DAY_SECONDS,
  WEEK_SECONDS,
  type AssetScope,
  type BoardProfile,
  type BoardRange,
  type ChadTotals,
  type CountedDrop,
  type ProfileStream,
} from "./compute.js";

export interface BoardSource {
  readonly db: Database;
  readonly indexer: IndexerClient;
  /** The chain the indexer follows, `CHAIN_KEY`. */
  readonly indexerChainKey: string;
  readonly solana?: SvmReader | undefined;
  readonly now: () => Date;
  /** Which Kick and Twitch links are on. Absent: the rows carry no `streams`. */
  readonly config?: Config | undefined;
}

/**
 * The indexer's final rows, each with its chain key. Empty when the filter leaves the indexer's
 * chain out. Throws `IndexerUnavailableError` when the indexer is down and in scope.
 */
export async function evmBoardRows(
  source: BoardSource,
  filter: ChainFilter,
  since: number | null,
): Promise<BoardDrop[]> {
  if (!filter.families.has("evm") || !filterIncludes(filter, source.indexerChainKey)) return [];
  const indexed = await source.indexer.listBoardDrops(since);
  // The stub and the window are both honest on their own; the filter here makes the api the
  // one that decides the window, whatever a future indexer does with `since`.
  return indexed.drops
    .filter((drop) => since === null || Number(drop.createdAt) >= since)
    .map((drop) => ({ ...drop, chainKey: drop.chainKey ?? source.indexerChainKey }));
}

/**
 * Chain rows in, the handle drops that count out.
 *
 * A row counts when our `drops` table has a drop **at that address with that commitment**, its
 * mode is `handle`, and the chain names at least one claimed leaf. A multisend counts nowhere,
 * An EVM handle drop without `claimedIndexes` counts zero: that is the indexer before
 */
export async function countHandleDrops(
  db: Database,
  rows: readonly BoardDrop[],
  indexerChainKey: string,
): Promise<CountedDrop[]> {
  if (rows.length === 0) return [];

  const commitments = [...new Set(rows.map((drop) => drop.creatorCommitment.toLowerCase()))];
  const ours = await db
    .select({
      address: drops.address,
      creatorCommitment: drops.creatorCommitment,
      xUserId: drops.xUserId,
      priceUsd: drops.priceUsd,
      mode: drops.mode,
      asset: drops.asset,
      chainKey: drops.chainKey,
      tokenProgram: drops.tokenProgram,
      tokenDecimals: drops.tokenDecimals,
      tokenName: drops.tokenName,
      tokenSymbol: drops.tokenSymbol,
      tokenLaunchpad: drops.tokenLaunchpad,
    })
    .from(drops)
    .where(inArray(drops.creatorCommitment, commitments));
  // By address, never by commitment alone: before 21b a commitment was the same 32 bytes on every
  // chain, so two drops can share one; the mode and the price belong to exactly one drop.
  // Blinded or not, the stored commitment is the one we sent, so it matches the chain's.
  const ourByAddress = new Map(ours.map((row) => [canonicalAddress(row.address), row] as const));

  const handle = rows.flatMap((drop) => {
    const row = ourByAddress.get(canonicalAddress(drop.address));
    if (row === undefined) return [];
    if (row.creatorCommitment.toLowerCase() !== drop.creatorCommitment.toLowerCase()) return [];
    if (row.mode !== "handle") return [];
    const indexes = drop.claimedIndexes ?? [];
    if (indexes.length === 0) return [];
    return [{ drop, row, indexes }];
  });
  if (handle.length === 0) return [];

  const leafRows = await db
    .select({
      dropAddress: dropHandleLeaves.dropAddress,
      leafIndex: dropHandleLeaves.leafIndex,
      xUserId: dropHandleLeaves.xUserId,
    })
    .from(dropHandleLeaves)
    .where(
      inArray(
        dropHandleLeaves.dropAddress,
        handle.map(({ row }) => row.address),
      ),
    );
  const xIdOf = new Map(
    leafRows.map(
      (leaf) =>
        [`${canonicalAddress(leaf.dropAddress)}#${String(leaf.leafIndex)}`, leaf.xUserId] as const,
    ),
  );

  return handle.map(({ drop, row, indexes }) => {
    const address = canonicalAddress(drop.address);
    const people = new Set<string>();
    for (const index of indexes) {
      const xId = xIdOf.get(`${address}#${String(index)}`);
      if (xId !== undefined) people.add(xId);
    }
    return {
      address,
      chainKey: drop.chainKey ?? indexerChainKey,
      xUserId: row.xUserId,
      createdAt: Number(drop.createdAt),
      claimed: BigInt(drop.claimedFinalWei),
      claimCount: indexes.length,
      people: [...people],
      priceUsd: row.priceUsd === null ? null : Number(row.priceUsd),
      mint: isNativeAsset(row.asset) ? null : row.asset,
      // The top token on a `best token` row.
      token: isNativeAsset(row.asset) ? null : tokenInfoOf(row),
    };
  });
}

/** The two ways a row names the chain's own coin: the EVM zero address, the Solana default key. */
function isNativeAsset(asset: string): boolean {
  return asset === DEFAULT_PUBKEY_BASE58 || asset.toLowerCase() === zeroAddress;
}

/**
 * The chain rows in scope, the EVM half from the indexer and the Solana half at `finalized`.
 * Throws `IndexerUnavailableError` or `SolanaUnavailableError` like the board itself.
 */
export async function loadBoardRows(
  source: BoardSource,
  filter: ChainFilter,
  since: number | null,
): Promise<BoardDrop[]> {
  return [
    ...(await evmBoardRows(source, filter, since)),
    ...(await solanaBoardDrops(
      {
        db: source.db,
        indexer: source.indexer,
        solana: source.solana,
        indexerChainKey: source.indexerChainKey,
      },
      filter,
      since,
    )),
  ];
}

/**
 * Throws `IndexerUnavailableError` when the indexer is down and in scope. The routes decide what
 * that means. The Solana half is read at `finalized`; a cluster that is down surfaces as an
 * error the same way, because a board with half its chains missing is not a board.
 */
export async function loadChadTotals(
  source: BoardSource,
  range: BoardRange,
  filter: ChainFilter,
  /** Which drops count: `native` for `best dropchad`, `token` for `best token`. */
  assets: AssetScope = "all",
  /** Chain rows already read for `range` and `filter`, so a profile reads the chains once. */
  preloaded?: readonly BoardDrop[],
): Promise<ChadTotals[]> {
  const nowSeconds = Math.floor(source.now().getTime() / 1000);
  // The window is on the drop's creation time, never the claim time.
  const since =
    range === "day"
      ? nowSeconds - DAY_SECONDS
      : range === "week"
        ? nowSeconds - WEEK_SECONDS
        : null;

  const rows = preloaded ?? (await loadBoardRows(source, filter, since));
  const counted = await countHandleDrops(source.db, rows, source.indexerChainKey);
  if (counted.length === 0) return [];

  const xUserIds = [...new Set(counted.map((drop) => drop.xUserId))];
  const profileRows = await source.db
    .select({
      xUserId: profiles.xUserId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      profileImageUrl: profiles.profileImageUrl,
      kind: profiles.kind,
      tags: profiles.tags,
      tagSetAt: profiles.tagSetAt,
    })
    .from(profiles)
    .where(inArray(profiles.xUserId, xUserIds));

  // The linked channels ride on every board row.
  const streams =
    source.config === undefined
      ? new Map<string, ProfileStream[]>()
      : await loadStreams(
          source.db,
          source.config,
          profileRows.map((row) => row.xUserId),
        );
  const profilesById = new Map(
    profileRows.map((row) => [row.xUserId, boardProfile(row, streams.get(row.xUserId))] as const),
  );

  return totalsByChad(counted, profilesById, {
    filter,
    evmChainKeys: new Set(chains.filter((c) => c.family === "evm").map((c) => c.key)),
    assets,
  });
}

/** One paid handle leaf of one X id. */
export interface ReceivedDrop {
  readonly drop: DropRow;
  /** The leaf's amount, base units, a decimal string. */
  readonly amount: string;
  readonly sender: BoardProfile;
}

/**
 * What one X id received: its leaves on our handle drops, newest drop first, kept only
 * when the chain rows name that leaf claimed. The same match as `countHandleDrops`: the address
 * and the commitment. Never `handle_bindings`, never a multisend. A drop whose sender has no
 * profile is left out, like on the board.
 */
export async function loadReceived(
  source: BoardSource,
  rows: readonly BoardDrop[],
  xUserId: string,
  limit: number,
): Promise<ReceivedDrop[]> {
  if (rows.length === 0) return [];
  const paidOf = new Map(
    rows.map(
      (row) =>
        [
          canonicalAddress(row.address),
          {
            commitment: row.creatorCommitment.toLowerCase(),
            indexes: new Set(row.claimedIndexes ?? []),
          },
        ] as const,
    ),
  );

  const leaves = await source.db
    .select({ drop: drops, leafIndex: dropHandleLeaves.leafIndex, amount: dropHandleLeaves.amount })
    .from(dropHandleLeaves)
    .innerJoin(drops, eq(drops.address, dropHandleLeaves.dropAddress))
    .where(and(eq(dropHandleLeaves.xUserId, xUserId), eq(drops.mode, "handle")))
    .orderBy(desc(drops.createdAt));
  const paid = leaves.filter(({ drop, leafIndex }) => {
    const chain = paidOf.get(canonicalAddress(drop.address));
    if (chain === undefined) return false;
    if (chain.commitment !== drop.creatorCommitment.toLowerCase()) return false;
    return chain.indexes.has(leafIndex);
  });
  if (paid.length === 0) return [];

  const senderIds = [...new Set(paid.map(({ drop }) => drop.xUserId))];
  const senderRows = await source.db
    .select({
      xUserId: profiles.xUserId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      profileImageUrl: profiles.profileImageUrl,
      kind: profiles.kind,
      tags: profiles.tags,
      tagSetAt: profiles.tagSetAt,
    })
    .from(profiles)
    .where(inArray(profiles.xUserId, senderIds));
  const streams =
    source.config === undefined
      ? new Map<string, ProfileStream[]>()
      : await loadStreams(source.db, source.config, senderIds);
  const senders = new Map(
    senderRows.map((row) => [row.xUserId, boardProfile(row, streams.get(row.xUserId))] as const),
  );

  return paid
    .flatMap(({ drop, amount }) => {
      const sender = senders.get(drop.xUserId);
      return sender === undefined ? [] : [{ drop, amount, sender }];
    })
    .slice(0, limit);
}
