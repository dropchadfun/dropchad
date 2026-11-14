/**
 * Solana `claim_handle`.
 * - `claim_handle` is the seventh relayer instruction
 * - its transaction is the compute budget, **one** Ed25519 instruction in the strict
 *   layout, and **one** `claim_handle` directly after it; the Ed25519 message must be the
 *   message for that very claim. An Ed25519 instruction anywhere else is refused
 * - guard 3 finds the drop at account position 2 for `claim_handle`
 * - one claim per transaction, and it fits at depth 9, 500 receivers
 * - a wrong binder key fails the simulation and nothing is sent
 * - the 16a worker pays a Solana handle drop end to end
 */
import { ed25519 } from "@noble/curves/ed25519";
import {
  base58Encode,
  buildHandleDropTree,
  ed25519InstructionData,
  svmBindingMessage,
  toHandleManifest,
} from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { hexToBytes, toHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import type { ChainAdapter } from "../src/chain/adapter.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import {
  claimHandleInstruction,
  claimInstruction,
  ed25519Instruction,
} from "../src/chain/svm/instructions.js";
import { randomSigner, type Signer } from "../src/chain/svm/keypair.js";
import { bitmapPda } from "../src/chain/svm/pda.js";
import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "../src/chain/svm/pubkey.js";
import {
  ALLOWED_INSTRUCTIONS,
  RelayerRefusedError,
  SimulationFailedError,
  checkInstructionShape,
  createSvmRelayer,
} from "../src/chain/svm/relayer.js";
import { openAndMigrate } from "../src/db/client.js";
import { dropHandleLeaves, dropJobs, drops, handleBindings, profiles } from "../src/db/schema.js";
import { createDropEventBus } from "../src/worker/events.js";
import { createWorker } from "../src/worker/worker.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const BINDER_SEED = new Uint8Array(32).fill(7);
const BINDER: Pubkey = ed25519.getPublicKey(BINDER_SEED);
const WALLET: Pubkey = ed25519.getPublicKey(new Uint8Array(32).fill(9));
const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";

interface World {
  svm: FakeSvm;
  signer: Signer;
  adapter: ChainAdapter;
  known: Set<string>;
}

function world(binder: Pubkey | undefined = BINDER): World {
  const signer = randomSigner();
  const svm = new FakeSvm({ relayer: signer.publicKey, defaultFeeBps: 100, binder });
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
  return { svm, signer, adapter: createSvmAdapter({ rpc, relayer, chain: CHAIN }), known };
}

/** A funded, active handle drop of `count` X ids; the claim goes to X id `firstXId + index`. */
async function activeHandleDrop(w: World, count = 2, firstXId = 44196397n) {
  const commitment = unblindedCommitment(1234567890n, 0n);
  const prediction = await w.adapter.predictDrop(commitment, 0n);
  const tree = buildHandleDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: Array.from({ length: count }, (_, i) => ({
      xId: firstXId + BigInt(i),
      amount: LEAF,
    })),
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
  const drop = pubkeyFromBase58(created.drop);
  w.svm.fund(drop, tree.totalEntitlements * 2n);
  await w.adapter.activate(created.drop);
  return { tree, drop, address: created.drop };
}

function bindingFor(
  drop: string,
  entry: { index: number; xId: bigint },
  recipient: Pubkey,
  seed = BINDER_SEED,
): Hex {
  const message = svmBindingMessage({
    drop,
    chainId: 103,
    index: entry.index,
    xId: entry.xId,
    recipient: pubkeyToBase58(recipient),
  });
  return toHex(ed25519.sign(message, seed));
}

describe("the seven instructions", () => {
  it("claim_handle is the seventh, and the relayer has a method for it", () => {
    expect([...ALLOWED_INSTRUCTIONS].sort()).toEqual(
      [
        "activate",
        "cancel_unfunded",
        "claim",
        "claim_handle",
        "close_drop",
        "create_drop",
        "refund",
      ].sort(),
    );
    expect(Object.keys(world().adapter.capabilities)).toContain("handleClaims");
    expect(world().adapter.capabilities.handleClaims).toBe(true);
  });
});

