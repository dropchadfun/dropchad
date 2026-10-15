/**
 * Where the Telegram post is queued: when the worker sets a handle drop
 * `active`, and only with the switch on. Never a multisend, never twice. The worker never calls
 * Telegram itself, so a Telegram outage cannot slow a payout.
 */
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles, telegramPosts } from "../src/db/schema.js";
import { createDropEventBus } from "../src/worker/events.js";
import { createWorker } from "../src/worker/worker.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { FAKE_CHAIN_ID, createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const AMOUNT = 100_000_000_000_000n;
const WALLET = getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");

let handle: DatabaseHandle;
let chain: FakeChain;
let clock: Date;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  chain = createFakeChain();
  clock = new Date("2026-10-12T10:00:00.000Z");
  return () => handle.close();
});

function worker(telegramPosts: boolean | undefined) {
  return createWorker({
    db: handle.db,
    chains: singleAdapter(evmAdapterFor(chain)),
    events: createDropEventBus(),
    now: () => clock,
    pollMs: 5_000,
    ...(telegramPosts === undefined ? {} : { telegramPosts }),
  });
}

function manifest(mode: "handle" | "address"): string {
  const entry =
    mode === "handle"
      ? { index: 0, xId: "44196397", amount: AMOUNT.toString(), proof: [`0x${"44".repeat(32)}`] }
      : {
          index: 0,
          recipient: WALLET,
          amount: AMOUNT.toString(),
          proof: [`0x${"44".repeat(32)}`],
        };
  return JSON.stringify({
    version: mode === "handle" ? 2 : 1,
    ...(mode === "handle" ? { mode: "handle" } : {}),
    drop: DROP,
    chainId: FAKE_CHAIN_ID,
    root: `0x${"33".repeat(32)}`,
    totalEntitlements: AMOUNT.toString(),
    leafCount: 1,
    entries: [entry],
  });
}

async function seedFundedDrop(mode: "handle" | "address"): Promise<void> {
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "samplechad", displayName: "S", profileImageUrl: null })
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
    manifestJson: manifest(mode),
    totalEntitlements: AMOUNT.toString(),
    feeAmount: "0",
    grossRequired: AMOUNT.toString(),
    leafCount: 1,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 604_800,
    mode,
    state: "created",
    createTxHash: `0x${"55".repeat(32)}`,
  });
  await handle.db.insert(dropJobs).values({
    dropAddress: DROP.toLowerCase(),
    kind: "watch_funding",
    state: "ready",
    runAfter: clock,
  });
  chain.setBalance(DROP, AMOUNT);
}

const posts = () => handle.db.select().from(telegramPosts);

describe("the hook at activation", () => {
  it("switch on: a handle drop going live queues one post, ready now", async () => {
    await seedFundedDrop("handle");
    await worker(true).drain();
    expect(chain.activations).toEqual([DROP]);
    const rows = await posts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dropAddress: DROP.toLowerCase(),
      state: "ready",
      attempts: 0,
    });
    expect(rows[0]?.runAfter.toISOString()).toBe(clock.toISOString());
  });

  it("switch on: a multisend going live queues nothing", async () => {
    await seedFundedDrop("address");
    await worker(true).drain();
    expect(chain.activations).toEqual([DROP]);
    expect(await posts()).toHaveLength(0);
  });

  it("switch off: nothing is queued", async () => {
    await seedFundedDrop("handle");
    await worker(false).drain();
    expect(await posts()).toHaveLength(0);
  });

  it("not given at all is off", async () => {
    await seedFundedDrop("handle");
    await worker(undefined).drain();
    expect(await posts()).toHaveLength(0);
  });

  it("an activate job run twice still queues one post", async () => {
    await seedFundedDrop("handle");
    const w = worker(true);
    await w.drain();
    await handle.db
      .insert(dropJobs)
      .values({
        dropAddress: DROP.toLowerCase(),
        kind: "activate",
        state: "ready",
        runAfter: clock,
      })
      .onConflictDoNothing();
    await handle.db
      .update(dropJobs)
      .set({ state: "ready", runAfter: clock })
      .where(eq(dropJobs.kind, "activate"));
    await w.drain();
    expect(await posts()).toHaveLength(1);
  });
});
