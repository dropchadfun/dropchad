/**
 * The worker driving a Solana drop end to end over the fake cluster: funding, activation,
 * paying in fit table batches with the bitmap read first, and the settle job that refunds or
 * cancels and then closes so the rent comes back.
 */
import { buildDropTree, canonicalManifestJson, toManifest } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import {
  SVM_STATUS_ACTIVE,
  SVM_STATUS_CANCELLED,
  SVM_STATUS_FINALIZED,
} from "../src/chain/svm/accounts.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { bitmapPda, dropPda } from "../src/chain/svm/pda.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles } from "../src/db/schema.js";
import { createDropEventBus, type DropEvent } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const FUNDING_PERIOD = 7 * 86_400;
const CLAIM_PERIOD = 30 * 86_400;
/** Past a deadline by more than the settle job's 120 s copy margin. */
const PAST_MARGIN = 200;

/** Deterministic distinct receivers: 32 bytes of one value each, like the fixture. */
function receiversOf(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    recipient: pubkeyToBase58(new Uint8Array(32).fill(0x10 + i)),
    amount: LEAF,
  }));
}

let handle: DatabaseHandle;
let svm: FakeSvm;
let adapter: ChainAdapter;
let worker: Worker;
let seen: DropEvent[];
let clock: Date;
let relayer: ReturnType<typeof randomSigner>;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  relayer = randomSigner();
  svm = new FakeSvm({ relayer: relayer.publicKey });
  clock = new Date(Number(svm.clock) * 1000);
  const rpc = createFakeSvmRpc(svm);
  const known = new Set<string>();
  const svmRelayer = createSvmRelayer({
    rpc,
    signer: relayer,
    isKnownDrop: async (address) => {
      const rows = await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1);
      return rows.length === 1 || known.has(address);
    },
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  adapter = createSvmAdapter({ rpc, relayer: svmRelayer, chain: CHAIN });
  seen = [];
  const events = createDropEventBus();
  worker = createWorker({
    db: handle.db,
    chains: singleAdapter(adapter),
    events,
    now: () => clock,
    pollMs: 5_000,
  });
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
});

/** Create a drop on the fake cluster the way `create.ts` does, and seed our row and first job. */
async function seedDrop(count = 3, nonce = 0n) {
  const commitment = unblindedCommitment(1n, nonce);
  const prediction = await adapter.predictDrop(commitment, nonce);
  const tree = buildDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: receiversOf(count),
  });
  const created = await adapter.createDrop({
    merkleRoot: tree.root,
    manifestHash: `0x${"11".repeat(32)}`,
    totalEntitlements: tree.totalEntitlements,
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    creatorCommitment: commitment,
    nonce,
    fundingPeriod: FUNDING_PERIOD,
    claimPeriod: CLAIM_PERIOD,
  });
  await handle.db.insert(drops).values({
    address: created.drop,
    chainId: 103,
    chainKey: "solana-devnet",
    xUserId: "1",
    nonce,
    creatorCommitment: commitment,
    salt: null,
    asset: created.asset,
    merkleRoot: tree.root,
    manifestHash: created.manifestHash,
    manifestJson: canonicalManifestJson(toManifest(tree)),
    totalEntitlements: tree.totalEntitlements.toString(),
    feeAmount: "0",
    grossRequired: created.grossRequired.toString(),
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    fundingDeadline: created.fundingDeadline,
    claimPeriod: CLAIM_PERIOD,
    createTxHash: created.txId,
    createdAt: clock,
    updatedAt: clock,
  });
  await handle.db.insert(dropJobs).values({
    dropAddress: created.drop,
    kind: "watch_funding",
    runAfter: clock,
  });
  worker = createWorker({
    db: handle.db,
    chains: singleAdapter(adapter),
    events: {
      emit: (event) => seen.push(event),
      subscribe: () => () => undefined,
      listenerCount: () => 0,
    },
    now: () => clock,
    pollMs: 5_000,
  });
  return { address: created.drop, drop: pubkeyFromBase58(created.drop), tree };
}

