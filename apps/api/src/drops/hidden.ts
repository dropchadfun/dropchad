/**
 * Handle drops that never went live. One rule for every list and door.
 *
 * Never live: our state is `funding_expired`, or still `created` after the funding deadline. A
 * `funded` drop past its deadline is not one yet: the check reads the chain first. Without
 * a row of ours, the indexer's `Cancelled`, or `Created` past its deadline. The row stays; the
 * worker still settles it.
 */
import { and, gte, or, sql, type SQL } from "drizzle-orm";

import { drops, type DropRow } from "../db/schema.js";

/** SQL for "this row went live or still may": the lists keep only these rows. */
export function mayBeLive(nowSeconds: number): SQL {
  return and(
    sql`${drops.state} <> 'funding_expired'`,
    or(sql`${drops.state} <> 'created'`, gte(drops.fundingDeadline, BigInt(nowSeconds))),
  ) as SQL;
}

/** SQL for the boards and the board reads, which need no clock: never a `funding_expired` row. */
export const notFundingExpired: SQL = sql`${drops.state} <> 'funding_expired'`;

/** Our row never went live and never will. */
export function isNeverLive(
  row: Pick<DropRow, "state" | "fundingDeadline">,
  nowSeconds: number,
): boolean {
  if (row.state === "funding_expired") return true;
  return row.state === "created" && row.fundingDeadline < BigInt(nowSeconds);
}

/** The indexer's side of one drop, as far as this rule reads it. */
interface IndexedSide {
  readonly status?: unknown;
  readonly fundingDeadline?: unknown;
  readonly refunded?: unknown;
}

function sideOf(indexed: unknown): IndexedSide | null {
  if (typeof indexed !== "object" || indexed === null) return null;
  const drop = (indexed as { drop?: unknown }).drop;
  return typeof drop === "object" && drop !== null ? drop : null;
}

/** The indexer says this drop never went live: `Cancelled`, or `Created` past its deadline. */
export function chainNeverLive(indexed: unknown, nowSeconds: number): boolean {
  const side = sideOf(indexed);
  if (side === null) return false;
  if (side.status === "Cancelled") return true;
  if (side.status !== "Created") return false;
  const deadline = Number(side.fundingDeadline);
  return Number.isFinite(deadline) && nowSeconds > deadline;
}

/** The indexer saw the cancel return some of the drop asset. */
export function chainRefundedSome(indexed: unknown): boolean {
  const side = sideOf(indexed);
  if (side === null || side.status !== "Cancelled") return false;
  const refunded = side.refunded;
  if (typeof refunded !== "string" && typeof refunded !== "number") return false;
  try {
    return BigInt(refunded) > 0n;
  } catch {
    return false;
  }
}
