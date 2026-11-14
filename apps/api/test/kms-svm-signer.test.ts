/**
 * The Solana signer backed by AWS KMS: the relayer's
 * transactions and the binder's message, pure Ed25519 over the raw bytes, against the fake
 * in `fake-kms.ts`. Ed25519 is deterministic, so a KMS signature equals the local key's byte for
 * byte. The real program run is in `litesvm.integration.test.ts`.
 */
import { ed25519 } from "@noble/curves/ed25519";
import {
  base58Encode,
  buildHandleDropTree,
  svmBindingMessage,
  type SvmBindingArgs,
} from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { toHex } from "viem";
import { describe, expect, it } from "vitest";

import { svmBinderFromSigner } from "../src/binder/binders.js";
import { KmsKeyError } from "../src/chain/kms.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { setComputeUnitLimit } from "../src/chain/svm/instructions.js";
import { signerFromSecret } from "../src/chain/svm/keypair.js";
import { kmsSolanaSigner } from "../src/chain/svm/kms-signer.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { compileMessage, signTransaction, verifySignature } from "../src/chain/svm/transaction.js";
import { createFakeKms } from "./fake-kms.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";

const RELAYER_SEED = new Uint8Array(32).fill(21);
const BINDER_SEED = new Uint8Array(32).fill(22);
const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const WALLET = ed25519.getPublicKey(new Uint8Array(32).fill(9));
const LEAF = 10_000_000n;

function kmsWith(options: { corrupt?: boolean } = {}) {
  const kms = createFakeKms();
  kms.addEd25519("relayer", RELAYER_SEED, options);
  kms.addEd25519("binder", BINDER_SEED, options);
  return kms;
}

const localRelayer = () =>
  signerFromSecret(JSON.stringify([...RELAYER_SEED, ...ed25519.getPublicKey(RELAYER_SEED)]));

describe("the KMS Solana signer", () => {
  it("takes its public key from GetPublicKey, the same as the local key", async () => {
    const kms = kmsWith();
    const signer = await kmsSolanaSigner(kms.client, "relayer");
    expect(signer.publicKey).toEqual(ed25519.getPublicKey(RELAYER_SEED));
    expect(kms.calls).toHaveLength(0);
  });

  it("refuses a key with the wrong spec or usage before any sign", async () => {
    const kms = createFakeKms();
    kms.addOther("evm", "ECC_SECG_P256K1", "SIGN_VERIFY");
    kms.addOther("crypt", "ECC_NIST_EDWARDS25519", "ENCRYPT_DECRYPT");
    kms.addOther("garbled", "ECC_NIST_EDWARDS25519", "SIGN_VERIFY");
    await expect(kmsSolanaSigner(kms.client, "evm")).rejects.toBeInstanceOf(KmsKeyError);
    await expect(kmsSolanaSigner(kms.client, "crypt")).rejects.toBeInstanceOf(KmsKeyError);
    await expect(kmsSolanaSigner(kms.client, "garbled")).rejects.toBeInstanceOf(KmsKeyError);
    expect(kms.calls).toHaveLength(0);
  });

  it("signs the raw bytes with ED25519_SHA_512 and RAW, equal to the local key", async () => {
    const kms = kmsWith();
    const signer = await kmsSolanaSigner(kms.client, "relayer");
    const message = new TextEncoder().encode("gm");
    const signature = await signer.sign(message);

    expect(signature).toHaveLength(64);
    expect(signature).toEqual(ed25519.sign(message, RELAYER_SEED));
    expect(kms.calls).toHaveLength(1);
    expect(kms.calls[0]?.algorithm).toBe("ED25519_SHA_512");
    expect(kms.calls[0]?.messageType).toBe("RAW");
    expect(kms.calls[0]?.message).toEqual(message);
  });

  it("signs a transaction byte for byte as the local key", async () => {
    const kms = kmsWith();
    const remote = await kmsSolanaSigner(kms.client, "relayer");
    const message = compileMessage({
      feePayer: remote.publicKey,
      recentBlockhash: new Uint8Array(32).fill(3),
      instructions: [setComputeUnitLimit(200_000)],
    });
    const tx = await signTransaction(message, [remote]);
    expect(verifySignature(tx)).toBe(true);
    expect(tx.bytes).toEqual((await signTransaction(message, [localRelayer()])).bytes);
  });

  it("refuses a KMS answer that does not verify against the key", async () => {
    const kms = kmsWith({ corrupt: true });
    const signer = await kmsSolanaSigner(kms.client, "relayer");
    await expect(signer.sign(new TextEncoder().encode("gm"))).rejects.toThrow();
  });

  it("a failed KMS sign rejects, nothing is returned", async () => {
    const kms = kmsWith();
    const signer = await kmsSolanaSigner(kms.client, "relayer");
    kms.failSigns(new Error("ThrottlingException"));
    await expect(signer.sign(new TextEncoder().encode("gm"))).rejects.toThrow(
      "ThrottlingException",
    );
  });

  it("refuses a message over the 4,096 byte RAW limit before calling KMS", async () => {
    const kms = kmsWith();
    const signer = await kmsSolanaSigner(kms.client, "relayer");
    await expect(signer.sign(new Uint8Array(4097))).rejects.toThrow();
    expect(kms.calls).toHaveLength(0);
  });
});