describe("the Ed25519 instruction, only in its one place", () => {
  const drop = ed25519.getPublicKey(new Uint8Array(32).fill(3));
  const caller = ed25519.getPublicKey(new Uint8Array(32).fill(4));
  const claimArgs = {
    caller,
    drop,
    bitmap: bitmapPda(drop).address,
    recipient: WALLET,
    index: 5,
    xId: 44196397n,
    amount: LEAF,
    proof: [new Uint8Array(32).fill(1)],
  };
  const message = svmBindingMessage({
    drop: pubkeyToBase58(drop),
    chainId: 103,
    index: 5,
    xId: 44196397n,
    recipient: pubkeyToBase58(WALLET),
  });
  const signature = ed25519.sign(message, BINDER_SEED);
  // Built inside each test, so a missing builder fails the test and not the file.
  const ed = () =>
    ed25519Instruction(ed25519InstructionData(base58Encode(BINDER), signature, message));
  const handle = () => claimHandleInstruction(claimArgs);

  it("takes one Ed25519 instruction directly before one claim_handle, and names the drop", () => {
    expect(pubkeyToBase58(checkInstructionShape("claim_handle", [ed(), handle()]))).toBe(
      pubkeyToBase58(drop),
    );
  });

  it("refuses claim_handle without it, after it, or with two of either", () => {
    expect(() => checkInstructionShape("claim_handle", [handle()])).toThrow(RelayerRefusedError);
    expect(() => checkInstructionShape("claim_handle", [handle(), ed()])).toThrow(
      RelayerRefusedError,
    );
    expect(() => checkInstructionShape("claim_handle", [ed(), ed(), handle()])).toThrow(
      RelayerRefusedError,
    );
    expect(() => checkInstructionShape("claim_handle", [ed(), handle(), ed(), handle()])).toThrow(
      RelayerRefusedError,
    );
  });

  it("refuses an Ed25519 instruction in any other transaction", () => {
    const claimIx = claimInstruction({ ...claimArgs });
    expect(() => checkInstructionShape("claim", [ed(), claimIx])).toThrow(RelayerRefusedError);
  });

  it("refuses a layout that is not byte for byte", () => {
    const data = ed25519InstructionData(base58Encode(BINDER), signature, message);
    const twoSignatures = new Uint8Array(data);
    twoSignatures[0] = 2;
    const paddingSet = new Uint8Array(data);
    paddingSet[1] = 1;
    const otherOffset = new Uint8Array(data);
    otherOffset[4] = 0; // the signature instruction index, must be u16::MAX
    for (const bad of [twoSignatures, paddingSet, otherOffset, data.slice(0, 200)]) {
      expect(() =>
        checkInstructionShape("claim_handle", [ed25519Instruction(bad), handle()]),
      ).toThrow(RelayerRefusedError);
    }
  });

  it("refuses a message for another claim: index, X id, recipient or drop", () => {
    const variants = [
      { index: 6 },
      { xId: 44196398n },
      { recipient: pubkeyToBase58(caller) },
      { drop: pubkeyToBase58(caller) },
    ];
    for (const change of variants) {
      const other = svmBindingMessage({
        drop: pubkeyToBase58(drop),
        chainId: 103,
        index: 5,
        xId: 44196397n,
        recipient: pubkeyToBase58(WALLET),
        ...change,
      });
      const ix = ed25519Instruction(
        ed25519InstructionData(base58Encode(BINDER), ed25519.sign(other, BINDER_SEED), other),
      );
      expect(() => checkInstructionShape("claim_handle", [ix, handle()])).toThrow(
        RelayerRefusedError,
      );
    }
  });
});

