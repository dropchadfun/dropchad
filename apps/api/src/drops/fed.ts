/**
 * Who got fed, by handle.: the drop page names each paid leaf of a
 * handle drop by X `@handle` and picture, never by the address the money landed on.
 *
 * Paid is the chain's word: the caller passes the indexes the chain says are
 * claimed, and only those are looked up, so a receiver who has not claimed is never named. The
 * name comes from the leaf's X id in `drop_handle_leaves`, then `x_users`, the same rows the
 * share card reads, `src/drops/share.ts`.
 */
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { dropHandleLeaves, xUsers } from "../db/schema.js";

export interface FedPerson {
  readonly index: number;
  readonly handle: string;
  /** The stored X url as it is, the `_normal` size, or `null`. */
  readonly profileImageUrl: string | null;
}

/** The paid leaves of one handle drop with a known X account, by leaf index. */
export async function fedFor(
  db: Database,
  dropAddress: string,
  paidIndexes: readonly number[],
): Promise<FedPerson[]> {
  const indexes = [...new Set(paidIndexes)];
  if (indexes.length === 0) return [];
  const leaves = await db
    .select()
    .from(dropHandleLeaves)
    .where(
      and(
        eq(dropHandleLeaves.dropAddress, dropAddress),
        inArray(dropHandleLeaves.leafIndex, indexes),
      ),
    );
  if (leaves.length === 0) return [];
  const ids = [...new Set(leaves.map((leaf) => leaf.xUserId))];
  const known = await db.select().from(xUsers).where(inArray(xUsers.xUserId, ids));
  const byId = new Map(known.map((user) => [user.xUserId, user]));

  const out: FedPerson[] = [];
  for (const leaf of [...leaves].sort((a, b) => a.leafIndex - b.leafIndex)) {
    const user = byId.get(leaf.xUserId);
    if (user === undefined) continue;
    out.push({ index: leaf.leafIndex, handle: user.handle, profileImageUrl: user.profileImageUrl });
  }
  return out;
}

/** One paid leaf, for the live stream's `claim_paid`. `null` when no X account is known. */
export async function fedOne(
  db: Database,
  dropAddress: string,
  index: number,
): Promise<{ handle: string; profileImageUrl: string | null } | null> {
  const [person] = await fedFor(db, dropAddress, [index]);
  return person === undefined
    ? null
    : { handle: person.handle, profileImageUrl: person.profileImageUrl };
}

/** The claimed indexes in a chain side answer, `{ claims: [{ index }] }`. Anything else is none. */
export function paidIndexesOf(chainData: unknown): number[] {
  if (chainData === null || typeof chainData !== "object") return [];
  const claims = (chainData as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) return [];
  return claims.flatMap((claim: unknown) => {
    const index = (claim as { index?: unknown } | null)?.index;
    return typeof index === "number" && Number.isInteger(index) && index >= 0 ? [index] : [];
  });
}
