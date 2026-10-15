/**
 * The Solana read side. No indexer, no key: the chain is read directly.
 *
 * There is no Solana indexer yet, so the api reads our own drops from
 * the cluster instead of building one. The rule that makes that honest is the commitment level:
 *
 * - `confirmed` for the list and the drop page, the same job `seen` does on the EVM side
 * - `finalized` for the stats and the board. A finalized slot is never rolled back, so
 *   `finality: "final"` on those routes stays true without a confirmation depth to argue about
 *
 * Every account is decoded with the owner and discriminator checks of `accounts.ts`, and
 * only addresses from our own `drops` table are ever asked about: a `Drop` we did not create is
 * not on our board however big it is, the same rule as the EVM commitment join.
 *
 * Reads are batched a hundred at a time with `getMultipleAccounts` and cached for a short while
 * per commitment, because `/api/stats` and `/api/boards` are public and a page load must not be
 * a hundred RPC calls. The cache is in memory, per process, and says so.
 */
import { bytesToHex } from "viem";

import type { DropRow } from "../../db/schema.js";
import type { BoardDrop } from "../../indexer/client.js";
import {
  SVM_STATUS_ACTIVE,
  SVM_STATUS_CANCELLED,
  SVM_STATUS_CREATED,
  SVM_STATUS_FINALIZED,
  decodeClaimBitmap,
  decodeDrop,
  isClaimedBit,
  type DropAccount,
} from "./accounts.js";
import { bitmapPda } from "./pda.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "./pubkey.js";
import type { Commitment, SvmRpc } from "./rpc.js";

const BATCH = 100;

export type SvmStatusName = "Created" | "Active" | "Finalized" | "Cancelled";

export function statusName(status: number): SvmStatusName {
  switch (status) {
    case SVM_STATUS_CREATED:
      return "Created";
    case SVM_STATUS_ACTIVE:
      return "Active";
    case SVM_STATUS_FINALIZED:
      return "Finalized";
    case SVM_STATUS_CANCELLED:
      return "Cancelled";
    default:
      throw new Error(`unknown drop status ${String(status)}`);
  }
}

/**
 * One Solana drop in the shape the indexer gives an EVM one, `apps/indexer/src/api/index.ts`
 * `dropShape`, so the frontend's card code reads both with one function. Where Solana has no
 * equivalent the field is `null` and says so; where it has more, `closed`, it is added.
 */
export interface SvmIndexedDrop {
  readonly address: string;
  readonly chainId: number;
  readonly chainKey: string;
  readonly family: "svm";
  readonly source: "rpc";
  readonly status: SvmStatusName;
  readonly asset: string;
  readonly creatorCommitment: string;
  readonly merkleRoot: string;
  readonly manifestHash: string;
  readonly totalEntitlements: string;
  readonly grossRequired: string;
  readonly feeAmount: string;
  readonly feeRecipient: string;
  readonly refundRecipient: string;
  readonly leafCount: number;
  readonly fundingDeadline: string;
  readonly claimPeriod: number;
  readonly activatedAt: string | null;
  readonly claimDeadline: string | null;
  readonly totalClaimed: string;
  readonly claimedCount: number;
  readonly closed: boolean;
  /** Owner and discriminator checked. Always true for an account that decoded at all. */
  readonly verified: true;
  /** Unix seconds, the cluster clock at creation. */
  readonly createdAt: string;
  readonly transactionHash: string;
  readonly finality: "seen" | "final";
  readonly statusFinality: "seen" | "final";
}

export interface SvmClaim {
  readonly index: number;
  /**
   * The address in the leaf. `null` on a handle leaf: its manifest names an X id, and the
   * payout address is chosen at claim time.
   */
  readonly recipient: string | null;
  readonly amount: string;
  /** The bitmap says paid; which transaction paid it is not in the account. */
  readonly transactionHash: null;
  readonly finality: "seen" | "final";
}

export interface SvmReaderOptions {
  readonly rpc: SvmRpc;
  readonly chainKey: string;
  readonly chainId: number;
  readonly now?: () => Date;
  /** How long a `finalized` read is reused. Zero disables the cache; the tests use that. */
  readonly cacheMs?: number;
}

