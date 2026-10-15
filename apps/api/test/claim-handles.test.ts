/**
 * the worker side.
 * - a handle drop never runs `pay`: after activation it gets `claim_handles`
 * - each `bound` binding is sent as one `claimHandle`, then `paid` from the `HandleClaimed` log
 * - after a failed send the chain decides: claimed is `paid`, a revoked binder keeps it `bound`
 *   for later, anything else is `failed`
 * - a `submitted` row left by a crash is settled from the claim bit
 * - the drop finishes when every leaf is paid, or expires with its claim window
 * - a chain without handle claims yet (Solana until 16b) waits, it does not fail
 */
import { eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChainAdapter } from "../src/chain/adapter.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import {
  dropHandleLeaves,
  dropJobs,
  drops,
  handleBindings,
  profiles,
  xUsers,
} from "../src/db/schema.js";
import { createDropEventBus, type DropEvent } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { FAKE_CHAIN_ID, createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const AMOUNT = 100_000_000_000_000n;
const X_IDS = [44196397n, 1600000000000000000n];
const WALLETS = [
  getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"),
  getAddress("0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB"),
];
const SIGNATURE = `0x${"ab".repeat(65)}`;

let handle: DatabaseHandle;
let chain: FakeChain;
let worker: Worker;
let seen: DropEvent[];
let clock: Date;

function buildWorker(adapter: ChainAdapter): Worker {
  const events = createDropEventBus();
  events.subscribe(DROP, (event) => seen.push(event));
  return createWorker({
    db: handle.db,
    chains: singleAdapter(adapter),
    events,
    now: () => clock,
    pollMs: 5_000,
  });
}

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  chain = createFakeChain();
  seen = [];
  clock = new Date("2026-09-11T10:00:00.000Z");
  worker = buildWorker(evmAdapterFor(chain));
  return () => handle.close();
});

function handleManifest(): string {
  return JSON.stringify({
    version: 2,
    mode: "handle",
    drop: DROP,
    chainId: FAKE_CHAIN_ID,
    root: `0x${"33".repeat(32)}`,
    totalEntitlements: (AMOUNT * 2n).toString(),
    leafCount: 2,
    entries: X_IDS.map((xId, index) => ({
      index,
      xId: xId.toString(),
      amount: AMOUNT.toString(),
      proof: [`0x${"44".repeat(32)}`],
    })),
  });
}

async function seedHandleDrop(
  state: "created" | "active",
  jobs: { kind: string; runAfter?: Date }[],
): Promise<void> {
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
    manifestJson: handleManifest(),
    totalEntitlements: (AMOUNT * 2n).toString(),
    feeAmount: "0",
    grossRequired: (AMOUNT * 2n).toString(),
    leafCount: 2,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    mode: "handle",
    state,
    createTxHash: `0x${"55".repeat(32)}`,
  });
  await handle.db.insert(dropHandleLeaves).values(
    X_IDS.map((xId, index) => ({
      dropAddress: DROP.toLowerCase(),
      leafIndex: index,
      xUserId: xId.toString(),
      amount: AMOUNT.toString(),
    })),
  );
  for (const job of jobs) {
    await handle.db.insert(dropJobs).values({
      dropAddress: DROP.toLowerCase(),
      kind: job.kind,
      state: "ready",
      runAfter: job.runAfter ?? clock,
    });
  }
  if (state === "active") {
    chain.setStatus(DROP, 1);
    chain.setClaimDeadline(DROP, 1_800_000_000n);
  }
}

async function bindLeaf(index: number, state = "bound"): Promise<void> {
  await handle.db.insert(handleBindings).values({
    dropAddress: DROP.toLowerCase(),
    leafIndex: index,
    xUserId: (X_IDS[index] as bigint).toString(),
    recipient: WALLETS[index] as Address,
    binderSignature: SIGNATURE,
    state: state as "bound",
  });
}

const binding = async (index: number) =>
  (await handle.db.select().from(handleBindings)).find((b) => b.leafIndex === index);
const job = async (kind: string) =>
  (await handle.db.select().from(dropJobs)).find((j) => j.kind === kind);
const dropRow = async () =>
  (await handle.db.select().from(drops).where(eq(drops.address, DROP.toLowerCase())))[0];

describe("after activation", () => {
  it("a handle drop gets claim_handles and never pay", async () => {
    await seedHandleDrop("created", [{ kind: "watch_funding" }]);
    chain.setBalance(DROP, AMOUNT * 2n);
    await worker.drain();
    expect(chain.activations).toEqual([DROP]);
    expect(await job("pay")).toBeUndefined();
    expect((await job("claim_handles"))?.state).toBe("ready");
    expect(chain.batches).toHaveLength(0);
    expect((await dropRow())?.state).toBe("active");
  });
});

