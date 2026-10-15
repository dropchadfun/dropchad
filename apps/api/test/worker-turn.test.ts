/**
 * The worker turn: every due job, oldest first, one at a
 * time; at most 10 jobs and 30 seconds per turn; the Solana funding poll at most once per turn;
 * a failed job handled as before, and it never stops the rest of the turn.
 */
import { buildDropTree, canonicalManifestJson, toManifest } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles } from "../src/db/schema.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";

let handle: DatabaseHandle;
let svm: FakeSvm;
let rpc: SvmRpc;
let adapter: ChainAdapter;
let clock: Date;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  const relayer = randomSigner();
  svm = new FakeSvm({ relayer: relayer.publicKey });
  clock = new Date(Number(svm.clock) * 1000);
  rpc = createFakeSvmRpc(svm);
  const svmRelayer = createSvmRelayer({
    rpc,
    signer: relayer,
    isKnownDrop: () => Promise.resolve(true),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  adapter = createSvmAdapter({ rpc, relayer: svmRelayer, chain: CHAIN });
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
});

function workerWith(options: { pollMs?: number; now?: () => Date } = {}): Worker {
  return createWorker({
    db: handle.db,
    chains: singleAdapter(adapter),
    events: { emit: () => undefined, subscribe: () => () => undefined, listenerCount: () => 0 },
    now: options.now ?? (() => clock),
    pollMs: options.pollMs ?? 5_000,
  });
}

/** A SOL multisend drop with one leaf on the fake cluster, our row and its `watch_funding` job. */
async function seedDrop(nonce: bigint): Promise<{ address: string; grossRequired: bigint }> {
  const commitment = unblindedCommitment(1n, nonce);
  const prediction = await adapter.predictDrop(commitment, nonce);
  const tree = buildDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: [{ recipient: pubkeyToBase58(new Uint8Array(32).fill(0x20)), amount: 10_000_000n }],
  });
  const created = await adapter.createDrop({
    merkleRoot: tree.root,
    manifestHash: `0x${"11".repeat(32)}`,
    totalEntitlements: tree.totalEntitlements,
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    creatorCommitment: commitment,
    nonce,
    fundingPeriod: 7 * 86_400,
    claimPeriod: 30 * 86_400,
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
    claimPeriod: 30 * 86_400,
    createTxHash: created.txId,
    createdAt: clock,
    updatedAt: clock,
  });
  await handle.db
    .insert(dropJobs)
    .values({ dropAddress: created.drop, kind: "watch_funding", runAfter: clock });
  return { address: created.drop, grossRequired: created.grossRequired };
}

const NO_RELAYER = "no relayer configured for chain robinhood-testnet";

/**
 * Trivial jobs: Robinhood drops this Solana only worker has no adapter for. Each runs in one go,
 * as today: `last_error` says no relayer, it waits 60 s, no attempt counted. Oldest first by id.
 */
async function trivialJobs(count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const address = `0x${(i + 1).toString(16).padStart(40, "0")}`;
    await handle.db.insert(drops).values({
      address,
      chainId: 46630,
      chainKey: "robinhood-testnet",
      xUserId: "1",
      nonce: BigInt(i),
      creatorCommitment: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      salt: null,
      asset: "0x0000000000000000000000000000000000000000",
      merkleRoot: `0x${"11".repeat(32)}`,
      manifestHash: `0x${"22".repeat(32)}`,
      manifestJson: "{}",
      totalEntitlements: "1",
      feeAmount: "0",
      grossRequired: "1",
      leafCount: 1,
      refundRecipient: "0x000000000000000000000000000000000000dEaD",
      fundingDeadline: 1_900_000_000n,
      claimPeriod: 2_592_000,
      createTxHash: "0x01",
    });
    const [row] = await handle.db
      .insert(dropJobs)
      .values({
        dropAddress: address,
        kind: "activate",
        runAfter: new Date(clock.getTime() - (count - i) * 1000),
      })
      .returning({ id: dropJobs.id });
    ids.push(row?.id as number);
  }
  return ids;
}

