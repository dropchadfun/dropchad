/**
 * One `claims` row per payout, of either kind.
 * `claimHandle` emits `HandleClaimed` and **not** `Claimed`, so one payout is one row and nothing
 * is counted twice. A handle row keeps the X id; an address row has none.
 */
export interface ClaimRowFields {
  /** The merkle index, and the bitmap bit. */
  readonly index: number;
  /** Where the money went. Never the caller. */
  readonly recipient: `0x${string}`;
  readonly amount: bigint;
  readonly kind: "address" | "handle";
  /** The numeric X id of a handle leaf. `null` on an address leaf. */
  readonly xId: bigint | null;
}

export function claimRowFromClaimed(args: {
  readonly index: bigint;
  readonly recipient: `0x${string}`;
  readonly amount: bigint;
}): ClaimRowFields {
  return {
    index: Number(args.index),
    recipient: args.recipient,
    amount: args.amount,
    kind: "address",
    xId: null,
  };
}

export function claimRowFromHandleClaimed(args: {
  readonly index: bigint;
  readonly xId: bigint;
  readonly recipient: `0x${string}`;
  readonly amount: bigint;
}): ClaimRowFields {
  return {
    index: Number(args.index),
    recipient: args.recipient,
    amount: args.amount,
    kind: "handle",
    xId: args.xId,
  };
}
