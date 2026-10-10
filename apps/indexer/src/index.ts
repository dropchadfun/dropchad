/**
 * The indexing functions.
 *
 * events alone are enough to rebuild full drop state, so nothing here reads
 * contract storage. The single `eth_getCode` per drop is not a state read, it is the identity
 * check, and it happens once in the drop's life.
 *
 * Every write records `blockNumber`, `blockHash` and `finality: "seen"`. Promotion to `final`
 * happens in one place, the `Finality:block` handler at the bottom.
 *
 * **One function per event, both generations**. `DropV2` is `DropV1` plus
 * handle mode, and `DropFactoryV2` is `DropFactoryV1` plus `minFeeAmount`, with the
 * same events. So each function is registered for V1, and for V2 only when the registry has it,
 * `HAS_V2`: Ponder refuses a handler for a contract it was not given. The registrations are at
 * the bottom, next to each other, so a missing one shows. The same handlers
 * serve `DropFactoryV3` and `DropV3` once the registry has them, `HAS_V3`.
 * `TokenAllowed`, `NativeFeeSet`, `NativeFeePaid` and `NativeReturned` are not stored: no board
 * needs them. They serve `DropFactoryV4` and `DropV4` too once the registry has
 * them, `HAS_V4`, plus `MinFeePerReceiverSet` and `MaxFeeAmountSet`, `src/admin-rows.ts`.
 */
import { and, lte, ne } from "ponder";
import { ponder, type IndexingFunctionArgs } from "ponder:registry";
import { adminEvents, claims, dropEvents, drops } from "ponder:schema";

import {
  CONFIRMATION_DEPTH,
  FACTORIES,
  HAS_V2,
  HAS_V3,
  HAS_V4,
  RPC_URL,
} from "../ponder.config.js";
import { amountSetRow } from "./admin-rows.js";
import { claimRowFromClaimed, claimRowFromHandleClaimed } from "./claim-rows.js";
import { fetchDeployedCode } from "./code-lookup.js";
import { approvedImplementationFor } from "./factories.js";
import { verifyClone } from "./verify-clone.js";

/** Approves nothing: a factory the registry does not name fails the clone check. */
const NO_IMPLEMENTATION = "0x0000000000000000000000000000000000000000";

/** The status values, spelled out, so a database dump reads as English. */
const STATUS = {
  Created: "Created",
  Active: "Active",
  Finalized: "Finalized",
  Cancelled: "Cancelled",
} as const;

/** One id per log. A transaction hash plus a log index is unique on any chain. */
function eventId(transactionHash: string, logIndex: number): string {
  return `${transactionHash}-${logIndex}`;
}

// ---------------------------------------------------------------------------
// DropCreated — the factory announces a new clone
// ---------------------------------------------------------------------------