async function dropRow(address: string) {
  return (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1))[0];
}

async function jobs(address: string) {
  return handle.db.select().from(dropJobs).where(eq(dropJobs.dropAddress, address));
}

/** Move both clocks, the worker's and the cluster's. */
function advance(seconds: number) {
  svm.clock += BigInt(seconds);
  clock = new Date(Number(svm.clock) * 1000);
}

describe("a Solana drop through the worker", () => {
  it("watches the spendable balance, activates, pays three leaves in one transaction, then settles and closes", async () => {
    const { address, drop } = await seedDrop(3);

    // The rent minimum alone is not funding.
    expect(await worker.tick()).toBe(true);
    expect((await dropRow(address))?.state).toBe("created");

    svm.fund(drop, LEAF * 3n);
    clock = new Date(clock.getTime() + 5_000); // the watcher's next look
    await worker.tick(); // watch_funding -> funded
    expect((await dropRow(address))?.state).toBe("funded");
    expect(seen.map((e) => e.type)).toEqual(["funding_seen"]);

    await worker.tick(); // activate
    expect((await dropRow(address))?.state).toBe("active");
    expect(seen.at(-1)?.type).toBe("activated");

    await worker.tick(); // pay: 3 leaves at depth 2, the fit table says 7 per tx, so one tx
    await worker.tick(); // pay: nothing left, finished
    const row = await dropRow(address);
    expect(row?.state).toBe("finished");
    expect(row?.paidCount).toBe(3);
    expect(row?.failedIndexes).toEqual([]);
    expect(svm.executed.filter((n) => n === "claim")).toHaveLength(3);
    // One claim transaction: every `claim` shares the signature recorded as the last hash.
    expect(seen.filter((e) => e.type === "claim_paid")).toHaveLength(3);
    expect(seen.at(-1)).toMatchObject({ type: "finished", state: "finished", paidCount: 3 });
    for (const r of receiversOf(3))
      expect(svm.lamportsOf(pubkeyFromBase58(r.recipient))).toBe(LEAF);

    // The settle job is queued for one second after the claim deadline, and waits until then.
    const queued = await jobs(address);
    expect(queued.map((j) => [j.kind, j.state]).sort()).toEqual([
      ["activate", "done"],
      ["pay", "done"],
      ["settle", "ready"],
      ["watch_funding", "done"],
    ]);
    expect(await worker.tick()).toBe(false); // not due yet

    advance(CLAIM_PERIOD + PAST_MARGIN);
    const relayerBefore = svm.lamportsOf(relayer.publicKey);
    await worker.tick(); // settle: the claimed copy, then refund, nothing left, Finalized
    expect(svm.drop(drop)?.status).toBe(SVM_STATUS_FINALIZED);
    expect((await dropRow(address))?.settleTxHash).not.toBeNull();
    // the claimed leaves are on our row before the bitmap can go.
    expect((await dropRow(address))?.claimedIndexes).toEqual([0, 1, 2]);
    await worker.tick(); // settle: close
    const closed = await dropRow(address);
    expect(closed?.closeTxHash).not.toBeNull();
    expect(closed?.closedAt).not.toBeNull();
    expect(svm.drop(drop)?.closed).toBe(true);
    expect(svm.accounts.has(pubkeyToBase58(bitmapPda(drop).address))).toBe(false);
    // Two fees out, the bitmap rent back in.
    expect(svm.lamportsOf(relayer.publicKey)).toBe(relayerBefore - 10_000n + rentFor(1291));
    expect((await jobs(address)).every((j) => j.state === "done")).toBe(true);
  });

  it("cancels a drop nobody funded and closes it, rent back to the relayer", async () => {
    const { address, drop } = await seedDrop(2);
    svm.fund(drop, LEAF); // half partial
    advance(FUNDING_PERIOD + PAST_MARGIN);

    await worker.tick(); // watch_funding: expired
    expect((await dropRow(address))?.state).toBe("funding_expired");
    expect(seen.at(-1)).toMatchObject({ type: "finished", state: "funding_expired" });

    await worker.tick(); // settle: cancel_unfunded
    expect(svm.drop(drop)?.status).toBe(SVM_STATUS_CANCELLED);
    expect(svm.lamportsOf(pubkeyFromBase58(REFUND))).toBe(LEAF);
    await worker.tick(); // settle: close
    expect(svm.drop(drop)?.closed).toBe(true);
    expect(svm.executed).toEqual(["create_drop", "cancel_unfunded", "close_drop"]);
  });

  it("isolates a leaf the runtime rejects, pays the others, and retries it alone", async () => {
    const { address, drop } = await seedDrop(5);
    svm.fund(drop, LEAF * 5n);
    svm.failingIndexes.add(2);
    await worker.tick(); // funded
    await worker.tick(); // active
    await worker.tick(); // pay: the batch of 5 fails in simulation, halves, index 2 alone fails
    let row = await dropRow(address);
    expect(row?.paidCount).toBe(4);
    expect(row?.failedIndexes).toEqual([2]);
    // Nothing was spent on the failing batch: simulation refused it before it was sent.
    expect(svm.executed.filter((n) => n === "claim")).toHaveLength(4);

    // Phase B: the leaf is tried alone and still fails, with backoff.
    await worker.tick();
    row = await dropRow(address);
    expect(row?.state).toBe("paying");
    expect(row?.failedIndexes).toEqual([2]);

    // The recipient can receive again. Move past the backoff and it gets paid.
    svm.failingIndexes.clear();
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await worker.tick();
    await worker.tick();
    row = await dropRow(address);
    expect(row?.state).toBe("finished");
    expect(row?.paidCount).toBe(5);
    expect(row?.failedIndexes).toEqual([]);
  });

  it("skips leaves the bitmap already shows as claimed", async () => {
    const { address, drop, tree } = await seedDrop(4);
    svm.fund(drop, LEAF * 4n);
    await worker.tick();
    await worker.tick();
    // A receiver claimed leaf 1 themselves in the meantime.
    svm.setClaimed(drop, 1);
    await worker.tick(); // pay
    await worker.tick(); // finished
    const row = await dropRow(address);
    expect(row?.paidCount).toBe(3);
    expect(row?.state).toBe("finished");
    expect(svm.executed.filter((n) => n === "claim")).toHaveLength(3);
    const second = tree.entries[1];
    expect(
      seen.filter((e) => e.type === "claim_paid").map((e) => (e as { index: number }).index),
    ).not.toContain(second?.index);
  });

  it("sizes batches by the fit table: 9 leaves at depth 4 go 4 per transaction", async () => {
    const { address, drop } = await seedDrop(9);
    svm.fund(drop, LEAF * 9n);
    await worker.tick();
    await worker.tick();
    await worker.tick(); // 4
    expect((await dropRow(address))?.nextClaimIndex).toBe(4);
    await worker.tick(); // 4
    await worker.tick(); // 1
    await worker.tick(); // finished
    const row = await dropRow(address);
    expect(row?.paidCount).toBe(9);
    expect(row?.state).toBe("finished");
    // Three transactions: 4 + 4 + 1 claims. Every claim landed.
    expect(svm.transactions.size).toBe(1 + 1 + 3);
  });

  it("waits when the process has no relayer for the row's chain, without counting an attempt", async () => {
    const { address } = await seedDrop(1);
    const orphan = createWorker({
      db: handle.db,
      chains: { get: () => undefined, all: () => [], defaultKey: "robinhood-testnet" },
      events: createDropEventBus(),
      now: () => clock,
      pollMs: 5_000,
    });
    expect(await orphan.tick()).toBe(true);
    const job = (await jobs(address))[0];
    expect(job?.state).toBe("ready");
    expect(job?.attempts).toBe(0);
    expect(job?.lastError).toContain("no relayer configured for chain solana-devnet");
    expect(job?.runAfter.getTime()).toBeGreaterThan(clock.getTime());
  });

  it("uses the PDA of the commitment and nonce, so a wiped database still finds the taken address", async () => {
    const { address } = await seedDrop(1, 0n);
    expect(address).toBe(
      pubkeyToBase58(dropPda(hexBytes(unblindedCommitment(1n, 0n)), 0n).address),
    );
    const again = await adapter.predictDrop(unblindedCommitment(1n, 0n), 0n);
    expect(again.taken).toBe(true);
  });
});

