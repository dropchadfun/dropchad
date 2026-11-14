/**
 * The chain wind down. Closes the open jobs of one testnet chain,
 * so the worker stops rescheduling them once its write side is gone. An admin
 * script runs it, a dry run first. Counts and keys only, never a url.
 */
import { createServer } from "node:net";

import { findChain, type Chain } from "@dropchad/chains";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { dropJobs, drops } from "../db/schema.js";

/** The reason the closed jobs carry. */
export const WIND_DOWN_REASON = "wound down";

const OPEN_STATES = ["ready", "running"];

export class WindDownError extends Error {}

/** A testnet chain from the registry; anything else is refused. */
export function checkWindDownChain(key: string): Chain {
  const chain = findChain(key);
  if (chain === undefined) throw new WindDownError(`chain "${key}" is not in the registry.`);
  if (chain.kind !== "testnet") {
    throw new WindDownError(
      `chain "${key}" is not a testnet chain: the wind down is for testnets only.`,
    );
  }
  return chain;
}

export interface WindDownCounts {
  readonly chain: string;
  /** The drops of that chain by state. */
  readonly drops: Readonly<Record<string, number>>;
  /** The open jobs (`ready`, `running`) of that chain by kind. */
  readonly openJobs: Readonly<Record<string, number>>;
}

function tally(rows: readonly { readonly key: string; readonly count: number }[]) {
  return Object.fromEntries(
    [...rows].sort((a, b) => a.key.localeCompare(b.key)).map((row) => [row.key, row.count]),
  );
}

/** The dry run: reads only. */
export async function windDownCounts(db: Database, chainKey: string): Promise<WindDownCounts> {
  const dropRows = await db
    .select({ key: drops.state, count: sql<number>`count(*)::int` })
    .from(drops)
    .where(eq(drops.chainKey, chainKey))
    .groupBy(drops.state);
  const jobRows = await db
    .select({ key: dropJobs.kind, count: sql<number>`count(*)::int` })
    .from(dropJobs)
    .innerJoin(drops, eq(drops.address, dropJobs.dropAddress))
    .where(and(eq(drops.chainKey, chainKey), inArray(dropJobs.state, OPEN_STATES)))
    .groupBy(dropJobs.kind);
  return { chain: chainKey, drops: tally(dropRows), openJobs: tally(jobRows) };
}

/** The real run: the open jobs of that chain to `failed`, with the reason. Nothing else. */
export async function windDownChain(
  db: Database,
  chainKey: string,
  now: Date,
): Promise<{ readonly closed: number }> {
  const result = await db.execute(sql`
    UPDATE drop_jobs
    SET state = 'failed', last_error = ${WIND_DOWN_REASON}, updated_at = ${now.toISOString()}
    WHERE state IN ('ready', 'running')
      AND drop_address IN (SELECT address FROM drops WHERE chain_key = ${chainKey})
    RETURNING id
  `);
  return { closed: result.rows.length };
}

/** True while something listens on this port on this machine: the api holds the PGlite data. */
export function apiPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => {
      resolve(true);
    });
    probe.once("listening", () => {
      probe.close(() => {
        resolve(false);
      });
    });
    probe.listen(port, "127.0.0.1");
  });
}
