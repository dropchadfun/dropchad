/**
 * A new send after an expiry
 * - at most 3 attempts, then `TransactionExpiredError`
 * - attempt 1 at the base price, each next attempt doubled, never above the cap; no price at a
 *   base of zero
 * - before a new send the last attempt is read again, and the `finalized` block height must be
 *   past its expiry; a late landing is the result and nothing is sent again
 * - a new send has the same instructions, a new blockhash and a new simulation; when the last
 *   attempt landed unseen, that simulation fails and nothing lands twice
 * - each attempt reserves and settles its own budget
 * - a claim between two attempts is reported as retrying, and only then
 */
import { ed25519 } from "@noble/curves/ed25519";
import {
  buildDropTree,
  buildHandleDropTree,
  svmBindingMessage,
  type Receiver,
} from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { toHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import type { ChainAdapter } from "../src/chain/adapter.js";
import { GasBudgetExceededError, type GasBudget } from "../src/chain/relayer.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "../src/chain/svm/pubkey.js";
import {
  SimulationFailedError,
  TransactionExpiredError,
  createSvmRelayer,
} from "../src/chain/svm/relayer.js";
import {
  FakeSvm,
  createFakeSvmRpc,
  decodeTransaction,
  rentFor,
  type FakeSvmRpcOptions,
} from "./fake-svm.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const ONE_SOL = 1_000_000_000n;
const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const BINDER_SEED = new Uint8Array(32).fill(7);
const BINDER: Pubkey = ed25519.getPublicKey(BINDER_SEED);
const WALLET: Pubkey = ed25519.getPublicKey(new Uint8Array(32).fill(9));

interface Budget {
  reserved: bigint[];
  settled: [bigint, bigint][];
}

function memoryBudget(limit: bigint): Budget & GasBudget {
  let spent = 0n;
  const state = {
    reserved: [] as bigint[],
    settled: [] as [bigint, bigint][],
    reserve(max: bigint) {
      if (spent + max > limit)
        return Promise.reject(new GasBudgetExceededError(spent + max, limit, "lamports"));
      spent += max;
      state.reserved.push(max);
      return Promise.resolve();
    },
    settle(reserved: bigint, actual: bigint) {
      spent = spent - reserved + actual;
      state.settled.push([reserved, actual]);
      return Promise.resolve();
    },
  };
  return state;
}

interface World {
  svm: FakeSvm;
  adapter: ChainAdapter;
  budget: Budget;
  known: Set<string>;
  log: string[];
}

function world(
  options: { rpc?: FakeSvmRpcOptions; base?: bigint; cap?: bigint; binder?: Pubkey } = {},
): World {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    ...(options.binder === undefined ? {} : { defaultFeeBps: 100, binder: options.binder }),
  });
  const log: string[] = [];
  const rpc = createFakeSvmRpc(svm, { log, ...options.rpc });
  const budget = memoryBudget(ONE_SOL);
  const known = new Set<string>();
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: (address) => Promise.resolve(known.has(address)),
    budget,
    caps: {
      maxComputeUnits: 400_000,
      priorityFeeMicroLamports: options.base ?? 200_000n,
      priorityFeeMaxMicroLamports: options.cap ?? 1_000_000n,
    },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    commitment: "confirmed",
    sleep: () => Promise.resolve(),
  });
  const adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN });
  return { svm, adapter, budget, known, log };
}

const receivers: Receiver<string>[] = [
  { recipient: "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB", amount: LEAF },
  { recipient: "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC", amount: LEAF },
];

/** A two leaf SOL drop through the adapter, the way `create.ts` does it. */
async function createDrop(w: World) {
  const commitment = unblindedCommitment(1234567890n, 0n);
  const prediction = await w.adapter.predictDrop(commitment, 0n);
  const tree = buildDropTree({ family: "svm", drop: prediction.address, chainId: 103, receivers });
  const created = await w.adapter.createDrop({
    merkleRoot: tree.root,
    manifestHash: `0x${"11".repeat(32)}`,
    totalEntitlements: tree.totalEntitlements,
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    creatorCommitment: commitment,
    nonce: 0n,
    fundingPeriod: 7 * 86_400,
    claimPeriod: 30 * 86_400,
  });
  return { created, predicted: prediction.address };
}

