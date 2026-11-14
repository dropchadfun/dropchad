/**
 * Binding v2 in the api, the Solana side..0, 5.9 and 5.10,
 * - the switch `SOLANA_BINDING_V2`, off by default, read at start
 * - while on, every drop of the cluster is v2: the adapter builds the 200 byte message with
 *   `validUntil`, and the relayer takes only the 312 byte layout, `valid_until` between now and
 *   now plus one hour
 * - while off, v1 exactly as before: the relayer refuses a v2 message
 */
import { ed25519 } from "@noble/curves/ed25519";
import {
  base58Encode,
  buildHandleDropTree,
  ed25519InstructionData,
  svmBindingMessage,
  svmBindingMessageV2,
} from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { toHex } from "viem";
import { describe, expect, it } from "vitest";

import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { claimHandleInstruction, ed25519Instruction } from "../src/chain/svm/instructions.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { bitmapPda } from "../src/chain/svm/pda.js";
import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "../src/chain/svm/pubkey.js";
import {
  RelayerRefusedError,
  checkInstructionShape,
  createSvmRelayer,
} from "../src/chain/svm/relayer.js";
import { loadConfig } from "../src/config.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_ENV } from "./harness.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const BINDER_SEED = new Uint8Array(32).fill(7);
const BINDER: Pubkey = ed25519.getPublicKey(BINDER_SEED);
const WALLET: Pubkey = ed25519.getPublicKey(new Uint8Array(32).fill(9));
const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const NOW = 1_800_000_000n;

// -- the switch -------------------------------------------------------------------------------

describe("SOLANA_BINDING_V2.0", () => {
  it("is off by default", () => {
    expect(loadConfig(TEST_ENV).SOLANA_BINDING_V2).toBe("off");
  });

  it("takes on and off, nothing else", () => {
    expect(loadConfig({ ...TEST_ENV, SOLANA_BINDING_V2: "on" }).SOLANA_BINDING_V2).toBe("on");
    expect(() => loadConfig({ ...TEST_ENV, SOLANA_BINDING_V2: "yes" })).toThrow();
  });
});

// -- the relayer ------------------------------------------------------------------------------

describe("the relayer's Ed25519 check with binding v2.9", () => {
  const drop = pubkeyFromBase58("9ArT5gUTfmD81oKeNL66RhcWrK9nuaoxuJV2wH7QT9Ra");
  const caller = randomSigner().publicKey;
  const claimArgs = {
    caller,
    drop,
    bitmap: bitmapPda(drop).address,
    recipient: WALLET,
    index: 5,
    xId: 44196397n,
    amount: LEAF,
    proof: [],
  };
  const handle = () => claimHandleInstruction(claimArgs);
  const v2 = (validUntil: bigint, change: Record<string, unknown> = {}) =>
    svmBindingMessageV2({
      drop: pubkeyToBase58(drop),
      chainId: 103,
      index: 5,
      xId: 44196397n,
      recipient: pubkeyToBase58(WALLET),
      validUntil,
      ...change,
    });
  const ed = (message: Uint8Array) =>
    ed25519Instruction(
      ed25519InstructionData(base58Encode(BINDER), ed25519.sign(message, BINDER_SEED), message),
    );
  const v1 = svmBindingMessage({
    drop: pubkeyToBase58(drop),
    chainId: 103,
    index: 5,
    xId: 44196397n,
    recipient: pubkeyToBase58(WALLET),
  });
  const on = { bindingV2: true, nowSeconds: NOW };

  it("while on: takes the v2 message, valid_until now plus 600", () => {
    expect(
      pubkeyToBase58(checkInstructionShape("claim_handle", [ed(v2(NOW + 600n)), handle()], on)),
    ).toBe(pubkeyToBase58(drop));
  });

  it("while on: valid_until at now and at now plus 3600 are the edges that pass", () => {
    expect(() => checkInstructionShape("claim_handle", [ed(v2(NOW)), handle()], on)).not.toThrow();
    expect(() =>
      checkInstructionShape("claim_handle", [ed(v2(NOW + 3600n)), handle()], on),
    ).not.toThrow();
  });

  it("while on: refuses valid_until in the past or more than one hour ahead", () => {
    for (const until of [NOW - 1n, NOW + 3601n]) {
      expect(() => checkInstructionShape("claim_handle", [ed(v2(until)), handle()], on)).toThrow(
        RelayerRefusedError,
      );
    }
  });

  it("while on: refuses the v1 message", () => {
    expect(() => checkInstructionShape("claim_handle", [ed(v1), handle()], on)).toThrow(
      RelayerRefusedError,
    );
  });

  it("while on: refuses a v2 message for another claim", () => {
    for (const change of [
      { index: 6 },
      { xId: 44196398n },
      { recipient: pubkeyToBase58(caller) },
    ]) {
      expect(() =>
        checkInstructionShape("claim_handle", [ed(v2(NOW + 600n, change)), handle()], on),
      ).toThrow(RelayerRefusedError);
    }
  });

  it("while off: refuses the v2 message, takes the v1 one as before", () => {
    const off = { bindingV2: false, nowSeconds: NOW };
    expect(() =>
      checkInstructionShape("claim_handle", [ed(v2(NOW + 600n)), handle()], off),
    ).toThrow(RelayerRefusedError);
    expect(() => checkInstructionShape("claim_handle", [ed(v1), handle()], off)).not.toThrow();
    expect(() => checkInstructionShape("claim_handle", [ed(v1), handle()])).not.toThrow();
  });
});

