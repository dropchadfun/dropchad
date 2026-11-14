/**
 * A late handle claim on Solana.8: the program answers
 * `BindingExpired` (6047) or `BindingTooLong` (6048), and the worker sends the binding back to
 * `bound`, so the next send signs it again. It is never marked `failed`.
 *
 * The program error reaches the worker by its code only. The simulation logs here end the way a
 * real cluster's do, with the program's `failed: custom program error` line, so the name must
 * come from the IDL error list, `programErrorName`.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { buildHandleDropTree, toHandleManifest } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { svmBinderFromSigner } from "../src/binder/binders.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner, signerFromSecret } from "../src/chain/svm/keypair.js";
import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { openAndMigrate } from "../src/db/client.js";
import { dropHandleLeaves, dropJobs, drops, handleBindings, profiles } from "../src/db/schema.js";
import { createDropEventBus } from "../src/worker/events.js";
import { createWorker } from "../src/worker/worker.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const PROGRAM = "EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft";
const WALLET: Pubkey = ed25519.getPublicKey(new Uint8Array(32).fill(9));
const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
/** The server's time, seconds. The cluster clock is moved away from it per test. */
const NOW = 1_800_000_000n;

/** The fake cluster, with simulation logs that end as a real cluster's do. */
function realisticRpc(svm: FakeSvm): SvmRpc {
  const rpc = createFakeSvmRpc(svm);
  return {
    ...rpc,
    async simulateTransaction(transaction, commitment) {
      const result = await rpc.simulateTransaction(transaction, commitment);
      if (result.err === null) return result;
      const detail = (result.err as { InstructionError?: [number, { Custom?: number }] })
        .InstructionError?.[1];
      const code = typeof detail === "object" ? (detail.Custom ?? 0) : 0;
      return {
        ...result,
        logs: [
          ...result.logs,
          `Program ${PROGRAM} consumed 12000 of 400000 compute units`,
          `Program ${PROGRAM} failed: custom program error: 0x${code.toString(16)}`,
        ],
      };
    },
  };
}

function world() {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    bindingV2: true,
  });
  svm.clock = NOW;
  const rpc = realisticRpc(svm);
  const known = new Set<string>();
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: (address) => Promise.resolve(known.has(address)),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    commitment: "confirmed",
    sleep: () => Promise.resolve(),
    bindingV2: true,
    // The relayer checks `valid_until` against the server's time, not the cluster's.
    nowSeconds: () => NOW,
  });
  const adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN, bindingV2: true });
  return { svm, adapter, known };
}

let handle: Awaited<ReturnType<typeof openAndMigrate>>;
let w: ReturnType<typeof world>;

beforeEach(async () => {
  w = world();
  handle = await openAndMigrate("memory://");

  const commitment = unblindedCommitment(1234567890n, 0n);
  const prediction = await w.adapter.predictDrop(commitment, 0n);
  const tree = buildHandleDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: [{ xId: 44196397n, amount: LEAF }],
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
  const address = created.drop;
  const entry = tree.entries[0] as (typeof tree.entries)[number];

  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
  await handle.db.insert(drops).values({
    address,
    chainId: 103,
    chainKey: "solana-devnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "11111111111111111111111111111111",
    merkleRoot: tree.root,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: JSON.stringify(toHandleManifest(tree), (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    totalEntitlements: tree.totalEntitlements.toString(),
    feeAmount: "0",
    grossRequired: tree.totalEntitlements.toString(),
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    fundingDeadline: 1_900_000_000n,
    claimPeriod: 2_592_000,
    mode: "handle",
    state: "active",
    createTxHash: "sig",
  });
  await handle.db.insert(dropHandleLeaves).values({
    dropAddress: address,
    leafIndex: entry.index,
    xUserId: entry.xId.toString(),
    amount: entry.amount.toString(),
  });
  await handle.db.insert(handleBindings).values({
    dropAddress: address,
    leafIndex: entry.index,
    xUserId: entry.xId.toString(),
    recipient: pubkeyToBase58(WALLET),
    binderSignature: `0x${"00".repeat(64)}`,
  });
  await handle.db.insert(dropJobs).values({
    dropAddress: address,
    kind: "claim_handles",
    state: "ready",
    runAfter: new Date(Number(NOW) * 1000),
  });
});

afterEach(async () => {
  await handle.close();
});

const worker = () =>
  createWorker({
    db: handle.db,
    chains: singleAdapter(w.adapter),
    events: createDropEventBus(),
    now: () => new Date(Number(NOW) * 1000),
    pollMs: 5_000,
    binders: {
      svm: svmBinderFromSigner(
        signerFromSecret(TEST_BINDER_ENV.BINDER_SOLANA_SECRET, "BINDER_SOLANA_SECRET"),
      ),
    },
  });

const binding = async () => (await handle.db.select().from(handleBindings))[0];

describe("a late handle claim on Solana.8", () => {
  it("the control: with the cluster on the server's time the claim is paid", async () => {
    await worker().tick();
    expect((await binding())?.state).toBe("paid");
  });

  it("BindingExpired (6047) sends the binding back to bound, never failed", async () => {
    w.svm.clock = NOW + 601n; // the cluster runs ahead of the server
    await worker().tick();
    const b = await binding();
    expect(b?.state).toBe("bound");
    expect(b?.lastError).toContain("BindingExpired");
  });

  it("BindingTooLong (6048) sends the binding back to bound too", async () => {
    w.svm.clock = NOW - 3_001n; // the server runs far ahead of the cluster
    await worker().tick();
    const b = await binding();
    expect(b?.state).toBe("bound");
    expect(b?.lastError).toContain("BindingTooLong");
  });
});
