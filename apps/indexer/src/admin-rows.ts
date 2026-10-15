/**
 * The `admin_events` row of the two `DropFactoryV4` fee events, `MinFeePerReceiverSet` and
 * `MaxFeeAmountSet`. : every admin
 * action is public. The same shape as the `MinFeeAmountSet` row: wei as a decimal string, so no
 * amount loses precision.
 */
export interface AmountSetEvent {
  readonly args: { readonly oldAmount: bigint; readonly newAmount: bigint };
  readonly log: { readonly address: `0x${string}`; readonly logIndex: number };
  readonly block: {
    readonly number: bigint;
    readonly hash: `0x${string}`;
    readonly timestamp: bigint;
  };
  readonly transaction: { readonly hash: `0x${string}` };
}

export function amountSetRow(
  kind: "MinFeePerReceiverSet" | "MaxFeeAmountSet",
  event: AmountSetEvent,
) {
  return {
    // One id per log, as `eventId` in `src/index.ts`.
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    factory: event.log.address,
    kind,
    subject: null,
    previousValue: String(event.args.oldAmount),
    newValue: String(event.args.newAmount),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  };
}
