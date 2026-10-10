/**
 * The indexed tables.
 *
 * Every row carries `blockNumber`, `blockHash` and a `finality` of `seen` or `final`, which is
 * The two states mean what the design says:
 *
 * - `seen`  the sequencer produced the block. It can still disappear in a reorg. Good enough for
 *           the live rain and the live counter, and nothing else.
 * - `final` past the confirmation depth. This is the only data a meme card or the leaderboard is
 *           ever allowed to read.
 *
 * Amounts are `bigint`, stored as `NUMERIC(78,0)`, which holds a full `uint256` without loss.
 *
 * A note on the drop row. It carries two finality fields, not one, because two different things
 * happen at two different times:
 *
 * - `finality`       the drop **exists**. Set from the `DropCreated` block.
 * - `statusFinality` the drop's **current status** is settled. Set from the block of the last
 *                    `Activated` / `Finalized` / `CancelledUnfunded`.
 *
 * A drop created an hour ago and activated one second ago is `final` and `seen` at the same time,
 * and both are true. Rolling them into one field would either hide a fresh state change or make
 * an old drop look provisional forever.
 *
 * `totalClaimed` and `claimedCount` on the drop row count **every** claim, including `seen` ones,
 * because that is what the live counter wants. Anything that has to be true — cards, the board,
 * `/api/stats` — sums the `claims` table filtered to `finality = 'final'` instead.
 */
import { index, onchainTable, onchainView, primaryKey, sql } from "ponder";

/** `seen` or `final`. Stored as text so a database dump reads as English. */
const FINALITY_SEEN = "seen";

export const drops = onchainTable(
  "drops",
  (t) => ({
    /** The clone address. One row per drop, for its whole life. */
    address: t.hex().primaryKey(),
    chainId: t.integer().notNull(),
    /**
     * The factory that emitted `DropCreated`. It decides which implementation
     * the clone check approves: `DropFactoryV1` with `DropV1`, `DropFactoryV2` with `DropV2`.
     */
    factory: t.hex().notNull(),

    // --- config, every field from `DropCreated`. Immutable ---
    /** Binds the drop to one X identity. No privacy. */
    creatorCommitment: t.hex().notNull(),
    /** `0x00...0` means native ETH, otherwise the one ERC20. */
    asset: t.hex().notNull(),
    merkleRoot: t.hex().notNull(),
    manifestHash: t.hex().notNull(),
    totalEntitlements: t.bigint().notNull(),
    feeAmount: t.bigint().notNull(),
    grossRequired: t.bigint().notNull(),
    feeRecipient: t.hex().notNull(),
    refundRecipient: t.hex().notNull(),
    fundingDeadline: t.bigint().notNull(),
    claimPeriod: t.integer().notNull(),
    leafCount: t.integer().notNull(),
    implementation: t.hex().notNull(),
    salt: t.hex().notNull(),
    configHash: t.hex().notNull(),

    // --- lifecycle ---
    /** `Created`, `Active`, `Finalized` or `Cancelled`. */
    status: t.text().notNull(),
    activatedAt: t.bigint(),
    /** Derived once at activation. Null while the drop is still `Created`. */
    claimDeadline: t.bigint(),
    activationBalance: t.bigint(),
    feePaid: t.bigint(),

    // --- accounting, from the events. Includes `seen` rows: this drives the live counter ---
    totalClaimed: t.bigint().notNull().default(0n),
    claimedCount: t.integer().notNull().default(0),
    refunded: t.bigint().notNull().default(0n),

    // --- where the drop was created ---
    blockNumber: t.bigint().notNull(),
    blockHash: t.hex().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    finality: t.text().notNull().default(FINALITY_SEEN),

    // --- where the status last changed ---
    statusBlockNumber: t.bigint().notNull(),
    statusFinality: t.text().notNull().default(FINALITY_SEEN),

    /**
     * **.** True when the clone address and its deployed code both check out:
     * the address is `CREATE2(factory, salt, keccak(eip1167(implementation)))`, the
     * implementation is the one the registry approves, and the deployed code hash equals the
     * expected clone hash.
     *
     * A drop with `false` here is stored, so the failure is visible, and **never counted**.
     */
    verified: t.boolean().notNull().default(false),
    /** Why verification failed, or null when it passed. Kept so a failure can be investigated. */
    verificationError: t.text(),
    /**
     * Whether the deployed code hash check actually ran. False means the RPC could not serve
     * `eth_getCode` and only the implementation and CREATE2 address checks decided `verified`.
     * A non archive RPC is the usual reason.
     */
    codeHashChecked: t.boolean().notNull().default(false),
  }),
  (table) => ({
    statusIdx: index().on(table.status),
    finalityIdx: index().on(table.finality),
    creatorIdx: index().on(table.creatorCommitment),
    createdAtIdx: index().on(table.timestamp),
  }),
);

