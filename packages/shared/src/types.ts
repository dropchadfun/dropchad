/**
 * Domain types shared by `apps/api`, `apps/indexer` and later `apps/web`.
 *
 * Amounts are `bigint` here, because that is what they are. JSON has no bigint, so every HTTP
 * boundary serialises them to **decimal strings**. That conversion happens once, at the edge, and
 * nowhere else.
 *
 * Field meanings come from the design sections 4, 5 and 11. The design wins over this file.
 */
import type { Address, Hex } from "viem";

export type { Manifest, ManifestEntry } from "./merkle/manifest.js";

/**
 * The on chain state machine. The numbers are the `uint8` values in storage.
 * `Finalized` and `Cancelled` are terminal.
 */
export const DROP_STATUS = {
  Created: 0,
  Active: 1,
  Finalized: 2,
  Cancelled: 3,
} as const;

export type DropStatusValue = (typeof DROP_STATUS)[keyof typeof DROP_STATUS];
export type DropStatus = keyof typeof DROP_STATUS;

/**
 * How much we trust a row.
 *
 * - `seen`  — in a block the sequencer produced. Soft finality, can disappear in a reorg.
 *             Drives the live rain and the live counter only.
 * - `final` — past the confirmation depth. Drives meme cards and the leaderboard.
 *
 * a number on a card or a board is only ever computed from `final` rows.
 */
export type Finality = "seen" | "final";

/** Where a row came from on chain. Every indexed row carries this. */
export interface ChainPosition {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly logIndex: number;
  readonly timestamp: bigint;
  readonly finality: Finality;
}

/**
 * A drop, rebuilt from events alone.: reading storage is an optimisation, never a
 * requirement, so nothing in this shape needs an `eth_call`.
 */
export interface Drop extends ChainPosition {
  readonly address: Address;

  // --- config, all from `DropCreated`. Immutable from creation ---
  /** `address(0)` means native ETH, otherwise the one ERC20. */
  readonly asset: Address;
  readonly merkleRoot: Hex;
  readonly manifestHash: Hex;
  readonly totalEntitlements: bigint;
  readonly feeAmount: bigint;
  readonly grossRequired: bigint;
  readonly feeRecipient: Address;
  readonly refundRecipient: Address;
  readonly fundingDeadline: bigint;
  readonly claimPeriod: number;
  readonly leafCount: number;
  readonly implementation: Address;
  readonly salt: Hex;
  readonly configHash: Hex;
  /** Binds the drop to one X identity. No privacy, it is a small public number. */
  readonly creatorCommitment: Hex;

  // --- lifecycle ---
  readonly status: DropStatus;
  /** `Activated.activatedAt`. `null` while the drop is still `Created`. */
  readonly activatedAt: bigint | null;
  /** `Activated.claimDeadline`, derived once at activation. `null` before that. */
  readonly claimDeadline: bigint | null;
  readonly activationBalance: bigint | null;
  readonly feePaid: bigint | null;

  // --- accounting, summed from `Claimed` and the refund events ---
  readonly totalClaimed: bigint;
  readonly claimedCount: number;
  readonly refunded: bigint;

  /**
   * The clone's deployed code hash matched the expected EIP 1167 clone of an
   * approved implementation. A drop with `false` here never counts anywhere.
   */
  readonly codeHashOk: boolean;
}

/** One `Claimed` event. The funds always go to the address in the leaf, never to the caller. */
export interface Claim extends ChainPosition {
  readonly drop: Address;
  /** The merkle index, and the bitmap bit. */
  readonly index: number;
  readonly recipient: Address;
  readonly amount: bigint;
}

/**
 * A signed in X user.
 *
 * The identity is `xUserId`, the **numeric** X id. Handles change and can be recycled, so the
 * handle is display only and is refreshed on every login.
 */
export interface Profile {
  /** Numeric X user id, as a string because it does not fit a JS number. */
  readonly xUserId: string;
  /** `@handle` without the `@`. Display only. */
  readonly handle: string;
  readonly displayName: string;
  readonly profileImageUrl: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Totals for the front page.: computed from `final` rows only. */
export interface Stats {
  readonly chainId: number;
  /** Wei. No prices yet, so no USD anywhere in this shape. */
  readonly droppedTotal: bigint;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  readonly finality: Finality;
}
