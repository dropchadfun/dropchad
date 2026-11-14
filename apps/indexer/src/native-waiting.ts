/**
 * The `native_waiting` row of `NativeReturnFailed`. A `DropV5` token drop whose `refund` or `cancelUnfunded` could not send the ETH back: the
 * refund address rejected it, so the ETH waits in the drop for `sweep(address(0))`. The same on a
 * `DropV6` drop, native or token; on a native drop it is the whole refund. One row per
 * drop; a later `Swept` of `address(0)` on that drop marks it swept. So a drop with ETH waiting
 * can be found. Round serves it: `nativeWaiting` on each drop, the
 * served `refunded` without the waiting ETH, and `GET /native-waiting` for owner alert 6.
 */
import { zeroAddress } from "viem";

export interface NativeReturnFailedEvent {
  readonly args: { readonly to: `0x${string}`; readonly amount: bigint };
  readonly log: { readonly address: `0x${string}`; readonly logIndex: number };
  readonly block: {
    readonly number: bigint;
    readonly hash: `0x${string}`;
    readonly timestamp: bigint;
  };
  readonly transaction: { readonly hash: `0x${string}` };
}

export function nativeWaitingRow(event: NativeReturnFailedEvent) {
  return {
    // One row per drop: a drop ends once, by `refund` or by `cancelUnfunded`.
    drop: event.log.address,
    to: event.args.to,
    amount: event.args.amount,
    swept: false,
    sweptTransactionHash: null,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  };
}

/** A stored `native_waiting` row, as read back. */
export interface NativeWaitingStored {
  readonly drop: `0x${string}`;
  readonly to: `0x${string}`;
  readonly amount: bigint;
  readonly swept: boolean;
  readonly sweptTransactionHash: `0x${string}` | null;
  readonly transactionHash: `0x${string}`;
}

/**
 * On a native drop whose ETH waits, `Refunded` and `CancelledUnfunded` counted
 * money that is still in the drop, so it is served minus the waiting amount. Once swept it
 * counts again: the sweep paid the same refund address. A token drop's `refunded` is tokens.
 */
export function servedRefunded(
  drop: { readonly asset: string; readonly refunded: bigint },
  waiting: NativeWaitingStored | undefined,
): bigint {
  if (waiting === undefined || waiting.swept) return drop.refunded;
  if (drop.asset.toLowerCase() !== zeroAddress) return drop.refunded;
  return drop.refunded - waiting.amount;
}

/** `nativeWaiting` on a drop: `null`, or the row. Amounts leave as decimal strings. */
export function nativeWaitingShape(waiting: NativeWaitingStored | undefined) {
  if (waiting === undefined) return null;
  return {
    to: waiting.to,
    amount: waiting.amount.toString(),
    swept: waiting.swept,
    transactionHash: waiting.transactionHash,
    sweptTransactionHash: waiting.sweptTransactionHash,
  };
}

/** `GET /native-waiting`: every row not swept, in the order given. */
export function nativeWaitingList(rows: readonly NativeWaitingStored[]) {
  return {
    rows: rows
      .filter((row) => !row.swept)
      .map((row) => ({
        drop: row.drop,
        to: row.to,
        amount: row.amount.toString(),
        transactionHash: row.transactionHash,
      })),
  };
}

/** Only a sweep of the native coin, `address(0)`, takes the waiting ETH. */
export function sweepsWaitingEth(args: { readonly token: `0x${string}` }): boolean {
  return args.token.toLowerCase() === zeroAddress;
}