async function onDropCreated({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV1:DropCreated">) {
  const address = event.args.drop;

  // One lookup per drop, once, before it is allowed to count. Read at `latest`, not
  // at this block: the public testnet RPC is not an archive node, and a clone's code cannot
  // change. See src/code-lookup.ts.
  const deployedCode = await fetchDeployedCode(RPC_URL, address);
  // per factory: the emitting factory picks the implementation it may clone.
  const factory = event.log.address;
  const check = verifyClone({
    drop: address,
    factory,
    implementation: event.args.implementation,
    approvedImplementation: approvedImplementationFor(FACTORIES, factory) ?? NO_IMPLEMENTATION,
    salt: event.args.salt,
    deployedCode,
  });

  await context.db.insert(drops).values({
    address,
    chainId: context.chain.id,
    factory,

    creatorCommitment: event.args.creatorCommitment,
    asset: event.args.asset,
    merkleRoot: event.args.merkleRoot,
    manifestHash: event.args.manifestHash,
    totalEntitlements: event.args.totalEntitlements,
    feeAmount: event.args.feeAmount,
    grossRequired: event.args.grossRequired,
    feeRecipient: event.args.feeRecipient,
    refundRecipient: event.args.refundRecipient,
    fundingDeadline: BigInt(event.args.fundingDeadline),
    claimPeriod: Number(event.args.claimPeriod),
    leafCount: Number(event.args.leafCount),
    implementation: event.args.implementation,
    salt: event.args.salt,
    configHash: event.args.configHash,

    status: STATUS.Created,
    activatedAt: null,
    claimDeadline: null,
    activationBalance: null,
    feePaid: null,

    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,

    statusBlockNumber: event.block.number,

    verified: check.verified,
    verificationError: check.error,
    codeHashChecked: check.codeHashChecked,
  });
}

// ---------------------------------------------------------------------------
// Drop lifecycle
// ---------------------------------------------------------------------------

async function onActivated({ event, context }: IndexingFunctionArgs<"DropV1:Activated">) {
  const drop = event.log.address;

  await context.db.update(drops, { address: drop }).set({
    status: STATUS.Active,
    // the event carries the derived deadline, so no storage read is needed.
    activatedAt: BigInt(event.args.activatedAt),
    claimDeadline: BigInt(event.args.claimDeadline),
    activationBalance: event.args.balance,
    feePaid: event.args.feePaid,
    statusBlockNumber: event.block.number,
    statusFinality: "seen",
  });

  await context.db.insert(dropEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    drop,
    kind: "Activated",
    amount: event.args.balance,
    amount2: event.args.feePaid,
    account: null,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onClaimed({ event, context }: IndexingFunctionArgs<"DropV1:Claimed">) {
  const drop = event.log.address;

  await context.db.insert(claims).values({
    drop,
    ...claimRowFromClaimed(event.args),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });

  // The live counter. It counts `seen` claims on purpose: this is what the rain reads.
  // Anything that has to be true sums the claims table filtered to `final` instead.
  await context.db.update(drops, { address: drop }).set((row) => ({
    totalClaimed: row.totalClaimed + event.args.amount,
    claimedCount: row.claimedCount + 1,
  }));
}

/**
 * `claimHandle` emits this and **not** `Claimed`: one payout, one
 * row, with the X id. The live counters move exactly as for `Claimed`.
 */
async function onHandleClaimed({ event, context }: IndexingFunctionArgs<"DropV2:HandleClaimed">) {
  const drop = event.log.address;

  await context.db.insert(claims).values({
    drop,
    ...claimRowFromHandleClaimed(event.args),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });

  await context.db.update(drops, { address: drop }).set((row) => ({
    totalClaimed: row.totalClaimed + event.args.amount,
    claimedCount: row.claimedCount + 1,
  }));
}

async function onRefunded({ event, context }: IndexingFunctionArgs<"DropV1:Refunded">) {
  const drop = event.log.address;

  await context.db.update(drops, { address: drop }).set((row) => ({
    status: STATUS.Finalized,
    refunded: row.refunded + event.args.amount,
    statusBlockNumber: event.block.number,
    statusFinality: "seen",
  }));

  await context.db.insert(dropEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    drop,
    kind: "Refunded",
    amount: event.args.amount,
    amount2: null,
    account: event.args.refundRecipient,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onCancelledUnfunded({
  event,
  context,
}: IndexingFunctionArgs<"DropV1:CancelledUnfunded">) {
  const drop = event.log.address;

  await context.db.update(drops, { address: drop }).set((row) => ({
    status: STATUS.Cancelled,
    refunded: row.refunded + event.args.amount,
    statusBlockNumber: event.block.number,
    statusFinality: "seen",
  }));

  await context.db.insert(dropEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    drop,
    kind: "CancelledUnfunded",
    amount: event.args.amount,
    amount2: null,
    account: event.args.refundRecipient,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onFinalized({ event, context }: IndexingFunctionArgs<"DropV1:Finalized">) {
  // `Finalized` is a summary event. `Refunded` already moved the status, so this only records the
  // numbers the contract itself reports, which is what makes a wrong total debuggable.
  await context.db.insert(dropEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    drop: event.log.address,
    kind: "Finalized",
    amount: event.args.totalClaimed,
    amount2: BigInt(event.args.claimedCount),
    account: null,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onSwept({ event, context }: IndexingFunctionArgs<"DropV1:Swept">) {
  await context.db.insert(dropEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    drop: event.log.address,
    kind: "Swept",
    amount: event.args.amount,
    amount2: null,
    account: event.args.to,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

// ---------------------------------------------------------------------------
// Factory admin events
// ---------------------------------------------------------------------------

async function onPausedSet({ event, context }: IndexingFunctionArgs<"DropFactoryV1:PausedSet">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "PausedSet",
    subject: null,
    previousValue: null,
    newValue: String(event.args.paused),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onDefaultFeeBpsSet({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV1:DefaultFeeBpsSet">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "DefaultFeeBpsSet",
    subject: null,
    previousValue: String(event.args.oldBps),
    newValue: String(event.args.newBps),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onFeeRecipientSet({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV1:FeeRecipientSet">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "FeeRecipientSet",
    subject: event.args.newRecipient,
    previousValue: event.args.oldRecipient,
    newValue: event.args.newRecipient,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onTokenFactoryAllowed({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV1:TokenFactoryAllowed">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "TokenFactoryAllowed",
    subject: event.args.tokenFactory,
    previousValue: null,
    newValue: `${event.args.adapter}:${String(event.args.allowed)}`,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onCreatorAllowed({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV1:CreatorAllowed">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "CreatorAllowed",
    subject: event.args.creator,
    previousValue: null,
    newValue: String(event.args.allowed),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

async function onImplementationSet({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV1:ImplementationSet">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "ImplementationSet",
    subject: event.args.newImpl,
    previousValue: event.args.oldImpl,
    newValue: event.args.newImpl,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

/** `DropFactoryV2` only.: every admin action is public. */
async function onMinFeeAmountSet({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV2:MinFeeAmountSet">) {
  await context.db.insert(adminEvents).values({
    id: eventId(event.transaction.hash, event.log.logIndex),
    factory: event.log.address,
    kind: "MinFeeAmountSet",
    subject: null,
    previousValue: String(event.args.oldAmount),
    newValue: String(event.args.newAmount),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
}

/** `DropFactoryV4` only . */
async function onMinFeePerReceiverSet({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV4:MinFeePerReceiverSet">) {
  await context.db.insert(adminEvents).values(amountSetRow("MinFeePerReceiverSet", event));
}

/** `DropFactoryV4` only . Zero is no cap. */
async function onMaxFeeAmountSet({
  event,
  context,
}: IndexingFunctionArgs<"DropFactoryV4:MaxFeeAmountSet">) {
  await context.db.insert(adminEvents).values(amountSetRow("MaxFeeAmountSet", event));
}

// ---------------------------------------------------------------------------
// Registrations, V1 always, V2, V3 and V4 once the registry has them
// ---------------------------------------------------------------------------

ponder.on("DropFactoryV1:DropCreated", onDropCreated);
ponder.on("DropV1:Activated", onActivated);
ponder.on("DropV1:Claimed", onClaimed);
ponder.on("DropV1:Refunded", onRefunded);
ponder.on("DropV1:CancelledUnfunded", onCancelledUnfunded);
ponder.on("DropV1:Finalized", onFinalized);
ponder.on("DropV1:Swept", onSwept);
ponder.on("DropFactoryV1:PausedSet", onPausedSet);
ponder.on("DropFactoryV1:DefaultFeeBpsSet", onDefaultFeeBpsSet);
ponder.on("DropFactoryV1:FeeRecipientSet", onFeeRecipientSet);
ponder.on("DropFactoryV1:TokenFactoryAllowed", onTokenFactoryAllowed);
ponder.on("DropFactoryV1:CreatorAllowed", onCreatorAllowed);
ponder.on("DropFactoryV1:ImplementationSet", onImplementationSet);

if (HAS_V2) {
  ponder.on("DropFactoryV2:DropCreated", onDropCreated);
  ponder.on("DropV2:Activated", onActivated);
  ponder.on("DropV2:Claimed", onClaimed);
  ponder.on("DropV2:Refunded", onRefunded);
  ponder.on("DropV2:CancelledUnfunded", onCancelledUnfunded);
  ponder.on("DropV2:Finalized", onFinalized);
  ponder.on("DropV2:Swept", onSwept);
  ponder.on("DropFactoryV2:PausedSet", onPausedSet);
  ponder.on("DropFactoryV2:DefaultFeeBpsSet", onDefaultFeeBpsSet);
  ponder.on("DropFactoryV2:FeeRecipientSet", onFeeRecipientSet);
  ponder.on("DropFactoryV2:TokenFactoryAllowed", onTokenFactoryAllowed);
  ponder.on("DropFactoryV2:CreatorAllowed", onCreatorAllowed);
  ponder.on("DropFactoryV2:ImplementationSet", onImplementationSet);
  ponder.on("DropV2:HandleClaimed", onHandleClaimed);
  ponder.on("DropFactoryV2:MinFeeAmountSet", onMinFeeAmountSet);
}

if (HAS_V3) {
  ponder.on("DropFactoryV3:DropCreated", onDropCreated);
  ponder.on("DropV3:Activated", onActivated);
  ponder.on("DropV3:Claimed", onClaimed);
  ponder.on("DropV3:Refunded", onRefunded);
  ponder.on("DropV3:CancelledUnfunded", onCancelledUnfunded);
  ponder.on("DropV3:Finalized", onFinalized);
  ponder.on("DropV3:Swept", onSwept);
  ponder.on("DropFactoryV3:PausedSet", onPausedSet);
  ponder.on("DropFactoryV3:DefaultFeeBpsSet", onDefaultFeeBpsSet);
  ponder.on("DropFactoryV3:FeeRecipientSet", onFeeRecipientSet);
  ponder.on("DropFactoryV3:TokenFactoryAllowed", onTokenFactoryAllowed);
  ponder.on("DropFactoryV3:CreatorAllowed", onCreatorAllowed);
  ponder.on("DropFactoryV3:ImplementationSet", onImplementationSet);
  ponder.on("DropV3:HandleClaimed", onHandleClaimed);
  ponder.on("DropFactoryV3:MinFeeAmountSet", onMinFeeAmountSet);
}

if (HAS_V4) {
  ponder.on("DropFactoryV4:DropCreated", onDropCreated);
  ponder.on("DropV4:Activated", onActivated);
  ponder.on("DropV4:Claimed", onClaimed);
  ponder.on("DropV4:Refunded", onRefunded);
  ponder.on("DropV4:CancelledUnfunded", onCancelledUnfunded);
  ponder.on("DropV4:Finalized", onFinalized);
  ponder.on("DropV4:Swept", onSwept);
  ponder.on("DropFactoryV4:PausedSet", onPausedSet);
  ponder.on("DropFactoryV4:DefaultFeeBpsSet", onDefaultFeeBpsSet);
  ponder.on("DropFactoryV4:FeeRecipientSet", onFeeRecipientSet);
  ponder.on("DropFactoryV4:TokenFactoryAllowed", onTokenFactoryAllowed);
  ponder.on("DropFactoryV4:CreatorAllowed", onCreatorAllowed);
  ponder.on("DropFactoryV4:ImplementationSet", onImplementationSet);
  ponder.on("DropV4:HandleClaimed", onHandleClaimed);
  ponder.on("DropFactoryV4:MinFeeAmountSet", onMinFeeAmountSet);
  ponder.on("DropFactoryV4:MinFeePerReceiverSet", onMinFeePerReceiverSet);
  ponder.on("DropFactoryV4:MaxFeeAmountSet", onMaxFeeAmountSet);
}

// ---------------------------------------------------------------------------
// seen -> final
// ---------------------------------------------------------------------------

/**
 * Promote everything that is now deep enough to be called `final`.
 *
 * One direction only.: `seen` rows that vanish in a reorg are removed by Ponder's own
 * rollback, and a `final` row is never rolled back — which holds because nothing is promoted
 * until it is `CONFIRMATION_DEPTH` blocks behind the head, past the window a reorg can touch.
 *
 * The depth default is 64 and ** decides the real number**. See `ponder.config.ts`.
 */
ponder.on("Finality:block", async ({ event, context }) => {
  const head = event.block.number;
  if (head < BigInt(CONFIRMATION_DEPTH)) return;
  const cutoff = head - BigInt(CONFIRMATION_DEPTH);

  await context.db.sql
    .update(drops)
    .set({ finality: "final" })
    .where(and(lte(drops.blockNumber, cutoff), ne(drops.finality, "final")));

  await context.db.sql
    .update(drops)
    .set({ statusFinality: "final" })
    .where(and(lte(drops.statusBlockNumber, cutoff), ne(drops.statusFinality, "final")));

  await context.db.sql
    .update(claims)
    .set({ finality: "final" })
    .where(and(lte(claims.blockNumber, cutoff), ne(claims.finality, "final")));

  await context.db.sql
    .update(dropEvents)
    .set({ finality: "final" })
    .where(and(lte(dropEvents.blockNumber, cutoff), ne(dropEvents.finality, "final")));

  await context.db.sql
    .update(adminEvents)
    .set({ finality: "final" })
    .where(and(lte(adminEvents.blockNumber, cutoff), ne(adminEvents.finality, "final")));
});