export interface SvmReader {
  readonly chainKey: string;
  readonly chainId: number;
  /** Decoded accounts by base58 address, `null` where there is none. */
  drops(
    addresses: readonly string[],
    commitment: Commitment,
  ): Promise<Map<string, DropAccount | null>>;
  bitmap(address: string, commitment: Commitment): Promise<Uint8Array | null>;
  /** The chain's view of one of our rows, or `null` when the account is not there at that commitment. */
  indexedDrop(row: DropRow, commitment: Commitment): Promise<SvmIndexedDrop | null>;
  /**
   * The same for many rows in batched reads: one call per 100,
   * never one per drop. A row whose account is not there is left out.
   */
  indexedDrops(rows: readonly DropRow[], commitment: Commitment): Promise<SvmIndexedDrop[]>;
  /** Which leaves the bitmap says are paid, with recipient and amount from our manifest. */
  claims(row: DropRow, commitment: Commitment): Promise<SvmClaim[]>;
  /**
   * Final rows in the indexer's board shape, for the boards and the front page tiles, with
   * `claimedIndexes` from the bitmap. `src/boards/load.ts` decides what counts.
   */
  boardDrops(rows: readonly DropRow[], since: number | null): Promise<BoardDrop[]>;
}

/** An entry of either manifest: version 1 names a `recipient`, version 2 an `xId`. */
interface ManifestEntryLite {
  readonly index: number;
  readonly recipient?: string;
  readonly amount: string;
}

function entriesOf(row: DropRow): ManifestEntryLite[] {
  return (JSON.parse(row.manifestJson) as { entries: ManifestEntryLite[] }).entries;
}

function finalityOf(commitment: Commitment): "seen" | "final" {
  return commitment === "finalized" ? "final" : "seen";
}