describe("claim_handles", () => {
  it("sends one claimHandle per bound binding and marks it paid from the log", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    await worker.tick();

    expect(chain.handleClaims).toHaveLength(1);
    expect(chain.handleClaims[0]?.item).toMatchObject({
      index: 0n,
      xId: X_IDS[0],
      amount: AMOUNT,
      recipient: WALLETS[0],
      signature: SIGNATURE,
    });
    const b = await binding(0);
    expect(b?.state).toBe("paid");
    expect(b?.claimTxHash).toMatch(/^0x/);
    expect((await dropRow())?.paidCount).toBe(1);
    expect(seen).toContainEqual(
      expect.objectContaining({ type: "claim_paid", index: 0, recipient: WALLETS[0] }),
    );
    // One leaf is still unbound, so the job waits for it instead of finishing.
    expect((await job("claim_handles"))?.state).toBe("ready");
  });

  // the live list names the receiver at once, by handle and picture.
  it("`claim_paid` carries the receiver's handle and picture; no `x_users` row is null", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await handle.db.insert(xUsers).values({
      xUserId: (X_IDS[0] as bigint).toString(),
      handle: "alice",
      displayName: "Alice",
      profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_normal.jpg",
    });
    await bindLeaf(0);
    await bindLeaf(1);
    await worker.tick();
    await worker.tick();

    expect(seen).toContainEqual(
      expect.objectContaining({
        type: "claim_paid",
        index: 0,
        handle: "alice",
        profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_normal.jpg",
      }),
    );
    expect(seen).toContainEqual(
      expect.objectContaining({
        type: "claim_paid",
        index: 1,
        handle: null,
        profileImageUrl: null,
      }),
    );
  });

  it("a revoked binder keeps the binding bound and retries later, never failed", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    chain.setBinderLive(false);
    chain.failHandleClaim(0, "execution reverted: BinderIsRevoked()");
    await worker.tick();

    expect((await binding(0))?.state).toBe("bound");
    const j = await job("claim_handles");
    expect(j?.state).toBe("ready");
    expect(j?.attempts).toBe(0);
    expect(j?.runAfter.getTime()).toBeGreaterThan(clock.getTime());
  });

  it("a leaf somebody else already claimed is paid, with no tx of ours", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    chain.setClaimed(DROP, 0n);
    await worker.tick();
    const b = await binding(0);
    expect(b?.state).toBe("paid");
    expect(b?.claimTxHash).toBeNull();
  });

  it("any other revert with the bit clear and a live binder is failed, with the error", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    chain.failHandleClaim(0, "execution reverted: NativeTransferFailed()");
    await worker.tick();
    const b = await binding(0);
    expect(b?.state).toBe("failed");
    expect(b?.lastError).toContain("NativeTransferFailed");
  });

  it("a submitted row from a crash is settled from the claim bit", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0, "submitted");
    await bindLeaf(1, "submitted");
    chain.setClaimed(DROP, 0n);
    await worker.tick();
    // Leaf 0 landed before the crash; leaf 1 never did, so it goes back out.
    expect((await binding(0))?.state).toBe("paid");
    expect((await binding(1))?.state).toBe("paid");
    expect(chain.handleClaims.map((c) => c.item.index)).toEqual([1n]);
  });

  it("finishes the drop once every leaf is paid", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    await bindLeaf(1);
    await worker.tick();
    expect((await dropRow())?.state).toBe("finished");
    expect((await job("claim_handles"))?.state).toBe("done");
    expect(seen).toContainEqual(expect.objectContaining({ type: "finished", paidCount: 2 }));
  });

  it("expires with the claim window, leaving the unsent bindings as they are", async () => {
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    chain.setClaimDeadline(DROP, 1_000_000_000n);
    await worker.tick();
    expect((await dropRow())?.state).toBe("claims_expired");
    expect((await binding(0))?.state).toBe("bound");
    expect(chain.handleClaims).toHaveLength(0);
    expect((await job("claim_handles"))?.state).toBe("done");
  });

  it("a chain without handle claims yet waits and does not burn an attempt", async () => {
    const adapter = evmAdapterFor(chain);
    worker = buildWorker({
      ...adapter,
      capabilities: { ...adapter.capabilities, handleClaims: false },
    });
    await seedHandleDrop("active", [{ kind: "claim_handles" }]);
    await bindLeaf(0);
    await worker.tick();
    expect((await binding(0))?.state).toBe("bound");
    expect(chain.handleClaims).toHaveLength(0);
    expect((await job("claim_handles"))?.attempts).toBe(0);
  });
});