describe("claim_handle on the fake cluster", () => {
  it("pays the bound wallet, sets the bit, and reads HandleClaimed out of the log", async () => {
    const w = world();
    const { tree, drop, address } = await activeHandleDrop(w);
    const entry = tree.entries[0] as (typeof tree.entries)[number];
    const before = w.svm.lamportsOf(WALLET);

    const result = await w.adapter.claimHandle(address, {
      index: entry.index,
      xId: entry.xId,
      amount: entry.amount,
      recipient: pubkeyToBase58(WALLET),
      proof: entry.proof,
      signature: bindingFor(address, entry, WALLET),
    });
    expect(result.paid).toEqual({
      index: entry.index,
      recipient: pubkeyToBase58(WALLET),
      amount: entry.amount,
    });
    expect(w.svm.lamportsOf(WALLET) - before).toBe(entry.amount);
    expect(w.svm.executed.at(-1)).toBe("claim_handle");
    expect(
      (await w.adapter.readClaimed(pubkeyToBase58(drop), [entry.index])).has(entry.index),
    ).toBe(true);
  });

  it("refuses a drop this api did not create, before simulating", async () => {
    const w = world();
    const { tree, address } = await activeHandleDrop(w);
    w.known.clear();
    const entry = tree.entries[0] as (typeof tree.entries)[number];
    await expect(
      w.adapter.claimHandle(address, {
        index: entry.index,
        xId: entry.xId,
        amount: entry.amount,
        recipient: pubkeyToBase58(WALLET),
        proof: entry.proof,
        signature: bindingFor(address, entry, WALLET),
      }),
    ).rejects.toThrow(RelayerRefusedError);
  });

  it("a signature from another key fails the simulation, and nothing is sent", async () => {
    const w = world();
    const { tree, address } = await activeHandleDrop(w);
    const entry = tree.entries[0] as (typeof tree.entries)[number];
    const sent = w.svm.transactions.size;
    await expect(
      w.adapter.claimHandle(address, {
        index: entry.index,
        xId: entry.xId,
        amount: entry.amount,
        recipient: pubkeyToBase58(WALLET),
        proof: entry.proof,
        signature: bindingFor(address, entry, WALLET, new Uint8Array(32).fill(8)),
      }),
    ).rejects.toThrow(SimulationFailedError);
    expect(w.svm.transactions.size).toBe(sent);
  });

  it("a revoked binder in Config: binderLive is false and the claim is refused", async () => {
    const w = world();
    const { tree, address } = await activeHandleDrop(w);
    w.svm.setBinderRevoked(true);
    expect(await w.adapter.binderLive()).toBe(false);
    const entry = tree.entries[0] as (typeof tree.entries)[number];
    await expect(
      w.adapter.claimHandle(address, {
        index: entry.index,
        xId: entry.xId,
        amount: entry.amount,
        recipient: pubkeyToBase58(WALLET),
        proof: entry.proof,
        signature: bindingFor(address, entry, WALLET),
      }),
    ).rejects.toThrow(/BinderIsRevoked/);
  });

  it("one claim fits one transaction at depth 9, 500 receivers", async () => {
    const w = world();
    const { tree, address } = await activeHandleDrop(w, 500, 1_000_000n);
    // The deepest leaf: a 500 leaf tree is not full, so not every proof is 9 long.
    const entry = tree.entries.reduce((a, b) => (b.proof.length > a.proof.length ? b : a));
    expect(entry.proof).toHaveLength(9);
    const result = await w.adapter.claimHandle(address, {
      index: entry.index,
      xId: entry.xId,
      amount: entry.amount,
      recipient: pubkeyToBase58(WALLET),
      proof: entry.proof,
      signature: bindingFor(address, entry, WALLET),
    });
    expect(result.paid?.index).toBe(entry.index);
  });
});

describe("the 16a worker on Solana", () => {
  it("claims a bound Solana handle leaf and marks it paid", async () => {
    const w = world();
    const { tree, address } = await activeHandleDrop(w);
    const entry = tree.entries[1] as (typeof tree.entries)[number];
    const handle = await openAndMigrate("memory://");
    try {
      const now = new Date("2026-09-11T10:00:00.000Z");
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
      await handle.db.insert(dropHandleLeaves).values(
        tree.entries.map((e) => ({
          dropAddress: address,
          leafIndex: e.index,
          xUserId: e.xId.toString(),
          amount: e.amount.toString(),
        })),
      );
      await handle.db.insert(handleBindings).values({
        dropAddress: address,
        leafIndex: entry.index,
        xUserId: entry.xId.toString(),
        recipient: pubkeyToBase58(WALLET),
        binderSignature: bindingFor(address, entry, WALLET),
      });
      await handle.db
        .insert(dropJobs)
        .values({ dropAddress: address, kind: "claim_handles", state: "ready", runAfter: now });

      const worker = createWorker({
        db: handle.db,
        chains: singleAdapter(w.adapter),
        events: createDropEventBus(),
        now: () => new Date(Number(w.svm.clock) * 1000),
        pollMs: 5_000,
      });
      await worker.tick();
      const [binding] = await handle.db.select().from(handleBindings);
      expect(binding?.state).toBe("paid");
      expect(binding?.claimTxHash).toBeTruthy();
      expect(hexToBytes(binding?.binderSignature as Hex)).toHaveLength(64);
    } finally {
      await handle.close();
    }
  });
});
