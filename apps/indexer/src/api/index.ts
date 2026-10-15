/**
 * The indexer's read endpoints.
 *
 * These live here, not in `apps/api`, for one reason: **PGlite is single process**. The indexer
 * owns the database file, so a second process cannot open it. `apps/api` forwards `/api/drops`,
 * `/api/drops/:address` and `/api/stats` to this server and shapes the response.
 *
 * When the server moves to a real Postgres, `apps/api` queries it directly and this forwarding
 * disappears. That is why the shapes below are already the shapes the public api returns.
 *
 * Two rules decide what is served:
 *
 * - a number that claims to be true comes from `final` rows only. `/stats` sums claims
 *   filtered to `finality = 'final'`, and says so in its response.
 * - a drop that failed the clone check is stored but never counted. `verified` is on every
 *   drop row and `/stats` ignores unverified drops.
 *
 * Amounts are `bigint`, and JSON has no bigint, so every amount leaves here as a decimal string.
 */
import { and, count, countDistinct, desc, eq, gte, inArray, sum } from "ponder";
import { db } from "ponder:api";
import { claims, dropEvents, drops } from "ponder:schema";
import { Hono } from "hono";

import { boardDropsFrom } from "../board-drops.js";

const app = new Hono();

const FINAL = "final";

/** JSON has no bigint. One conversion, at the edge, and nowhere else. */
function amount(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function dropShape(row: typeof drops.$inferSelect) {
  return {
    address: row.address,
    chainId: row.chainId,
    status: row.status,
    asset: row.asset,
    creatorCommitment: row.creatorCommitment,
    merkleRoot: row.merkleRoot,
    manifestHash: row.manifestHash,
    totalEntitlements: amount(row.totalEntitlements),
    grossRequired: amount(row.grossRequired),
    feeAmount: amount(row.feeAmount),
    feeRecipient: row.feeRecipient,
    refundRecipient: row.refundRecipient,
    leafCount: row.leafCount,
    fundingDeadline: amount(row.fundingDeadline),
    claimPeriod: row.claimPeriod,
    activatedAt: amount(row.activatedAt),
    claimDeadline: amount(row.claimDeadline),
    activationBalance: amount(row.activationBalance),
    feePaid: amount(row.feePaid),

    // Live counters. Every claim, `seen` included. Never render a card from these.
    totalClaimed: amount(row.totalClaimed),
    claimedCount: row.claimedCount,
    refunded: amount(row.refunded),

    // False means the clone check failed and the drop counts nowhere.
    verified: row.verified,
    verificationError: row.verificationError,
    codeHashChecked: row.codeHashChecked,

    createdAt: amount(row.timestamp),
    blockNumber: amount(row.blockNumber),
    blockHash: row.blockHash,
    transactionHash: row.transactionHash,
    finality: row.finality,
    statusFinality: row.statusFinality,
  };
}

/** `GET /drops` — newest first. */
app.get("/drops", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const rows = await db.select().from(drops).orderBy(desc(drops.blockNumber)).limit(limit);
  return c.json({ drops: rows.map(dropShape) });
});

/** `GET /drops/:address` — one drop, with its claims and its history. */
app.get("/drops/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();

  const rows = await db
    .select()
    .from(drops)
    .where(eq(drops.address, address as `0x${string}`))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return c.json({ error: "not_found" }, 404);

  const claimRows = await db
    .select()
    .from(claims)
    .where(eq(claims.drop, row.address))
    .orderBy(claims.index);

  const eventRows = await db
    .select()
    .from(dropEvents)
    .where(eq(dropEvents.drop, row.address))
    .orderBy(dropEvents.blockNumber);

  return c.json({
    drop: dropShape(row),
    claims: claimRows.map((claim) => ({
      index: claim.index,
      recipient: claim.recipient,
      amount: amount(claim.amount),
      // `handle` from `HandleClaimed`, with the X id; `address` otherwise.
      kind: claim.kind,
      xId: amount(claim.xId),
      blockNumber: amount(claim.blockNumber),
      blockHash: claim.blockHash,
      transactionHash: claim.transactionHash,
      timestamp: amount(claim.timestamp),
      finality: claim.finality,
    })),
    events: eventRows.map((entry) => ({
      kind: entry.kind,
      amount: amount(entry.amount),
      amount2: amount(entry.amount2),
      account: entry.account,
      blockNumber: amount(entry.blockNumber),
      transactionHash: entry.transactionHash,
      timestamp: amount(entry.timestamp),
      finality: entry.finality,
    })),
  });
});

