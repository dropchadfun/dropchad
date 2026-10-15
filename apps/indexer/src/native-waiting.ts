/**
 * The `native_waiting` row of `NativeReturnFailed`. A `DropV5` token drop whose `refund` or `cancelUnfunded` could not send the ETH back: the
 * refund address rejected it, so the ETH waits in the drop for `sweep(address(0))`. One row per
 * drop; a later `Swept` of `address(0)` on that drop marks it swept. So a drop with ETH waiting
 * can be found. No board, page or api route reads it yet.
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

/** Only a sweep of the native coin, `address(0)`, takes the waiting ETH. */
export function sweepsWaitingEth(args: { readonly token: `0x${string}` }): boolean {
  return args.token.toLowerCase() === zeroAddress;
}
