/**
 * The worker: funding watcher, activation, payer.
 *
 * The chain is `test/fake-chain.ts`, which emits real `Claimed` logs, so the worker's progress
 * comes out of receipts here exactly as it does on a real chain.
 *
 * `tick()` is driven by hand rather than by the timer. A test that waits for a poll interval is
 * a test that is slow and flaky for no reason.
 */
import { eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { createDropEventBus, type DropEvent, type DropEventBus } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { MAX_ATTEMPTS } from "../src/worker/queue.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles } from "../src/db/schema.js";
import { adaptersFor, createFakeChain, FAKE_CHAIN_ID, type FakeChain } from "./fake-chain.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const RECIPIENTS = [
  getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"),
  getAddress("0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB"),
  getAddress("0xCcCcCCCcCCCCcCCCCCcCcCccCcCCCcCcccccCCcC"),
];
const AMOUNT = 100_000_000_000_000n; // 0.0001 ETH
const GROSS = AMOUNT * 3n;
const FUNDING_DEADLINE = 1_800_000_000n;

let handle: DatabaseHandle;
let chain: FakeChain;
let events: DropEventBus;
let seen: DropEvent[];
let worker: Worker;
let clock: Date;

function manifestJson(count = 3): string {
  return JSON.stringify({
    version: 1,
    drop: DROP,
    chainId: FAKE_CHAIN_ID,
    root: `0x${"33".repeat(32)}`,
    totalEntitlements: (AMOUNT * BigInt(count)).toString(),
    leafCount: count,
    entries: Array.from({ length: count }, (_, index) => ({
      index,
      recipient: RECIPIENTS[index % RECIPIENTS.length] as Address,
      amount: AMOUNT.toString(),
      proof: [`0x${"44".repeat(32)}`],
    })),
  });
}

async function seedDrop(overrides: Record<string, unknown> = {}, leafCount = 3): Promise<void> {
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null })
    .onConflictDoNothing();
  await handle.db.insert(drops).values({
    address: DROP.toLowerCase(),
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: manifestJson(leafCount),
    totalEntitlements: (AMOUNT * BigInt(leafCount)).toString(),
    feeAmount: "0",
    grossRequired: (AMOUNT * BigInt(leafCount)).toString(),
    leafCount,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: FUNDING_DEADLINE,
    claimPeriod: 2_592_000,
    state: "created",
    createTxHash: `0x${"55".repeat(32)}`,
    ...overrides,
  });
  await handle.db.insert(dropJobs).values({
    dropAddress: DROP.toLowerCase(),
    kind: "watch_funding",
    state: "ready",
    runAfter: clock,
  });
}

async function dropRow() {
  const rows = await handle.db.select().from(drops).where(eq(drops.address, DROP.toLowerCase()));
  return rows[0];
}

async function jobRow(kind: string) {
  const rows = await handle.db.select().from(dropJobs).where(eq(dropJobs.kind, kind));
  return rows[0];
}

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  chain = createFakeChain();
  events = createDropEventBus();
  seen = [];
  clock = new Date("2026-09-11T10:00:00.000Z");
  worker = createWorker({
    db: handle.db,
    chains: adaptersFor(chain),
    events,
    now: () => clock,
    pollMs: 5_000,
  });
  // One listener for every drop this file touches.
  events.subscribe(DROP, (event) => seen.push(event));
  return () => handle.close();
});

describe("watching for funding", () => {
  it("does nothing while the drop is empty, and does not burn an attempt for it", async () => {
    await seedDrop();
    expect(await worker.tick()).toBe(true);

    expect((await dropRow())?.state).toBe("created");
    const job = await jobRow("watch_funding");
    expect(job?.state).toBe("ready");
    // Waiting is the normal case, not a failure. Counting it would retire the watcher long
    // before the seven day funding deadline.
    expect(job?.attempts).toBe(0);
    expect(job?.runAfter.getTime()).toBe(clock.getTime() + 5_000);
    expect(seen).toHaveLength(0);
  });

  it("marks it funded at exactly grossRequired and queues activation", async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS);
    await worker.tick();

    expect((await dropRow())?.state).toBe("funded");
    expect(seen[0]).toMatchObject({ type: "funding_seen", balanceWei: GROSS.toString() });
    expect((await jobRow("watch_funding"))?.state).toBe("done");
    expect((await jobRow("activate"))?.state).toBe("ready");
  });

  it("accepts an overfunded drop, because the design is >= and not ==", async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS + 1n);
    await worker.tick();
    expect((await dropRow())?.state).toBe("funded");
  });

  it("does not accept one wei short", async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS - 1n);
    await worker.tick();
    expect((await dropRow())?.state).toBe("created");
  });

  it("gives up when the funding deadline passes with nothing there", async () => {
    await seedDrop();
    clock = new Date((Number(FUNDING_DEADLINE) + 1) * 1000);
    await worker.tick();

    expect((await dropRow())?.state).toBe("funding_expired");
    expect(seen[0]).toMatchObject({ type: "finished", state: "funding_expired" });
    expect((await jobRow("watch_funding"))?.state).toBe("done");
  });
});

