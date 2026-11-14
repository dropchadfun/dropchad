/**
 * The funding check backoff: the wait before
 * the next funding check of a drop not funded yet, by its age and its funding deadline. 5 s for
 * the first 10 minutes, 30 s to 1 hour, then 60 s, and 5 s again in the last 10 minutes. The same
 * rule on both chains; on Solana the batched read stays.
 */
import { buildDropTree, canonicalManifestJson, toManifest } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { FUNDING_CHECK_WAITS, FUNDING_PERIOD_SECONDS } from "../src/config.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles } from "../src/db/schema.js";
import { createDropEventBus } from "../src/worker/events.js";
import { createWorker, fundingCheckWaitMs, type Worker } from "../src/worker/worker.js";
import { adaptersFor, createFakeChain, FAKE_CHAIN_ID, type FakeChain } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("the wait before the next funding check", () => {
  const created = new Date("2026-09-11T10:00:00.000Z");
  const deadline = BigInt((created.getTime() + DAY) / 1000);
  const end = DAY;
  const waitAt = (ageMs: number) =>
    fundingCheckWaitMs(created, deadline, new Date(created.getTime() + ageMs));

  it("has its steps in config, with the values", () => {
    expect(FUNDING_CHECK_WAITS).toEqual({
      fastMs: 5_000,
      fastForMs: 10 * MIN,
      midMs: 30_000,
      midUntilMs: HOUR,
      slowMs: 60_000,
      lastFastMs: 10 * MIN,
    });
  });

  it("is 5 s in the first 10 minutes", () => {
    expect(waitAt(0)).toBe(5_000);
    expect(waitAt(5 * MIN)).toBe(5_000);
    expect(waitAt(10 * MIN - 1)).toBe(5_000);
  });

  it("is 30 s from exactly 10 minutes to 1 hour", () => {
    expect(waitAt(10 * MIN)).toBe(30_000);
    expect(waitAt(30 * MIN)).toBe(30_000);
    expect(waitAt(HOUR - 1)).toBe(30_000);
  });

  it("is 60 s from exactly 1 hour", () => {
    expect(waitAt(HOUR)).toBe(60_000);
    expect(waitAt(12 * HOUR)).toBe(60_000);
    expect(waitAt(end - 10 * MIN - 60_000)).toBe(60_000);
  });

  it("is 5 s again from exactly 10 minutes before the deadline", () => {
    expect(waitAt(end - 10 * MIN)).toBe(5_000);
    expect(waitAt(end - 5 * MIN)).toBe(5_000);
    expect(waitAt(end - 1_000)).toBe(5_000);
  });

  it("never runs past the start of the last 10 minutes", () => {
    expect(waitAt(end - 10 * MIN - 30_000)).toBe(30_000);
    expect(waitAt(end - 10 * MIN - 1)).toBe(1);
  });

  it("checks at 5 s when the last 10 minutes and the first 10 minutes meet", () => {
    const short = BigInt((created.getTime() + 15 * MIN) / 1000);
    const at = (ageMs: number) =>
      fundingCheckWaitMs(created, short, new Date(created.getTime() + ageMs));
    expect(at(0)).toBe(5_000);
    expect(at(6 * MIN)).toBe(5_000);
    expect(at(12 * MIN)).toBe(5_000);
  });

  it("gives a new drop's 1 hour window 320 checks, never the 60 s step", () => {
    const period = FUNDING_PERIOD_SECONDS * 1000;
    const until = BigInt((created.getTime() + period) / 1000);
    const waits = new Set<number>();
    let checks = 0;
    for (let age = 0; age < period; checks += 1) {
      const wait = fundingCheckWaitMs(created, until, new Date(created.getTime() + age));
      waits.add(wait);
      age += wait;
    }
    expect(checks).toBe(320);
    expect([...waits].sort((a, b) => a - b)).toEqual([5_000, 30_000]);
  });

  it("counts a drop whose created time is after the clock as just created", () => {
    expect(waitAt(-60_000)).toBe(5_000);
  });
});