export const claims = onchainTable(
  "claims",
  (t) => ({
    drop: t.hex().notNull(),
    /** The merkle index, and the bitmap bit. */
    index: t.integer().notNull(),
    /** The address in the leaf. Funds always go here, never to the caller. */
    recipient: t.hex().notNull(),
    amount: t.bigint().notNull(),
    /** `address` from `Claimed`, `handle` from `HandleClaimed`. One row per payout. */
    kind: t.text().notNull().default("address"),
    /** The numeric X id of a handle leaf. Null on an address leaf. */
    xId: t.bigint(),

    blockNumber: t.bigint().notNull(),
    blockHash: t.hex().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    finality: t.text().notNull().default(FINALITY_SEEN),
  }),
  (table) => ({
    // One leaf can be claimed once. The primary key says so in the database too.
    pk: primaryKey({ columns: [table.drop, table.index] }),
    recipientIdx: index().on(table.recipient),
    finalityIdx: index().on(table.finality),
    dropIdx: index().on(table.drop),
  }),
);

/**
 * Everything that happened to a drop besides a claim: `Activated`, `Refunded`,
 * `CancelledUnfunded`, `Finalized`, `Swept`.
 *
 * The drop row already carries the resulting state. This table is the ordered history behind it,
 * which is what the replay page needs and what makes a wrong `status` debuggable.
 */
export const dropEvents = onchainTable(
  "drop_events",
  (t) => ({
    id: t.text().primaryKey(),
    drop: t.hex().notNull(),
    kind: t.text().notNull(),
    /** Meaning depends on `kind`: the balance at activation, the amount refunded, and so on. */
    amount: t.bigint(),
    /** `feePaid` for `Activated`, `claimedCount` for `Finalized`. Null elsewhere. */
    amount2: t.bigint(),
    account: t.hex(),

    blockNumber: t.bigint().notNull(),
    blockHash: t.hex().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    finality: t.text().notNull().default(FINALITY_SEEN),
  }),
  (table) => ({
    dropIdx: index().on(table.drop),
    finalityIdx: index().on(table.finality),
  }),
);

/**
 * Factory admin events.
 *
 * every admin action is an event and is shown publicly. Indexing them is
 * what makes that possible.
 */
export const adminEvents = onchainTable(
  "admin_events",
  (t) => ({
    id: t.text().primaryKey(),
    /** The factory that emitted it: V1 and V2 share this table. */
    factory: t.hex().notNull(),
    kind: t.text().notNull(),
    /** The address the action was about: a creator, a token factory, an implementation. */
    subject: t.hex(),
    /** The previous value, where the event carries one. */
    previousValue: t.text(),
    /** The new value. */
    newValue: t.text(),

    blockNumber: t.bigint().notNull(),
    blockHash: t.hex().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    finality: t.text().notNull().default(FINALITY_SEEN),
  }),
  (table) => ({
    kindIdx: index().on(table.kind),
  }),
);

/**
 * The drop status view.
 *
 * One row per drop with the config, the current status, the live counters **and** the final only
 * totals side by side. It exists so that no caller has to remember: the `final` columns are
 * the ones a card or a board may use, and they are named so that picking the wrong one is a
 * visible mistake rather than a silent one.
 */
export const dropStatus = onchainView("drop_status").as((qb) =>
  qb
    .select({
      address: drops.address,
      chainId: drops.chainId,
      status: drops.status,
      asset: drops.asset,
      creatorCommitment: drops.creatorCommitment,
      merkleRoot: drops.merkleRoot,
      totalEntitlements: drops.totalEntitlements,
      leafCount: drops.leafCount,
      fundingDeadline: drops.fundingDeadline,
      claimDeadline: drops.claimDeadline,
      refundRecipient: drops.refundRecipient,
      verified: drops.verified,
      timestamp: drops.timestamp,
      blockNumber: drops.blockNumber,
      finality: drops.finality,
      statusFinality: drops.statusFinality,

      /** Every claim, `seen` included. The live counter. Never a card. */
      claimedSeen: drops.totalClaimed,
      claimedCountSeen: drops.claimedCount,

      /** `final` claims only. This is what a card and the leaderboard may read. */
      claimedFinal:
        sql<bigint>`coalesce((select sum(${claims.amount}) from ${claims} where ${claims.drop} = ${drops.address} and ${claims.finality} = 'final'), 0)`.as(
          "claimed_final",
        ),
      claimedCountFinal:
        sql<number>`(select count(*)::int from ${claims} where ${claims.drop} = ${drops.address} and ${claims.finality} = 'final')`.as(
          "claimed_count_final",
        ),
    })
    .from(drops),
);