describe("activating", () => {
  beforeEach(async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS);
    chain.setClaimDeadline(DROP, 1_900_000_000n);
    await worker.tick(); // watch_funding
  });

  it("calls activate once, records the hash, and queues the payer", async () => {
    await worker.tick();

    expect(chain.activations).toEqual([DROP]);
    const row = await dropRow();
    expect(row?.state).toBe("active");
    expect(row?.activateTxHash).toMatch(/^0x/);
    expect(seen.at(-1)).toMatchObject({ type: "activated", claimDeadline: "1900000000" });
    expect((await jobRow("pay"))?.state).toBe("ready");
  });

  it("does not call activate when somebody else already did", async () => {
    // Activation is permissionless. Somebody getting there first is a good outcome.
    chain.setStatus(DROP, 1);
    await worker.tick();

    expect(chain.activations).toEqual([]);
    expect((await dropRow())?.state).toBe("active");
    expect(seen.at(-1)).toMatchObject({ type: "activated", txHash: null });
    expect((await jobRow("pay"))?.state).toBe("ready");
  });

  it("freezes the coin's usd price at activation, once, and never rewrites it", async () => {
    let price: number | null = 3000;
    const asked: string[] = [];
    const priced = createWorker({
      db: handle.db,
      chains: adaptersFor(chain),
      events,
      now: () => clock,
      pollMs: 5_000,
      prices: {
        usdPrice: (symbol) => {
          asked.push(symbol);
          return Promise.resolve(price);
        },
      },
    });
    await priced.tick(); // activate

    const row = await dropRow();
    expect(row?.state).toBe("active");
    expect(asked).toEqual(["ETH"]);
    expect(row?.priceUsd).toBe("3000");
    expect(row?.pricedAt).toEqual(clock);

    // The coin moves. The drop does not.
    price = 1;
    await priced.tick(); // pay
    expect((await dropRow())?.priceUsd).toBe("3000");
  });

  it("still activates and pays when the price lookup fails, storing nothing", async () => {
    for (const usdPrice of [
      () => Promise.reject(new Error("coingecko is down")),
      () => Promise.resolve(null),
    ]) {
      handle = await openAndMigrate("memory://");
      chain = createFakeChain();
      await seedDrop();
      chain.setBalance(DROP, GROSS);
      chain.setClaimDeadline(DROP, 1_900_000_000n);
      const unpriced = createWorker({
        db: handle.db,
        chains: adaptersFor(chain),
        events,
        now: () => clock,
        pollMs: 5_000,
        prices: { usdPrice },
      });
      await unpriced.tick(); // watch_funding
      await unpriced.tick(); // activate
      const row = await dropRow();
      expect(row?.state).toBe("active");
      expect(row?.priceUsd).toBeNull();
      expect(row?.pricedAt).toBeNull();
      expect((await jobRow("pay"))?.state).toBe("ready");
    }
  });

  it("stops when the drop was cancelled instead", async () => {
    chain.setStatus(DROP, 3);
    await worker.tick();
    expect((await dropRow())?.state).toBe("funding_expired");
    expect(await jobRow("pay")).toBeUndefined();
  });
});

