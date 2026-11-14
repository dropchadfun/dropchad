/**
 * The relayer's daily gas budget, kept in the database.
 *
 * **Why it is charged before the send, not after.** If we only counted what receipts reported, a
 * burst of sends could all pass the check before any of them settled, and the day's cap would be
 * a suggestion. So a send is charged its worst case cost first — gas limit times the maximum fee
 * per gas — and the charge is corrected down to the real cost once the receipt arrives. The
 * budget therefore leads reality and can never lag behind it.
 *
 * **Why the database and not memory.** A restart must not hand the relayer a fresh allowance. The
 * row is keyed by UTC day and chain id, so a day rolls over on its own with no cleanup job.
 */
import { and, eq } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { relayerSpend } from "../db/schema.js";
import { GasBudgetExceededError, type GasBudget } from "./relayer.js";

export interface DbGasBudgetOptions {
  readonly db: Database;
  readonly chainId: number;
  /** Base units per UTC day: `RELAYER_DAILY_GAS_BUDGET_WEI`, or the lamport budget on Solana. */
  readonly dailyLimitWei: bigint;
  readonly now: () => Date;
  /** For the error message only. `wei` unless told otherwise. */
  readonly unit?: string;
}

/** `YYYY-MM-DD` in UTC. The day boundary is UTC everywhere, so it never moves with a server. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The handle drizzle hands to a `transaction` callback.
 *
 * Every query below takes it, and none of them touches the outer `db`. That is not style:
 * **PGlite is a single connection**, so a query sent on the base handle while a transaction is
 * open on it waits for a transaction that is itself waiting for the query. The whole process
 * stops. Found by these tests hanging.
 */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDbGasBudget(options: DbGasBudgetOptions): GasBudget {
  const { db, chainId, dailyLimitWei } = options;

  async function readSpent(tx: Tx, day: string): Promise<bigint> {
    const rows = await tx
      .select({ weiSpent: relayerSpend.weiSpent })
      .from(relayerSpend)
      .where(and(eq(relayerSpend.day, day), eq(relayerSpend.chainId, chainId)))
      .limit(1);
    // NUMERIC comes back as a decimal string. One conversion, here.
    return BigInt(rows[0]?.weiSpent ?? "0");
  }

  async function write(tx: Tx, day: string, weiSpent: bigint, at: Date): Promise<void> {
    await tx
      .insert(relayerSpend)
      .values({ day, chainId, weiSpent: weiSpent.toString(), updatedAt: at })
      .onConflictDoUpdate({
        target: [relayerSpend.day, relayerSpend.chainId],
        set: { weiSpent: weiSpent.toString(), updatedAt: at },
      });
  }

  return {
    async reserve(weiMax) {
      const at = options.now();
      const day = utcDay(at);
      await db.transaction(async (tx) => {
        const spent = await readSpent(tx, day);
        const after = spent + weiMax;
        if (after > dailyLimitWei) {
          throw new GasBudgetExceededError(after, dailyLimitWei, options.unit ?? "wei");
        }
        await write(tx, day, after, at);
      });
    },

    async settle(reservedWei, actualWei) {
      const at = options.now();
      const day = utcDay(at);
      await db.transaction(async (tx) => {
        const spent = await readSpent(tx, day);
        // The reservation was the ceiling, so this is almost always a refund. Never below zero:
        // a settle that crosses a UTC midnight would otherwise take the new day negative.
        const corrected = spent - reservedWei + actualWei;
        await write(tx, day, corrected < 0n ? 0n : corrected, at);
      });
    },
  };
}