describe("the backoff on the EVM worker", () => {
  const DROP = getAddress("0x00000000000000000000000000000000000d0000");
  const GROSS = 300_000_000_000_000n;
  const CREATED = new Date("2026-09-11T10:00:00.000Z");
  const DEADLINE = BigInt((CREATED.getTime() + DAY) / 1000);
  const END = CREATED.getTime() + DAY;

  let handle: DatabaseHandle;
  let chain: FakeChain;
  let worker: Worker;
  let clock: Date;

  beforeEach(async () => {
    handle = await openAndMigrate("memory://");
    chain = createFakeChain();
    clock = CREATED;
    worker = createWorker({
      db: handle.db,
      chains: adaptersFor(chain),
      events: createDropEventBus(),
      now: () => clock,
      pollMs: 5_000,
    });
    await handle.db
      .insert(profiles)
      .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
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
      manifestJson: JSON.stringify({ entries: [] }),
      totalEntitlements: GROSS.toString(),
      feeAmount: "0",
      grossRequired: GROSS.toString(),
      leafCount: 1,
      refundRecipient: "0x000000000000000000000000000000000000dEaD",
      fundingDeadline: DEADLINE,
      claimPeriod: 2_592_000,
      state: "created",
      createTxHash: `0x${"55".repeat(32)}`,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
    return () => handle.close();
  });

  async function watchFrom(at: number): Promise<void> {
    clock = new Date(at);
    await handle.db
      .insert(dropJobs)
      .values({ dropAddress: DROP.toLowerCase(), kind: "watch_funding", runAfter: clock });
  }

  const watchJob = async () =>
    (
      await handle.db.select().from(dropJobs).where(eq(dropJobs.dropAddress, DROP.toLowerCase()))
    ).find((j) => j.kind === "watch_funding");
  const state = async () =>
    (await handle.db.select().from(drops).where(eq(drops.address, DROP.toLowerCase())))[0]?.state;

  it.each([
    ["the first 10 minutes", CREATED.getTime(), 5_000],
    ["exactly 10 minutes", CREATED.getTime() + 10 * MIN, 30_000],
    ["exactly 1 hour", CREATED.getTime() + HOUR, 60_000],
    ["exactly 10 minutes before the deadline", END - 10 * MIN, 5_000],
  ])("%s: waits its step, then a drop funded in the wait is seen", async (_, at, wait) => {
    await watchFrom(at);
    expect(await worker.tick()).toBe(true);
    expect(await watchJob()).toMatchObject({ state: "ready", attempts: 0 });
    expect((await watchJob())?.runAfter.getTime()).toBe(at + wait);

    chain.setBalance(DROP, GROSS);
    clock = new Date(at + wait - 1);
    expect(await worker.tick()).toBe(false);
    clock = new Date(at + wait);
    expect(await worker.tick()).toBe(true);
    expect(await state()).toBe("funded");
  });

  it("cuts a wait to end where the last 10 minutes start", async () => {
    await watchFrom(END - 10 * MIN - 20_000);
    await worker.tick();
    expect((await watchJob())?.runAfter.getTime()).toBe(END - 10 * MIN);
  });

  it("sees a drop funded in the last 10 minutes before the deadline", async () => {
    await watchFrom(END - 10_000);
    await worker.tick();
    chain.setBalance(DROP, GROSS);
    clock = new Date(END - 5_000);
    expect(await worker.tick()).toBe(true);
    expect(await state()).toBe("funded");
    expect(clock.getTime()).toBeLessThan(Number(DEADLINE) * 1000);
  });
});