export function createSvmReader(options: SvmReaderOptions): SvmReader {
  const { rpc, chainKey, chainId } = options;
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? 30_000;

  interface Cached<T> {
    readonly at: number;
    readonly value: T;
  }
  const accountCache = new Map<string, Cached<DropAccount | null>>();
  const bitmapCache = new Map<string, Cached<Uint8Array | null>>();

  const fresh = <T>(entry: Cached<T> | undefined): entry is Cached<T> =>
    entry !== undefined && cacheMs > 0 && now().getTime() - entry.at < cacheMs;

  async function drops(
    addresses: readonly string[],
    commitment: Commitment,
  ): Promise<Map<string, DropAccount | null>> {
    const out = new Map<string, DropAccount | null>();
    const misses: string[] = [];
    for (const address of addresses) {
      // Only finalized reads are cached: a `confirmed` read is asked for because it must be fresh.
      const hit = commitment === "finalized" ? accountCache.get(address) : undefined;
      if (fresh(hit)) out.set(address, hit.value);
      else misses.push(address);
    }
    for (let i = 0; i < misses.length; i += BATCH) {
      const chunk = misses.slice(i, i + BATCH);
      const infos = await rpc.getMultipleAccounts(chunk.map(pubkeyFromBase58), commitment);
      chunk.forEach((address, j) => {
        const info = infos[j] ?? null;
        const account = info === null ? null : decodeDrop(info);
        out.set(address, account);
        if (commitment === "finalized")
          accountCache.set(address, { at: now().getTime(), value: account });
      });
    }
    return out;
  }

  async function bitmap(address: string, commitment: Commitment): Promise<Uint8Array | null> {
    const hit = commitment === "finalized" ? bitmapCache.get(address) : undefined;
    if (fresh(hit)) return hit.value;
    const info = await rpc.getAccountInfo(bitmapPda(pubkeyFromBase58(address)).address, commitment);
    const bits = info === null ? null : decodeClaimBitmap(info).bits;
    if (commitment === "finalized") bitmapCache.set(address, { at: now().getTime(), value: bits });
    return bits;
  }

  /**
   * Many bitmaps in `getMultipleAccounts` batches, never one call per drop
   * Cached the same way as `bitmap`.
   */
  async function bitmaps(
    addresses: readonly string[],
    commitment: Commitment,
  ): Promise<Map<string, Uint8Array | null>> {
    const out = new Map<string, Uint8Array | null>();
    const misses: string[] = [];
    for (const address of addresses) {
      const hit = commitment === "finalized" ? bitmapCache.get(address) : undefined;
      if (fresh(hit)) out.set(address, hit.value);
      else misses.push(address);
    }
    for (let i = 0; i < misses.length; i += BATCH) {
      const chunk = misses.slice(i, i + BATCH);
      const infos = await rpc.getMultipleAccounts(
        chunk.map((address) => bitmapPda(pubkeyFromBase58(address)).address),
        commitment,
      );
      chunk.forEach((address, j) => {
        const info = infos[j] ?? null;
        const bits = info === null ? null : decodeClaimBitmap(info).bits;
        out.set(address, bits);
        if (commitment === "finalized")
          bitmapCache.set(address, { at: now().getTime(), value: bits });
      });
    }
    return out;
  }

  function shape(row: DropRow, account: DropAccount, commitment: Commitment): SvmIndexedDrop {
    const finality = finalityOf(commitment);
    return {
      address: row.address,
      chainId,
      chainKey,
      family: "svm",
      source: "rpc",
      status: statusName(account.status),
      asset: pubkeyToBase58(account.asset),
      creatorCommitment: bytesToHex(account.creatorCommitment),
      merkleRoot: bytesToHex(account.merkleRoot),
      manifestHash: bytesToHex(account.manifestHash),
      totalEntitlements: account.totalEntitlements.toString(),
      grossRequired: account.grossRequired.toString(),
      feeAmount: account.feeAmount.toString(),
      feeRecipient: pubkeyToBase58(account.feeWallet),
      refundRecipient: pubkeyToBase58(account.refundRecipient),
      leafCount: account.leafCount,
      fundingDeadline: account.fundingDeadline.toString(),
      claimPeriod: account.claimPeriod,
      activatedAt: account.activatedAt === 0n ? null : account.activatedAt.toString(),
      claimDeadline: account.claimDeadline === 0n ? null : account.claimDeadline.toString(),
      totalClaimed: account.totalClaimed.toString(),
      claimedCount: account.claimedCount,
      closed: account.closed,
      verified: true,
      createdAt: account.createdAt.toString(),
      transactionHash: row.createTxHash,
      finality,
      statusFinality: finality,
    };
  }

  /** The paid entries of one drop, from its bitmap, or the settle job's copy once it is closed. */
  function paidEntries(
    row: DropRow,
    account: DropAccount,
    bits: Uint8Array | null,
  ): ManifestEntryLite[] {
    const entries = entriesOf(row);
    if (bits !== null) return entries.filter((entry) => isClaimedBit(bits, entry.index));
    // A closed drop has no bitmap any more. Its `claimed_count` still says how many were
    // paid, but not which; the first `claimed_count` entries are not an honest answer. Handle
    // the settle job's copy on our row says which, and it counts only when it
    // agrees with `claimed_count`, which the `Drop` keeps. A wrong number is worse
    // than none.
    const copy = row.claimedIndexes;
    if (copy === null) return [];
    if (copy.length !== account.claimedCount) {
      console.warn(
        `claimed copy of ${row.address} has ${String(copy.length)} indexes, the drop says ${String(account.claimedCount)}; counting none`,
      );
      return [];
    }
    const claimed = new Set(copy);
    return entries.filter((entry) => claimed.has(entry.index));
  }

  return {
    chainKey,
    chainId,
    drops,
    bitmap,

    async indexedDrop(row, commitment) {
      const account = (await drops([row.address], commitment)).get(row.address) ?? null;
      return account === null ? null : shape(row, account, commitment);
    },

    async indexedDrops(rows, commitment) {
      const accounts = await drops(
        rows.map((row) => row.address),
        commitment,
      );
      return rows.flatMap((row) => {
        const account = accounts.get(row.address) ?? null;
        return account === null ? [] : [shape(row, account, commitment)];
      });
    },

    async claims(row, commitment) {
      const account = (await drops([row.address], commitment)).get(row.address) ?? null;
      if (account === null) return [];
      const paid = paidEntries(row, account, await bitmap(row.address, commitment));
      return paid.map((entry) => ({
        index: entry.index,
        recipient: entry.recipient ?? null,
        amount: entry.amount,
        transactionHash: null,
        finality: finalityOf(commitment),
      }));
    },

    async boardDrops(rows, since) {
      const accounts = await drops(
        rows.map((row) => row.address),
        "finalized",
      );
      const kept = rows.flatMap((row) => {
        const account = accounts.get(row.address) ?? null;
        if (account === null) return [];
        if (since !== null && Number(account.createdAt) < since) return [];
        return [{ row, account }];
      });
      // Every bitmap in one batched read: a board is two calls, whatever the drops.
      const bitsOf = await bitmaps(
        kept.map(({ row }) => row.address),
        "finalized",
      );
      const out: BoardDrop[] = [];
      for (const { row, account } of kept) {
        const paid = paidEntries(row, account, bitsOf.get(row.address) ?? null);
        out.push({
          address: row.address,
          chainKey,
          creatorCommitment: bytesToHex(account.creatorCommitment),
          createdAt: account.createdAt.toString(),
          claimedFinalWei: account.totalClaimed.toString(),
          claimedCountFinal: account.claimedCount,
          recipients: paid.flatMap((entry) =>
            entry.recipient === undefined ? [] : [entry.recipient],
          ),
          claimedIndexes: paid.map((entry) => entry.index),
        });
      }
      return out;
    },
  };
}