/** The `SetComputeUnitPrice` of a sent transaction, or `null` when it has none. */
function priceOf(bytes: Uint8Array): bigint | null {
  const { message } = decodeTransaction(bytes);
  for (const ix of message.instructions) {
    const program = pubkeyToBase58(message.accountKeys[ix.programIdIndex] as Uint8Array);
    if (program !== COMPUTE_BUDGET || ix.data[0] !== 3) continue;
    return new DataView(ix.data.buffer, ix.data.byteOffset + 1, 8).getBigUint64(0, true);
  }
  return null;
}

/** The instructions of a sent transaction other than the compute budget, as comparable text. */
function workOf(bytes: Uint8Array): string[] {
  const { message } = decodeTransaction(bytes);
  return message.instructions
    .filter(
      (ix) =>
        pubkeyToBase58(message.accountKeys[ix.programIdIndex] as Uint8Array) !== COMPUTE_BUDGET,
    )
    .map((ix) =>
      [
        pubkeyToBase58(message.accountKeys[ix.programIdIndex] as Uint8Array),
        ...ix.accountIndexes.map((i) => pubkeyToBase58(message.accountKeys[i] as Uint8Array)),
        toHex(ix.data),
      ].join(" "),
    );
}

const blockhashOf = (bytes: Uint8Array) => toHex(decodeTransaction(bytes).message.recentBlockhash);

describe("a new send after an expiry", () => {
  it("an expired create is sent again and lands on the second attempt, at twice the price", async () => {
    const w = world({ rpc: { dropSends: 1 } });
    const { created, predicted } = await createDrop(w);
    expect(created.drop).toBe(predicted);
    expect(w.svm.sent).toHaveLength(2);
    expect(w.svm.sent.map(priceOf)).toEqual([200_000n, 400_000n]);
    expect(w.svm.executed.filter((name) => name === "create_drop")).toHaveLength(1);
    expect(w.svm.drop(pubkeyFromBase58(created.drop))).not.toBeNull();
  });

  it("the price doubles and stops at the cap", async () => {
    const w = world({ rpc: { dropSends: 2 }, base: 400_000n, cap: 1_000_000n });
    await createDrop(w);
    expect(w.svm.sent.map(priceOf)).toEqual([400_000n, 800_000n, 1_000_000n]);
  });

  it("with no base price the attempts carry no price", async () => {
    const w = world({ rpc: { dropSends: 1 }, base: 0n, cap: 1_000_000n });
    await createDrop(w);
    expect(w.svm.sent.map(priceOf)).toEqual([null, null]);
  });

  it("three attempts at most, then TransactionExpiredError, every reservation returned", async () => {
    const w = world({ rpc: { dropSends: 99 } });
    await expect(createDrop(w)).rejects.toThrow(TransactionExpiredError);
    expect(w.svm.sent).toHaveLength(3);
    expect(w.svm.executed).toEqual([]);
    expect(w.budget.reserved).toHaveLength(3);
    expect(w.budget.settled.map(([, actual]) => actual)).toEqual([0n, 0n, 0n]);
  });

  it("an error other than an expiry is never sent again", async () => {
    const w = world();
    await createDrop(w);
    w.svm.sent.length = 0;
    // The same drop again: the simulation fails, nothing is sent.
    await expect(createDrop(w)).rejects.toThrow();
    expect(w.svm.sent).toHaveLength(0);
  });
});

describe("before a new send", () => {
  it("a send that landed late is the result, and nothing is sent again", async () => {
    const w = world({ rpc: { landLate: true } });
    const { created } = await createDrop(w);
    expect(w.svm.sent).toHaveLength(1);
    expect(w.svm.drop(pubkeyFromBase58(created.drop))).not.toBeNull();
  });

  it("waits for the finalized block height and reads the status again before a new send", async () => {
    const w = world({ rpc: { dropSends: 1 } });
    await createDrop(w);
    const sends = w.log.flatMap((entry, i) => (entry === "send" ? [i] : []));
    expect(sends).toHaveLength(2);
    const between = w.log.slice(sends[0], sends[1]);
    const lastFinalized = between.lastIndexOf("height:finalized");
    expect(lastFinalized).toBeGreaterThan(-1);
    expect(between.slice(lastFinalized)).toContain("status");
  });

  it("the same instructions, with a new blockhash", async () => {
    const w = world({ rpc: { dropSends: 1 } });
    await createDrop(w);
    const [first, second] = w.svm.sent as [Uint8Array, Uint8Array];
    expect(workOf(second)).toEqual(workOf(first));
    expect(blockhashOf(second)).not.toBe(blockhashOf(first));
  });

  it("a send that landed and is never seen is not sent twice: the new simulation fails", async () => {
    const w = world({ rpc: { neverConfirm: true } });
    await expect(createDrop(w)).rejects.toThrow(SimulationFailedError);
    expect(w.svm.sent).toHaveLength(1);
    expect(w.svm.executed.filter((name) => name === "create_drop")).toHaveLength(1);
  });
});

