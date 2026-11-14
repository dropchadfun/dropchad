/**
 * One funding poll for every waiting Solana drop: the
 * turn that picks a Solana `watch_funding` job checks all waiting Solana drops in one batched
 * read, moves every watch row to the next poll, and a funded drop goes on exactly as before. A
 * read that fails changes nothing.
 */
import { buildDropTree, canonicalManifestJson, toManifest } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";
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
import type { DropEvent } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const FUNDING_PERIOD = 7 * 86_400;

let handle: DatabaseHandle;
let svm: FakeSvm;
let rpc: SvmRpc;
let adapter: ChainAdapter;
let worker: Worker;
let seen: DropEvent[];
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
    isKnownDrop: async (address) =>
      (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1)).length ===
      1,
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  adapter = createSvmAdapter({ rpc, relayer: svmRelayer, chain: CHAIN });
  seen = [];
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
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
});

/** A SOL drop on the fake cluster, our row and its `watch_funding` job, as `create.ts` does. */
async function seedDrop(nonce: bigint): Promise<{ address: string; grossRequired: bigint }> {
  const commitment = unblindedCommitment(1n, nonce);
  const prediction = await adapter.predictDrop(commitment, nonce);
  const tree = buildDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: [{ recipient: pubkeyToBase58(new Uint8Array(32).fill(0x20)), amount: LEAF }],
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

async function fiveDrops() {
  const out = [];
  for (let n = 0n; n < 5n; n++) out.push(await seedDrop(n));
  return out;
}

const stateOf = async (address: string) =>
  (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1))[0]?.state;
const jobsOf = (address: string) =>
  handle.db.select().from(dropJobs).where(eq(dropJobs.dropAddress, address));

describe("one funding poll for every waiting Solana drop", () => {
  it("one turn checks 5 waiting drops in one getMultipleAccounts, never one call per drop", async () => {
    const waiting = await fiveDrops();
    const many = vi.spyOn(rpc, "getMultipleAccounts");
    const one = vi.spyOn(rpc, "getAccountInfo");
    const balance = vi.spyOn(rpc, "getBalance");

    expect(await worker.tick()).toBe(true);
    expect(many).toHaveBeenCalledTimes(1);
    expect(many.mock.calls[0]?.[0].map(pubkeyToBase58).sort()).toEqual(
      waiting.map((d) => d.address).sort(),
    );
    expect(one).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();

    // Every watch row moved to the next poll, still waiting, no attempt counted.
    for (const d of waiting) {
      const [job] = await jobsOf(d.address);
      expect(job).toMatchObject({ kind: "watch_funding", state: "ready", attempts: 0 });
      expect(job?.runAfter.getTime()).toBe(clock.getTime() + 5_000);
      expect(await stateOf(d.address)).toBe("created");
    }
    // Nothing else is due until the next poll.
    expect(await worker.tick()).toBe(false);
  });

  it("a funded drop goes on exactly as before; the next turn activates it, not another poll", async () => {
    const waiting = await fiveDrops();
    const funded = waiting[2] as { address: string; grossRequired: bigint };
    svm.fund(pubkeyFromBase58(funded.address), funded.grossRequired);

    await worker.tick();
    expect(await stateOf(funded.address)).toBe("funded");
    expect(seen).toContainEqual({
      type: "funding_seen",
      drop: funded.address,
      balanceWei: funded.grossRequired.toString(),
    });
    const kinds = (await jobsOf(funded.address)).map((j) => `${j.kind}:${j.state}`).sort();
    expect(kinds).toEqual(["activate:ready", "watch_funding:done"]);
    for (const d of waiting.filter((w) => w !== funded))
      expect(await stateOf(d.address)).toBe("created");

    await worker.tick(); // the activate job, ahead of the next funding poll
    expect(await stateOf(funded.address)).toBe("active");
  });

  it("a read that fails changes nothing, even past the deadline; the next poll reads again", async () => {
    const waiting = await fiveDrops();
    const funded = waiting[0] as { address: string; grossRequired: bigint };
    svm.fund(pubkeyFromBase58(funded.address), funded.grossRequired);
    const many = vi
      .spyOn(rpc, "getMultipleAccounts")
      .mockRejectedValueOnce(new Error("getMultipleAccounts: http 429"));

    await worker.tick();
    for (const d of waiting) {
      expect(await stateOf(d.address)).toBe("created");
      const [job] = await jobsOf(d.address);
      expect(job).toMatchObject({ state: "ready", attempts: 0 });
    }
    expect(seen).toEqual([]);

    // Past the funding deadline, and the read fails again: still nothing marked expired.
    clock = new Date(clock.getTime() + (FUNDING_PERIOD + 100) * 1000);
    svm.clock += BigInt(FUNDING_PERIOD + 100);
    many.mockRejectedValueOnce(new Error("getMultipleAccounts: http 429"));
    await worker.tick();
    for (const d of waiting) expect(await stateOf(d.address)).toBe("created");

    // The next poll reads: the funded one goes on, the others end as before.
    clock = new Date(clock.getTime() + 5_000);
    await worker.tick();
    expect(await stateOf(funded.address)).toBe("funded");
    for (const d of waiting.slice(1)) expect(await stateOf(d.address)).toBe("funding_expired");
  });
});