describe("paying", () => {
  beforeEach(async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS);
    chain.setClaimDeadline(DROP, 1_900_000_000n);
    await worker.tick(); // watch_funding
    await worker.tick(); // activate
  });

  it("pays every leaf and finishes", async () => {
    await worker.drain();

    expect(chain.batches).toHaveLength(1);
    expect(chain.batches[0]?.items).toHaveLength(3);

    const row = await dropRow();
    expect(row?.state).toBe("finished");
    expect(row?.paidCount).toBe(3);
    expect(row?.failedIndexes).toEqual([]);
    expect(row?.lastTxHash).toMatch(/^0x/);

    const paid = seen.filter((event) => event.type === "claim_paid");
    expect(paid).toHaveLength(3);
    expect(paid[0]).toMatchObject({
      index: 0,
      recipient: RECIPIENTS[0],
      amountWei: AMOUNT.toString(),
      paidCount: 1,
      leafCount: 3,
      // An address leaf has no X account.
      handle: null,
      profileImageUrl: null,
    });
    expect(seen.at(-1)).toMatchObject({ type: "finished", state: "finished", paidCount: 3 });
  });

  it("skips a leaf somebody already claimed, and never pays it twice", async () => {
    chain.setClaimed(DROP, 1n);
    await worker.drain();

    // Index 1 is not even sent: the pre-check saves the gas the contract would have skipped.
    expect(chain.batches[0]?.items.map((item) => Number(item.index))).toEqual([0, 2]);
    const row = await dropRow();
    expect(row?.paidCount).toBe(2);
    expect(row?.state).toBe("finished");
  });

  it("cuts the batch at MAX_BATCH, which is 20", async () => {
    await handle.db.delete(dropJobs);
    await handle.db.delete(drops);
    await seedDrop({}, 45);
    chain.setBalance(DROP, AMOUNT * 45n);
    await worker.drain();

    expect(chain.batches.map((batch) => batch.items.length)).toEqual([20, 20, 5]);
    expect((await dropRow())?.paidCount).toBe(45);
  });

  it("isolates one bad leaf and still pays the other two", async () => {
    // one native send that fails reverts the whole batch. A contract recipient that
    // rejects ETH must not cost the others anything.
    chain.failIndex(1);
    await worker.drain();

    // The other two are paid on the first pass. The bad one is then retried on its own, with a
    // backoff, because a recipient that rejects ETH today may accept it tomorrow and the claim
    // window is thirty days long. Only after `MAX_ATTEMPTS` is it given up on.
    expect((await dropRow())?.paidCount).toBe(2);
    expect((await dropRow())?.state).toBe("paying");

    for (let round = 0; round <= MAX_ATTEMPTS; round += 1) {
      if ((await dropRow())?.state === "finished") break;
      clock = new Date(clock.getTime() + 10 * 60 * 1000);
      await worker.drain();
    }

    const row = await dropRow();
    expect(row?.failedIndexes).toEqual([1]);
    expect(row?.paidCount).toBe(2);
    expect(row?.state).toBe("finished");
    expect(row?.lastError).toContain("1 leaves could not be paid");

    const paid = seen.filter((event) => event.type === "claim_paid").map((e) => e.index);
    expect(paid.sort()).toEqual([0, 2]);
  });

  it("stops when the claim window has closed", async () => {
    chain.setClaimDeadline(DROP, 1_000n);
    await worker.drain();

    const row = await dropRow();
    expect(row?.state).toBe("claims_expired");
    expect(seen.at(-1)).toMatchObject({ type: "finished", state: "claims_expired" });
  });
});

describe("surviving a restart", () => {
  it("picks a job back up that a dead process left running", async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS);
    await handle.db.update(dropJobs).set({ state: "running" });

    // A fresh worker, as if the process had been restarted. `start` releases the stuck row.
    const restarted = createWorker({
      db: handle.db,
      chains: adaptersFor(chain),
      events,
      now: () => clock,
      pollMs: 5_000,
    });
    await restarted.start();
    restarted.stop();

    expect(await restarted.tick()).toBe(true);
    expect((await dropRow())?.state).toBe("funded");
  });

  it("keeps its place: everything the worker knows is in rows, never in memory", async () => {
    await seedDrop({}, 45);
    chain.setBalance(DROP, AMOUNT * 45n);
    chain.setClaimDeadline(DROP, 1_900_000_000n);
    await worker.tick(); // watch_funding
    await worker.tick(); // activate
    await worker.tick(); // first batch of 20

    expect((await dropRow())?.nextClaimIndex).toBe(20);

    const restarted = createWorker({
      db: handle.db,
      chains: adaptersFor(chain),
      events,
      now: () => clock,
      pollMs: 5_000,
    });
    await restarted.drain();

    const row = await dropRow();
    expect(row?.paidCount).toBe(45);
    expect(row?.state).toBe("finished");
    // Three batches in total, not four: the restart did not redo the first one.
    expect(chain.batches.map((batch) => batch.items.length)).toEqual([20, 20, 5]);
  });
});

describe("when a step keeps failing", () => {
  it("backs off, counts the attempt, and eventually gives up", async () => {
    await seedDrop();
    chain.setBalance(DROP, GROSS);
    const broken = createWorker({
      db: handle.db,
      chains: adaptersFor({
        ...chain,
        getBalance: () => Promise.reject(new Error("rpc is down")),
      }),
      events,
      now: () => clock,
      pollMs: 5_000,
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Move past the backoff each time, so the job is due again.
      clock = new Date(clock.getTime() + 10 * 60 * 1000);
      expect(await broken.tick()).toBe(true);
    }

    const job = await jobRow("watch_funding");
    expect(job?.state).toBe("failed");
    expect(job?.lastError).toContain("rpc is down");
    expect((await dropRow())?.lastError).toContain("rpc is down");
  });
});