describe("the backoff in the Solana batch read", () => {
  const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
  const FUNDING_PERIOD = 86_400;

  let handle: DatabaseHandle;
  let svm: FakeSvm;
  let rpc: SvmRpc;
  let adapter: ChainAdapter;
  let worker: Worker;
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
    worker = createWorker({
      db: handle.db,
      chains: singleAdapter(adapter),
      events: { emit: () => undefined, subscribe: () => () => undefined, listenerCount: () => 0 },
      now: () => clock,
      pollMs: 5_000,
    });
    await handle.db
      .insert(profiles)
      .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
    return () => handle.close();
  });

  /** A SOL drop with its row and `watch_funding` job; `ageMs` sets its created time. */
  async function seedDrop(
    nonce: bigint,
    ageMs: number,
  ): Promise<{ address: string; grossRequired: bigint; deadline: bigint }> {
    const commitment = unblindedCommitment(1n, nonce);
    const prediction = await adapter.predictDrop(commitment, nonce);
    const tree = buildDropTree({
      family: "svm",
      drop: prediction.address,
      chainId: 103,
      receivers: [
        { recipient: pubkeyToBase58(new Uint8Array(32).fill(0x20)), amount: 10_000_000n },
      ],
    });
    const created = await adapter.createDrop({
      merkleRoot: tree.root,
      manifestHash: `0x${"11".repeat(32)}`,
      totalEntitlements: tree.totalEntitlements,
      leafCount: tree.leafCount,
      refundRecipient: "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH",
      creatorCommitment: commitment,
      nonce,
      fundingPeriod: FUNDING_PERIOD,
      claimPeriod: 30 * 86_400,
    });
    const createdAt = new Date(clock.getTime() - ageMs);
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
      refundRecipient: "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH",
      fundingDeadline: created.fundingDeadline,
      claimPeriod: 30 * 86_400,
      createTxHash: created.txId,
      createdAt,
      updatedAt: createdAt,
    });
    await handle.db
      .insert(dropJobs)
      .values({ dropAddress: created.drop, kind: "watch_funding", runAfter: clock });
    return {
      address: created.drop,
      grossRequired: created.grossRequired,
      deadline: created.fundingDeadline,
    };
  }

  const jobOf = async (address: string) =>
    (await handle.db.select().from(dropJobs).where(eq(dropJobs.dropAddress, address)))[0];
  const stateOf = async (address: string) =>
    (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1))[0]?.state;

  it("one batch read, each drop gets its own next check by its age", async () => {
    const young = await seedDrop(0n, 0);
    const old = await seedDrop(1n, 2 * HOUR);
    const many = vi.spyOn(rpc, "getMultipleAccounts");
    const start = clock.getTime();

    expect(await worker.tick()).toBe(true);
    expect(many).toHaveBeenCalledTimes(1);
    expect((await jobOf(young.address))?.runAfter.getTime()).toBe(start + 5_000);
    expect((await jobOf(old.address))?.runAfter.getTime()).toBe(start + 60_000);
  });

  it("an old drop funded in its wait is seen in the next batch a young drop starts", async () => {
    await seedDrop(0n, 0);
    const old = await seedDrop(1n, 2 * HOUR);
    await worker.tick();

    svm.fund(pubkeyFromBase58(old.address), old.grossRequired);
    clock = new Date(clock.getTime() + 5_000);
    expect(await worker.tick()).toBe(true);
    expect(await stateOf(old.address)).toBe("funded");
  });

  it("an old drop alone waits 60 s, then a drop funded in the wait is seen", async () => {
    const old = await seedDrop(0n, 2 * HOUR);
    const start = clock.getTime();
    await worker.tick();

    svm.fund(pubkeyFromBase58(old.address), old.grossRequired);
    clock = new Date(start + 30_000);
    expect(await worker.tick()).toBe(false);
    clock = new Date(start + 60_000);
    expect(await worker.tick()).toBe(true);
    expect(await stateOf(old.address)).toBe("funded");
  });

  it("a drop funded in the last 10 minutes is seen before the deadline", async () => {
    const d = await seedDrop(0n, 2 * HOUR);
    const deadlineMs = Number(d.deadline) * 1000;
    clock = new Date(deadlineMs - 9 * MIN);
    await worker.tick();
    expect((await jobOf(d.address))?.runAfter.getTime()).toBe(deadlineMs - 9 * MIN + 5_000);

    svm.fund(pubkeyFromBase58(d.address), d.grossRequired);
    clock = new Date(deadlineMs - 9 * MIN + 5_000);
    expect(await worker.tick()).toBe(true);
    expect(await stateOf(d.address)).toBe("funded");
    expect(clock.getTime()).toBeLessThan(deadlineMs);
  });
});