/**
 * `GET /stats` — dropped total in wei, drop count, unique receivers.
 *
 * **Final rows only, and verified drops only.** No prices: this is wei, not USD.
 */
app.get("/stats", async (c) => {
  const claimTotals = await db
    .select({
      dropped: sum(claims.amount),
      receivers: countDistinct(claims.recipient),
      claimCount: count(),
    })
    .from(claims)
    .innerJoin(drops, eq(drops.address, claims.drop))
    .where(and(eq(claims.finality, FINAL), eq(drops.verified, true)));

  const dropCounts = await db
    .select({ dropCount: count() })
    .from(drops)
    .where(and(eq(drops.finality, FINAL), eq(drops.verified, true)));

  const totals = claimTotals[0];
  const counts = dropCounts[0];

  return c.json({
    // Wei. No prices yet, so no USD anywhere in this shape.
    droppedTotalWei: totals?.dropped ?? "0",
    dropCount: counts?.dropCount ?? 0,
    uniqueReceivers: totals?.receivers ?? 0,
    claimCount: totals?.claimCount ?? 0,
    // Said out loud, so a caller cannot mistake this for live data.
    finality: FINAL,
  });
});

/**
 * `GET /board-drops?since=<unix seconds>` — the raw material for the top chads board.
 *
 * One row per **final, verified** drop, with the sum of its **final** claims, the distinct
 * addresses those claims paid, and `claimedIndexes`, their merkle indexes, both kinds, ascending,
 * twice over: nothing `seen` reaches a board. `src/board-drops.ts`.
 *
 * This is deliberately not the board. The indexer only knows a drop's `creatorCommitment`, which
 * is `keccak256(xUserId, nonce)` and unique per drop, so grouping here would give one row per
 * drop. `apps/api` owns the table that maps a commitment back to an X id, and it does the grouping.
 *
 * `since` bounds the window by the drop's creation time. Absent means all time.
 */
app.get("/board-drops", async (c) => {
  const sinceRaw = c.req.query("since");
  const since = sinceRaw === undefined ? null : BigInt(sinceRaw);
  if (since !== null && since < 0n) return c.json({ error: "invalid_query" }, 400);

  const dropRows = await db
    .select({
      address: drops.address,
      creatorCommitment: drops.creatorCommitment,
      timestamp: drops.timestamp,
    })
    .from(drops)
    .where(
      since === null
        ? and(eq(drops.finality, FINAL), eq(drops.verified, true))
        : and(eq(drops.finality, FINAL), eq(drops.verified, true), gte(drops.timestamp, since)),
    )
    .orderBy(desc(drops.timestamp));

  if (dropRows.length === 0) return c.json({ drops: [], finality: FINAL });

  const claimRows = await db
    .select({
      drop: claims.drop,
      index: claims.index,
      recipient: claims.recipient,
      amount: claims.amount,
      finality: claims.finality,
    })
    .from(claims)
    .where(
      and(
        eq(claims.finality, FINAL),
        inArray(
          claims.drop,
          dropRows.map((row) => row.address),
        ),
      ),
    );

  return c.json({ drops: boardDropsFrom(dropRows, claimRows), finality: FINAL });
});

// No `/health` route here: Ponder reserves that path and serves it itself. `apps/api` uses it as
// the forwarder's liveness check.

export default app;