describe("the budget per attempt", () => {
  it("each attempt reserves its own worst case and settles it, 0 for the one that expired", async () => {
    const w = world({ rpc: { dropSends: 1 } });
    await createDrop(w);
    expect(w.budget.reserved).toHaveLength(2);
    expect(w.budget.settled).toHaveLength(2);
    expect(w.budget.settled[0]?.[1]).toBe(0n);
    expect(w.budget.settled[1]?.[1]).toBeGreaterThan(0n);
    // The second attempt carries twice the price, so its worst case is the larger one.
    expect((w.budget.reserved[1] as bigint) > (w.budget.reserved[0] as bigint)).toBe(true);
  });
});

/** A funded, active SOL handle drop of two X ids. */
async function activeHandleDrop(w: World) {
  const commitment = unblindedCommitment(1234567890n, 0n);
  const prediction = await w.adapter.predictDrop(commitment, 0n);
  const tree = buildHandleDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: [
      { xId: 1234567890123456789n, amount: LEAF },
      { xId: 1234567890123456790n, amount: LEAF },
    ],
  });
  const created = await w.adapter.createDrop({
    merkleRoot: tree.root,
    manifestHash: `0x${"11".repeat(32)}`,
    totalEntitlements: tree.totalEntitlements,
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    creatorCommitment: commitment,
    nonce: 0n,
    fundingPeriod: 7 * 86_400,
    claimPeriod: 30 * 86_400,
  });
  w.known.add(created.drop);
  w.svm.fund(pubkeyFromBase58(created.drop), tree.totalEntitlements * 2n);
  await w.adapter.activate(created.drop);
  return { tree, address: created.drop };
}

function bindingFor(drop: string, entry: { index: number; xId: bigint }): Hex {
  const message = svmBindingMessage({
    drop,
    chainId: 103,
    index: entry.index,
    xId: entry.xId,
    recipient: pubkeyToBase58(WALLET),
  });
  return toHex(ed25519.sign(message, BINDER_SEED));
}

describe("a claim between two attempts is retrying", () => {
  it("isRetrying is true only while that claim waits for its next attempt", async () => {
    // Send 1 is the create, send 2 the activate, send 3 the claim's first attempt: lost.
    const seen: { send: number; retrying: boolean; other: boolean }[] = [];
    let address = "";
    let index = -1;
    let otherIndex = -1;
    const w: World = world({
      binder: BINDER,
      rpc: {
        loseSends: [3],
        onSend: (count) => {
          if (count < 3) return;
          seen.push({
            send: count,
            retrying: w.adapter.isRetrying?.(address, index) === true,
            other: w.adapter.isRetrying?.(address, otherIndex) === true,
          });
        },
      },
    });
    const drop = await activeHandleDrop(w);
    address = drop.address;
    const entry = drop.tree.entries[0] as (typeof drop.tree.entries)[number];
    index = entry.index;
    otherIndex = (drop.tree.entries[1] as (typeof drop.tree.entries)[number]).index;
    expect(w.adapter.isRetrying?.(address, index)).toBe(false);

    const result = await w.adapter.claimHandle(address, {
      index: entry.index,
      xId: entry.xId,
      amount: entry.amount,
      recipient: pubkeyToBase58(WALLET),
      proof: entry.proof,
      signature: bindingFor(address, entry),
    });
    expect(result.paid?.index).toBe(entry.index);
    // The first attempt is not a retry; the second is, for this leaf only.
    expect(seen).toEqual([
      { send: 3, retrying: false, other: false },
      { send: 4, retrying: true, other: false },
    ]);
    expect(w.adapter.isRetrying?.(address, index)).toBe(false);
  });
});