/** The trivial jobs that ran: the ones that now say no relayer. */
const ranTrivial = async () =>
  (await handle.db.select().from(dropJobs).orderBy(asc(dropJobs.id)))
    .filter((j) => j.lastError === NO_RELAYER)
    .map((j) => j.id);

const stateOf = async (address: string) =>
  (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1))[0]?.state;
const jobStates = async () =>
  (await handle.db.select().from(dropJobs).orderBy(asc(dropJobs.id))).map((j) => j.state);

describe("the worker turn", () => {
  it("one turn runs every due job: three funded drops are seen, activated and paid in one turn", async () => {
    const funded = [await seedDrop(0n), await seedDrop(1n), await seedDrop(2n)];
    for (const d of funded) svm.fund(pubkeyFromBase58(d.address), d.grossRequired);
    const worker = workerWith();

    await worker.turn();
    // One poll saw all three, then each activate and each pay ran in the same turn.
    for (const d of funded) expect(await stateOf(d.address)).toBe("finished");
  });

  it("oldest first, at most 10 jobs per turn; the rest runs in the next turn", async () => {
    const ids = await trivialJobs(15);
    const worker = workerWith();

    await worker.turn();
    expect(await ranTrivial()).toEqual(ids.slice(0, 10));

    await worker.turn();
    expect(await ranTrivial()).toEqual(ids);
  });

  it("at most 30 seconds per turn: the running job finishes, no new one starts", async () => {
    await trivialJobs(5);
    let at = clock.getTime();
    // Every look at the clock is 11 seconds later: the second job would start past 30 seconds.
    const worker = workerWith({
      now: () => {
        at += 11_000;
        return new Date(at);
      },
    });

    await worker.turn();
    const ran = await ranTrivial();
    expect(ran.length).toBeGreaterThanOrEqual(1);
    expect(ran.length).toBeLessThan(5);
    expect((await jobStates()).filter((s) => s === "running")).toEqual([]);
  });

  it("the Solana funding poll runs at most once per turn, even when its rows are due again", async () => {
    await seedDrop(0n);
    await seedDrop(1n);
    // pollMs 0: every watch row is due again at once, so only the once per turn rule stops it.
    const worker = workerWith({ pollMs: 0 });
    const many = vi.spyOn(rpc, "getMultipleAccounts");

    await worker.turn();
    expect(many).toHaveBeenCalledTimes(1);
    expect(await jobStates()).toEqual(["ready", "ready"]);
  });

  it("a failed job is handled as before and never stops the rest of the turn", async () => {
    const d = await seedDrop(0n);
    svm.fund(pubkeyFromBase58(d.address), d.grossRequired);
    // The drop is already seen as funded: its activate job is the oldest due job of the turn.
    await handle.db.update(drops).set({ state: "funded" }).where(eq(drops.address, d.address));
    await handle.db.delete(dropJobs).where(eq(dropJobs.dropAddress, d.address));
    await handle.db.insert(dropJobs).values({
      dropAddress: d.address,
      kind: "activate",
      runAfter: new Date(clock.getTime() - 60_000),
    });
    await trivialJobs(2);
    vi.spyOn(rpc, "sendTransaction").mockRejectedValue(new Error("sendTransaction: http 500"));
    const worker = workerWith();

    await worker.turn();
    const activate = (
      await handle.db.select().from(dropJobs).where(eq(dropJobs.dropAddress, d.address))
    ).find((j) => j.kind === "activate");
    // One attempt more and a 5 s backoff, exactly as a single tick does it.
    expect(activate).toMatchObject({ state: "ready", attempts: 1 });
    expect(activate?.runAfter.getTime()).toBe(clock.getTime() + 5_000);
    expect(await stateOf(d.address)).toBe("funded");
    // The two trivial jobs after it still ran.
    expect(await ranTrivial()).toHaveLength(2);
  });
});