/**
 * `close_drop` deletes the bitmap, and the boards read the claimed
 * leaves from it, so the settle job keeps a copy on our row first: `drops.claimed_indexes`, read
 * at `finalized` as soon as the claim deadline has passed, **before** our `refund`, for every
 * Solana drop. After the deadline no claim can land, so the bitmap is
 * frozen; storing before the refund keeps a stranger's `close_drop` from racing the copy.
 */
describe("the claimed snapshot before the bitmap is closed", () => {
  function useAdapter(chain: ChainAdapter) {
    worker = createWorker({
      db: handle.db,
      chains: singleAdapter(chain),
      events: createDropEventBus(),
      now: () => clock,
      pollMs: 5_000,
    });
  }

  /** Seed, fund, activate and pay once. Leaves in `failing` are never paid. */
  async function activeAndPaid(count: number, failing: number[] = []) {
    const seeded = await seedDrop(count);
    svm.fund(seeded.drop, LEAF * BigInt(count));
    for (const index of failing) svm.failingIndexes.add(index);
    await worker.tick(); // funded
    await worker.tick(); // active
    await worker.tick(); // pay
    return seeded;
  }

  async function tickUntil(done: () => Promise<boolean> | boolean, max = 12) {
    for (let i = 0; i < max; i += 1) {
      if (await done()) return;
      await worker.tick();
    }
    throw new Error("never got there");
  }

  it("stores the claimed indexes before it sends refund: a crash in between loses nothing", async () => {
    // Leaf 3 is never paid, so the copy is [0, 1, 2], not every leaf.
    const { address, drop } = await activeAndPaid(4, [3]);
    useAdapter({
      ...adapter,
      refund: () => Promise.reject(new Error("crash before the refund")),
    });
    advance(CLAIM_PERIOD + PAST_MARGIN);
    await tickUntil(async () => (await dropRow(address))?.claimedIndexes != null);

    expect((await dropRow(address))?.claimedIndexes).toEqual([0, 1, 2]);
    // Stored, and the refund never landed: the store came first.
    expect(svm.drop(drop)?.status).toBe(SVM_STATUS_ACTIVE);
    expect(svm.executed).not.toContain("refund");

    // The process comes back. It never reads the bitmap again: a bit that changes now (it cannot
    // on the real chain, the window is closed) does not touch the stored copy.
    svm.failingIndexes.clear();
    svm.setClaimed(drop, 3);
    useAdapter(adapter);
    advance(3600);
    await tickUntil(() => svm.drop(drop)?.closed === true);
    await worker.tick();

    const row = await dropRow(address);
    expect(row?.claimedIndexes).toEqual([0, 1, 2]);
    expect(row?.closedAt).not.toBeNull();
    expect(svm.executed.filter((n) => n === "refund" || n === "close_drop")).toEqual([
      "refund",
      "close_drop",
    ]);
  });

  it("keeps the copy when close_drop lands and the process dies before it writes closedAt", async () => {
    const { address, drop } = await activeAndPaid(3);
    useAdapter({
      ...adapter,
      closeDrop: async (d) => {
        await adapter.closeDrop(d);
        throw new Error("crash after close_drop landed");
      },
    });
    advance(CLAIM_PERIOD + PAST_MARGIN);
    await tickUntil(() => svm.drop(drop)?.closed === true);
    expect((await dropRow(address))?.closedAt).toBeNull();

    useAdapter(adapter);
    advance(3600);
    await worker.tick();
    const row = await dropRow(address);
    expect(row?.closedAt).not.toBeNull();
    expect(row?.claimedIndexes).toEqual([0, 1, 2]);
    expect(svm.executed.filter((n) => n === "close_drop")).toHaveLength(1);
  });

  it("reads at finalized: while finalized lags behind confirmed it stores nothing and sends no refund", async () => {
    const { address, drop } = await seedDrop(3);
    svm.fund(drop, LEAF * 3n);
    await worker.tick(); // funded
    await worker.tick(); // active
    // Finalized still sees the drop before any claim landed.
    svm.finalizedView = svm.snapshot();
    await worker.tick(); // pay, all three at confirmed
    advance(CLAIM_PERIOD + PAST_MARGIN);
    await worker.tick();
    await worker.tick();

    expect((await dropRow(address))?.claimedIndexes ?? null).toBeNull();
    expect(svm.executed).not.toContain("refund");

    // Finalized catches up.
    svm.finalizedView = null;
    advance(60);
    await tickUntil(() => svm.executed.includes("refund"));
    expect((await dropRow(address))?.claimedIndexes).toEqual([0, 1, 2]);
  });

  it("waits for the chain clock plus 120 s, never the server clock, before the copy and the refund", async () => {
    const { address, drop } = await activeAndPaid(3);
    // The chain is 60 s past the deadline; the server clock runs an hour ahead of it.
    advance(CLAIM_PERIOD + 60);
    clock = new Date(clock.getTime() + 3600 * 1000);
    await worker.tick();
    await worker.tick();
    expect((await dropRow(address))?.claimedIndexes ?? null).toBeNull();
    expect(svm.executed).not.toContain("refund");
    expect(svm.drop(drop)?.status).toBe(SVM_STATUS_ACTIVE);

    // 120 s is not past the margin: the rule is strictly after deadline + 120.
    svm.clock += 60n;
    clock = new Date(clock.getTime() + 3600 * 1000);
    await worker.tick();
    expect((await dropRow(address))?.claimedIndexes ?? null).toBeNull();

    // The chain moves past deadline + 120. Now the copy, then the refund.
    svm.clock += 1n;
    clock = new Date(clock.getTime() + 3600 * 1000);
    await tickUntil(() => svm.executed.includes("refund"));
    expect((await dropRow(address))?.claimedIndexes).toEqual([0, 1, 2]);
  });

  it("stores an empty copy for a drop nobody funded, before cancel_unfunded", async () => {
    const { address, drop } = await seedDrop(2);
    advance(FUNDING_PERIOD + PAST_MARGIN);
    await tickUntil(() => svm.drop(drop)?.closed === true);
    expect((await dropRow(address))?.claimedIndexes).toEqual([]);
    expect(svm.executed).toEqual(["create_drop", "cancel_unfunded", "close_drop"]);
  });

  it("a stranger closed it first: the known gap, no copy, and never an empty one", async () => {
    const { address, drop } = await activeAndPaid(3);
    advance(CLAIM_PERIOD + PAST_MARGIN);
    svm.closeByStranger(drop);
    await tickUntil(async () => (await dropRow(address))?.closedAt != null);
    // No bitmap, no copy. An empty list would say nobody was paid, which is false.
    expect((await dropRow(address))?.claimedIndexes ?? null).toBeNull();
    expect(svm.executed).not.toContain("refund");
    expect(svm.executed).not.toContain("close_drop");
  });
});

function hexBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex.slice(2), "hex"));
}