describe("the binder and the relayer on KMS Solana keys", () => {
  const args: SvmBindingArgs = {
    drop: pubkeyToBase58(new Uint8Array(32).fill(3)),
    chainId: 103,
    index: 0,
    xId: 44196397n,
    recipient: pubkeyToBase58(WALLET),
  };

  it("the binder signs the message with the KMS key", async () => {
    const kms = kmsWith();
    const binder = svmBinderFromSigner(await kmsSolanaSigner(kms.client, "binder"));
    expect(binder.publicKey).toBe(base58Encode(ed25519.getPublicKey(BINDER_SEED)));
    const signature = await binder.sign(args);
    expect(
      ed25519.verify(signature, svmBindingMessage(args), ed25519.getPublicKey(BINDER_SEED)),
    ).toBe(true);
  });

  it("a KMS relayer and a KMS binder pay a handle claim on the fake cluster", async () => {
    const kms = kmsWith();
    const signer = await kmsSolanaSigner(kms.client, "relayer");
    const binder = svmBinderFromSigner(await kmsSolanaSigner(kms.client, "binder"));
    const svm = new FakeSvm({
      relayer: signer.publicKey,
      defaultFeeBps: 100,
      binder: ed25519.getPublicKey(BINDER_SEED),
    });
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
    });
    const adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN });

    const commitment = unblindedCommitment(1234567890n, 0n);
    const prediction = await adapter.predictDrop(commitment, 0n);
    const tree = buildHandleDropTree({
      family: "svm",
      drop: prediction.address,
      chainId: 103,
      receivers: [{ xId: args.xId, amount: LEAF }],
    });
    const created = await adapter.createDrop({
      merkleRoot: tree.root,
      manifestHash: `0x${"11".repeat(32)}`,
      totalEntitlements: tree.totalEntitlements,
      leafCount: tree.leafCount,
      refundRecipient: pubkeyToBase58(signer.publicKey),
      creatorCommitment: commitment,
      nonce: 0n,
      fundingPeriod: 7 * 86_400,
      claimPeriod: 30 * 86_400,
    });
    known.add(created.drop);
    svm.fund(pubkeyFromBase58(created.drop), tree.totalEntitlements * 2n);
    await adapter.activate(created.drop);

    const entry = tree.entries[0] as (typeof tree.entries)[number];
    const before = svm.lamportsOf(WALLET);
    const result = await adapter.claimHandle(created.drop, {
      index: entry.index,
      xId: entry.xId,
      amount: entry.amount,
      recipient: pubkeyToBase58(WALLET),
      proof: entry.proof,
      signature: toHex(await binder.sign({ ...args, drop: created.drop, index: entry.index })),
    });
    expect(result.paid?.amount).toBe(LEAF);
    expect(svm.lamportsOf(WALLET) - before).toBe(LEAF);
    expect(kms.calls.filter((call) => call.keyId === "binder")).toHaveLength(1);
    expect(kms.calls.filter((call) => call.keyId === "relayer").length).toBeGreaterThan(0);
  });
});
