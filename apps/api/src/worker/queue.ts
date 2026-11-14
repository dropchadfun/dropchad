/**
 * The job queue: a table, a claim, a backoff.
 *
 * **Why a table and not pg-boss.** pg-boss speaks the Postgres wire protocol and uses advisory
 * locks and `LISTEN/NOTIFY`. PGlite has no wire server, so pg-boss would force Docker Postgres
 * into local dev today, against the decision already recorded. This is four
 * queries of plain SQL that run unchanged on a server Postgres later, exactly like the migrations.
 *
 * **It survives a restart**, which is the requirement. Everything is rows: which drop, which
 * step, how many attempts, and when to try again. A process that dies mid job leaves the row in
 * `running`, and `releaseStuckJobs` on startup puts those back to `ready`. Nothing is held in
 * memory between ticks.
 *
 * `claimNextJob` uses `FOR UPDATE SKIP LOCKED`, which is the right query for a second worker even
 * though there is only one today. It costs nothing now and it is the line that would otherwise be
 * forgotten.
 */
import { sql } from "drizzle-orm";

import { canonicalAddress } from "../chain/address.js";
import type { Database } from "../db/client.js";
import type { DropJobRow } from "../db/schema.js";

/**
 * The steps a drop goes through after it is created. `settle` is the fourth, Solana only: after
 * the deadline the relayer refunds or cancels, then closes.
 */
export type JobKind = "watch_funding" | "activate" | "pay" | "settle" | "claim_handles";

/**
 * Attempts before a job is given up on.
 *
 * `watch_funding` never counts an attempt for "not funded yet" — that is the normal case, not a
 * failure — so this only ever counts real errors.
 */
export const MAX_ATTEMPTS = 10;

/** Backoff for a failed attempt: 5s, 10s, 20s, ... capped at five minutes. */
export function backoffSeconds(attempts: number): number {
  return Math.min(5 * 2 ** Math.max(0, attempts - 1), 300);
}

/** Add a job, or leave the existing one alone. One job of a kind per drop. */
export async function enqueueJob(
  db: Database,
  args: { dropAddress: string; kind: JobKind; runAfter: Date },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO drop_jobs (drop_address, kind, state, run_after)
    VALUES (${canonicalAddress(args.dropAddress)}, ${args.kind}, 'ready', ${args.runAfter.toISOString()})
    ON CONFLICT (drop_address, kind) DO NOTHING
  `);
}

/**
 * Bring a waiting job forward to now. A bind calls this so its claim goes out on the next poll,
 * not at the job's fallback time. A running or finished job is left alone.
 */
export async function wakeJob(
  db: Database,
  args: { dropAddress: string; kind: JobKind; now: Date },
): Promise<void> {
  await db.execute(sql`
    UPDATE drop_jobs
    SET run_after = ${args.now.toISOString()}, updated_at = ${args.now.toISOString()}
    WHERE drop_address = ${canonicalAddress(args.dropAddress)}
      AND kind = ${args.kind}
      AND state = 'ready'
      AND run_after > ${args.now.toISOString()}
  `);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function when(value: unknown): Date {
  // The driver hands back a Date for `timestamptz`, but a string is a valid answer too.
  return value instanceof Date ? value : new Date(typeof value === "string" ? value : 0);
}

/**
 * Turn a raw row into a `DropJobRow`.
 *
 * `db.execute(sql...)` returns the driver's own rows: **snake_case column names**, and whatever
 * types the driver decided on. Drizzle's camelCase mapping only happens in the query builder, and
 * the statements here cannot go through it because of `FOR UPDATE SKIP LOCKED`. Mapping by hand is
 * the price of that, and doing it in one place is the way to pay it once.
 */
function toJobRow(raw: Record<string, unknown>): DropJobRow {
  return {
    id: Number(raw["id"]),
    dropAddress: text(raw["drop_address"]),
    kind: text(raw["kind"]),
    state: text(raw["state"]),
    runAfter: when(raw["run_after"]),
    attempts: Number(raw["attempts"]),
    lastError: typeof raw["last_error"] === "string" ? raw["last_error"] : null,
    createdAt: when(raw["created_at"]),
    updatedAt: when(raw["updated_at"]),
  };
}

/**
 * Take the next job that is due, and mark it `running` in the same statement.
 *
 * One statement matters: a read then a write would let two workers take the same row.
 */
export async function claimNextJob(db: Database, now: Date): Promise<DropJobRow | null> {
  const result = await db.execute(sql`
    UPDATE drop_jobs SET state = 'running', updated_at = ${now.toISOString()}
    WHERE id = (
      SELECT id FROM drop_jobs
      WHERE state = 'ready' AND run_after <= ${now.toISOString()}
      ORDER BY run_after, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const raw = result.rows[0];
  return raw === undefined ? null : toJobRow(raw);
}

/** The job is done and will never run again. */
export async function completeJob(db: Database, id: number, now: Date): Promise<void> {
  await db.execute(sql`
    UPDATE drop_jobs SET state = 'done', last_error = NULL, updated_at = ${now.toISOString()}
    WHERE id = ${id}
  `);
}

/**
 * Put the job back on the queue for later.
 *
 * `countAttempt` is false for "nothing to do yet", which is what a funding watcher sees on almost
 * every tick. Counting those would retire the watcher long before the seven day funding deadline.
 */
export async function rescheduleJob(
  db: Database,
  args: { id: number; runAfter: Date; now: Date; countAttempt: boolean; error?: string | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE drop_jobs
    SET state = 'ready',
        run_after = ${args.runAfter.toISOString()},
        attempts = attempts + ${args.countAttempt ? 1 : 0},
        last_error = ${args.error ?? null},
        updated_at = ${args.now.toISOString()}
    WHERE id = ${args.id}
  `);
}

/** Out of attempts. The row stays, so the failure is visible and can be requeued by hand. */
export async function failJob(
  db: Database,
  args: { id: number; error: string; now: Date },
): Promise<void> {
  await db.execute(sql`
    UPDATE drop_jobs
    SET state = 'failed', last_error = ${args.error}, updated_at = ${args.now.toISOString()}
    WHERE id = ${args.id}
  `);
}

/**
 * Put every `running` job back to `ready`. Called once on startup.
 *
 * A job is only `running` while a worker holds it, so after a restart every such row belongs to a
 * process that no longer exists. Retrying is safe: each step re-reads the chain before it acts, so
 * a step that already completed simply finds its work done.
 */
export async function releaseStuckJobs(db: Database, now: Date): Promise<number> {
  const result = await db.execute(sql`
    UPDATE drop_jobs
    SET state = 'ready', run_after = ${now.toISOString()}, updated_at = ${now.toISOString()}
    WHERE state = 'running'
    RETURNING id
  `);
  return result.rows.length;
}
