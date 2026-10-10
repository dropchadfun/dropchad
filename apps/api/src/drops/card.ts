/**
 * What a drop card needs from **our** side of a drop.
 *
 * six facts and one picture. The facts that are ours — the title, the meme
 * picture, the chad behind it, and how far the relayer got — come from `drops` and `profiles`.
 * The facts that are the chain's come from the indexer, and `GET /api/drops` puts the two next
 * to each other under separate keys rather than blending them.: chain
 * wins, and a reader can always see which number came from where.
 */
import type { DropRow } from "../db/schema.js";
import type { BoardProfile } from "../boards/compute.js";
import { tokenInfoOf, type TokenInfo } from "./token-info.js";

export interface OwnDropCard {
  readonly address: string;
  readonly chainId: number;
  readonly asset: string;
  /** A token drop's token; `null` on a SOL or ETH drop. */
  readonly token: TokenInfo | null;
  readonly title: string | null;
  readonly memeImageUrl: string | null;
  /** Our progress: created, funded, active, paying, finished, failed, funding_expired, claims_expired. */
  readonly state: string;
  /** `handle` counts and gets a card; `address` is a multisend. */
  readonly mode: "address" | "handle";
  readonly totalEntitlementsWei: string;
  readonly leafCount: number;
  readonly paidCount: number;
  readonly failedIndexes: readonly number[];
  readonly createTxHash: string;
  readonly activateTxHash: string | null;
  readonly lastTxHash: string | null;
  /** Unix seconds. */
  readonly fundingDeadline: string;
  readonly createdAt: string;
  /** Always `null` for a multisend: no api door names its sender. */
  readonly creator: BoardProfile | null;
}

export function ownDropCard(row: DropRow, creator: BoardProfile | null): OwnDropCard {
  return {
    address: row.address,
    chainId: row.chainId,
    asset: row.asset,
    token: tokenInfoOf(row),
    title: row.title,
    memeImageUrl: row.memeImageUrl,
    state: row.state,
    mode: row.mode,
    totalEntitlementsWei: row.totalEntitlements,
    leafCount: row.leafCount,
    paidCount: row.paidCount,
    failedIndexes: row.failedIndexes,
    createTxHash: row.createTxHash,
    activateTxHash: row.activateTxHash,
    lastTxHash: row.lastTxHash,
    fundingDeadline: row.fundingDeadline.toString(),
    createdAt: row.createdAt.toISOString(),
    creator: row.mode === "handle" ? creator : null,
  };
}
