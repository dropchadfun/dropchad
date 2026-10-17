/**
 * A drop left `created` after its funding deadline with no open job. Before
 * this, a `watch_funding` job that failed for good left the drop `created` for ever, FUNDING on
 * the site with `fund it by` in the past. The worker now checks once
 * at start and every hour, and does what the funding poll does at the deadline.
 */
import { and, eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { createDropEventBus, type DropEvent } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles } from "../src/db/schema.js";
import { adaptersFor, createFakeChain, FAKE_CHAIN_ID } from "./fake-chain.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0001");
const OTHER = getAddress("0x00000000000000000000000000000000000d0002");
const AMOUNT = 100_000_000_000_000n;
const FUNDING_DEADLINE = 1_800_000_000n;
const AFTER_DEADLINE = new Date((Number(FUNDING_DEADLINE) + 1) * 1000);
const HOUR_MS = 60 * 60 * 1000;

let handle: DatabaseHandle;
let seen: DropEvent[];
let worker: Worker;
let clock: Date;

async function seedDrop(
  address: Address,
  options: { state?: string; job?: { kind: string; state: string } | null } = {},
): Promise<void> {
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null })
    .onConflictDoNothing();
  await handle.db.insert(drops).values({
    address: address.toLowerCase(),
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: JSON.stringify({ version: 1, entries: [] }),
    totalEntitlements: AMOUNT.toString(),
    feeAmount: "0",
    grossRequired: AMOUNT.toString(),
    leafCount: 1,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: FUNDING_DEADLINE,
    claimPeriod: 2_592_000,
    state: options.state ?? "created",
    createTxHash: `0x${"55".repeat(32)}`,
  });
  // The usual case on the server: the watcher gave up after its last attempt.
  const job = options.job === undefined ? { kind: "watch_funding", state: "failed" } : options.job;
  if (job !== null) {
    await handle.db.insert(dropJobs).values({
      dropAddress: address.toLowerCase(),
      kind: job.kind,
      state: job.state,
      runAfter: new Date("2026-10-06T00:00:00.000Z"),
    });
  }
}

async function dropRow(address: Address) {
  const rows = await handle.db.select().from(drops).where(eq(drops.address, address.toLowerCase()));
  return rows[0];
}

async function jobRow(address: Address, kind: string) {
  const rows = await handle.db
    .select()
    .from(dropJobs)
    .where(and(eq(dropJobs.dropAddress, address.toLowerCase()), eq(dropJobs.kind, kind)));
  return rows[0];
}

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  const events = createDropEventBus();
  seen = [];
  clock = AFTER_DEADLINE;
  worker = createWorker({
    db: handle.db,
    chains: adaptersFor(createFakeChain()),
    events,
    now: () => clock,
    pollMs: 5_000,
  });
  events.subscribe(DROP, (event) => seen.push(event));
  return () => handle.close();
});

describe("expireWaiting", () => {
  it("moves a created drop past its deadline with no open job to funding_expired and queues settle", async () => {
    await seedDrop(DROP);

    expect(await worker.expireWaiting()).toBe(1);

    const row = await dropRow(DROP);
    expect(row?.state).toBe("funding_expired");
    expect(row?.lastError).toBe("nobody funded this drop before the funding deadline");
    expect(seen[0]).toMatchObject({
      type: "finished",
      state: "funding_expired",
      paidCount: 0,
      leafCount: 1,
      failedIndexes: [],
    });
    expect((await jobRow(DROP, "settle"))?.state).toBe("ready");
  });

  it("works the same for a drop with no job at all", async () => {
    await seedDrop(DROP, { job: null });
    expect(await worker.expireWaiting()).toBe(1);
    expect((await dropRow(DROP))?.state).toBe("funding_expired");
    expect((await jobRow(DROP, "settle"))?.state).toBe("ready");
  });

  it("leaves a drop alone while its watcher is still open: the funding poll handles it", async () => {
    await seedDrop(DROP, { job: { kind: "watch_funding", state: "ready" } });
    await seedDrop(OTHER, { job: { kind: "watch_funding", state: "running" } });

    expect(await worker.expireWaiting()).toBe(0);
    expect((await dropRow(DROP))?.state).toBe("created");
    expect((await dropRow(OTHER))?.state).toBe("created");
    expect(seen).toHaveLength(0);
  });

  it("leaves a drop alone until its deadline has passed, and at the deadline itself", async () => {
    await seedDrop(DROP);
    clock = new Date(Number(FUNDING_DEADLINE) * 1000);

    expect(await worker.expireWaiting()).toBe(0);
    expect((await dropRow(DROP))?.state).toBe("created");
  });

  it("leaves a drop in any other state alone", async () => {
    await seedDrop(DROP, { state: "funded", job: { kind: "activate", state: "failed" } });
    await seedDrop(OTHER, { state: "funding_expired", job: { kind: "settle", state: "done" } });

    expect(await worker.expireWaiting()).toBe(0);
    expect((await dropRow(DROP))?.state).toBe("funded");
    expect((await jobRow(OTHER, "settle"))?.state).toBe("done");
  });

  it("keeps a settle job that already exists as it is", async () => {
    await seedDrop(DROP, { job: { kind: "settle", state: "done" } });

    expect(await worker.expireWaiting()).toBe(1);
    expect((await dropRow(DROP))?.state).toBe("funding_expired");
    expect((await jobRow(DROP, "settle"))?.state).toBe("done");
  });
});

describe("the check in the worker turn", () => {
  it("runs in the first turn, not again within the hour, and again after an hour", async () => {
    await seedDrop(DROP);
    await worker.turn();
    expect((await dropRow(DROP))?.state).toBe("funding_expired");

    // A drop stuck after the first check waits for the next hour.
    await seedDrop(OTHER);
    clock = new Date(AFTER_DEADLINE.getTime() + HOUR_MS - 1);
    await worker.turn();
    expect((await dropRow(OTHER))?.state).toBe("created");

    clock = new Date(AFTER_DEADLINE.getTime() + HOUR_MS);
    await worker.turn();
    expect((await dropRow(OTHER))?.state).toBe("funding_expired");
  });
});