// -- the adapter on the fake cluster ----------------------------------------------------------

function world(bindingV2: boolean) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: BINDER,
    bindingV2,
  });
  svm.clock = NOW;
  const rpc = createFakeSvmRpc(svm);
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
    bindingV2,
    nowSeconds: () => svm.clock,
  });
  const adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN, bindingV2 });
  return { svm, adapter, known };
}

async function activeHandleDrop(w: ReturnType<typeof world>) {
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
  return { tree, address: created.drop };
}

describe("the Solana adapter with binding v2.0", () => {
  it("while on, every drop is v2 and the chain's time is the cluster clock", async () => {
    const w = world(true);
    const { address } = await activeHandleDrop(w);
    expect(await w.adapter.bindingVersionOf?.(address)).toBe(2);
    expect(await w.adapter.chainTime?.()).toBe(NOW);
  });

  it("while off, every drop is v1", async () => {
    const w = world(false);
    const { address } = await activeHandleDrop(w);
    expect(await w.adapter.bindingVersionOf?.(address)).toBe(1);
  });

  it("while on, a claim with a v2 signature pays the bound wallet", async () => {
    const w = world(true);
    const { tree, address } = await activeHandleDrop(w);
    const entry = tree.entries[0] as (typeof tree.entries)[number];
    const validUntil = NOW + 600n;
    const message = svmBindingMessageV2({
      drop: address,
      chainId: 103,
      index: entry.index,
      xId: entry.xId,
      recipient: pubkeyToBase58(WALLET),
      validUntil,
    });
    const before = w.svm.lamportsOf(WALLET);
    const result = await w.adapter.claimHandle(address, {
      index: entry.index,
      xId: entry.xId,
      amount: entry.amount,
      recipient: pubkeyToBase58(WALLET),
      proof: entry.proof,
      signature: toHex(ed25519.sign(message, BINDER_SEED)),
      validUntil,
    });
    expect(result.paid?.amount).toBe(entry.amount);
    expect(w.svm.lamportsOf(WALLET) - before).toBe(entry.amount);
  });

  it("while on, a claim with no validUntil is refused before anything is sent", async () => {
    const w = world(true);
    const { tree, address } = await activeHandleDrop(w);
    const entry = tree.entries[0] as (typeof tree.entries)[number];
    await expect(
      w.adapter.claimHandle(address, {
        index: entry.index,
        xId: entry.xId,
        amount: entry.amount,
        recipient: pubkeyToBase58(WALLET),
        proof: entry.proof,
        signature: `0x${"ab".repeat(64)}`,
      }),
    ).rejects.toThrow(/validUntil/);
  });
});
