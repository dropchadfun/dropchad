/**
 * Deletes expired login states and sessions. An
 * expired row is useless to anyone, but every visit to a login start writes one, and before this
 * nothing deleted them. Expired means `expiresAt <= now`, the rule `readSession` uses.
 *
 * In memory timer, one api process: with more than one instance this moves to one place.
 */
import { lte } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { oauthStates, sessions } from "../db/schema.js";

/** Once an hour. A row lives at most ten minutes (a login state) or thirty days (a session). */
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function cleanupExpired(
  db: Database,
  now: Date,
): Promise<{ sessions: number; oauthStates: number }> {
  const gone = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  const states = await db
    .delete(oauthStates)
    .where(lte(oauthStates.expiresAt, now))
    .returning({ id: oauthStates.stateHash });
  return { sessions: gone.length, oauthStates: states.length };
}

/** Runs `run` at once and then every `intervalMs`. A failed run is reported, never thrown. */
export function startCleanup(args: {
  readonly run: () => Promise<unknown>;
  readonly intervalMs?: number;
  readonly onError: (error: unknown) => void;
}): { stop(): void } {
  const tick = (): void => {
    args.run().catch(args.onError);
  };
  tick();
  const timer = setInterval(tick, args.intervalMs ?? CLEANUP_INTERVAL_MS);
  // Never keeps the process alive on its own; shutdown stops it anyway.
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
