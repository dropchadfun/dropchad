/**
 * The Solana relayer and adapter against the fake cluster in `fake-svm.ts`.
 *
 * The fake decodes the transaction bytes the relayer signed and runs the program's rules, so
 * what is tested here is the real encoding, the real guards, the real account read back and
 * the real event parsing. No database: the budget is an in-memory `GasBudget`.
 */
import { buildDropTree, dropchadIdl, type Receiver } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { hexToBytes } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChainAdapter } from "../src/chain/adapter.js";
import {
  GasBudgetExceededError,
  RelayerRefusedError,
  type GasBudget,
} from "../src/chain/relayer.js";
import {
  SVM_STATUS_ACTIVE,
  SVM_STATUS_CANCELLED,
  SVM_STATUS_FINALIZED,
} from "../src/chain/svm/accounts.js";
import { createSvmAdapter, formatLamports, solClaimsPerTx } from "../src/chain/svm/adapter.js";
import { checkSolanaConfig, SolanaConfigMismatchError } from "../src/chain/svm/config-gate.js";
import { randomSigner, type Signer } from "../src/chain/svm/keypair.js";
import { bitmapPda, dropPda } from "../src/chain/svm/pda.js";
import {
  DEFAULT_PUBKEY_BASE58,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import {
  ALLOWED_INSTRUCTIONS,
  SimulationFailedError,
  TransactionExpiredError,
  createSvmRelayer,
  type SvmRelayer,
} from "../src/chain/svm/relayer.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { FakeSvm, createFakeSvmRpc, rentFor, type FakeSvmRpcOptions } from "./fake-svm.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const ONE_SOL = 1_000_000_000n;
const LEAF = 10_000_000n; // 0.01 SOL, well over the 890,880 lamport floor

interface World {
  svm: FakeSvm;
  signer: Signer;
  relayer: SvmRelayer;
  adapter: ChainAdapter;
  budget: { reserved: bigint[]; settled: [bigint, bigint][]; limit: bigint };
  known: Set<string>;
}

function memoryBudget(limit: bigint): World["budget"] & GasBudget {
  let spent = 0n;
  const state = {
    reserved: [] as bigint[],
    settled: [] as [bigint, bigint][],
    limit,
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

function world(
  options: {
    budgetLimit?: bigint;
    rpc?: FakeSvmRpcOptions;
    svm?: Partial<ConstructorParameters<typeof FakeSvm>[0]>;
  } = {},
): World {
  const signer = randomSigner();
  const svm = new FakeSvm({ relayer: signer.publicKey, ...options.svm });
  const rpc = createFakeSvmRpc(svm, options.rpc);
  const budget = memoryBudget(options.budgetLimit ?? ONE_SOL);
  const known = new Set<string>();
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: (address) => Promise.resolve(known.has(address)),
    budget,
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    commitment: "confirmed",
    sleep: () => Promise.resolve(),
  });
  const adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN });
  return { svm, signer, relayer, adapter, budget, known };
}

const receivers: Receiver<string>[] = [
  { recipient: "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB", amount: LEAF },
  { recipient: "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC", amount: LEAF },
  { recipient: "EnTJCS15dqbDTU2XywYSMaScoPv4Py4GzExrtY9DQxoD", amount: LEAF },
];
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";

/** Create a three leaf SOL drop through the adapter, the way `create.ts` does. */
async function createThree(w: World, nonce = 0n) {
  const commitment = unblindedCommitment(1234567890n, nonce);
  const prediction = await w.adapter.predictDrop(commitment, nonce);
  const tree = buildDropTree({ family: "svm", drop: prediction.address, chainId: 103, receivers });
  const created = await w.adapter.createDrop({
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
  w.known.add(created.drop);
  return { created, tree, drop: pubkeyFromBase58(created.drop) };
}

describe("the seven instructions, and no eighth", () => {
  it("allows exactly create_drop, activate, claim, refund, cancel_unfunded, close_drop, claim_handle", () => {
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
    // Every allowed name is a real instruction; none of the admin setters or sweep is allowed.
    const idlNames = new Set(dropchadIdl.instructions.map((ix) => ix.name));
    for (const name of ALLOWED_INSTRUCTIONS) expect(idlNames.has(name)).toBe(true);
    for (const forbidden of [
      "set_admin",
      "set_relayer",
      "set_paused",
      "set_fee_wallet",
      "set_default_fee_bps",
      "sweep",
      "initialize_config",
    ]) {
      expect((ALLOWED_INSTRUCTIONS as readonly string[]).includes(forbidden)).toBe(false);
    }
  });

  it("exposes seven sending methods and two public fields, nothing else", () => {
    const w = world();
    expect(Object.keys(w.relayer).sort()).toEqual(
      [
        "activate",
        "address",
        "cancelUnfunded",
        "claimBatch",
        "claimHandle",
        "closeDrop",
        "createDrop",
        "publicKey",
        "refund",
      ].sort(),
    );
  });

  it("never builds a System program instruction: only dropchad and compute budget touch the wire", async () => {
    const w = world();
    const { drop } = await createThree(w);
    w.svm.fund(drop, LEAF * 3n);
    await w.adapter.activate(pubkeyToBase58(drop));
    // The fake throws on any program it does not know, so reaching here proves it.
    expect(w.svm.executed).toEqual(["create_drop", "activate"]);
  });
});

describe("guard 3, the destination must be known", () => {
  it("refuses activate, claim, refund, cancel and close for a drop not in our table", async () => {
    const w = world();
    const { created, tree, drop } = await createThree(w);
    w.known.clear();
    const address = created.drop;
    w.svm.fund(drop, LEAF * 3n);
    await expect(w.adapter.activate(address)).rejects.toThrow(RelayerRefusedError);
    await expect(
      w.adapter.claimBatch(address, [
        {
          index: 0,
          recipient: tree.entries[0]?.recipient ?? "",
          amount: LEAF,
          proof: tree.entries[0]?.proof ?? [],
        },
      ]),
    ).rejects.toThrow(/not a drop this api created/);
    await expect(w.adapter.refund(address)).rejects.toThrow(RelayerRefusedError);
    await expect(w.adapter.cancelUnfunded(address)).rejects.toThrow(RelayerRefusedError);
    await expect(w.adapter.closeDrop(address)).rejects.toThrow(RelayerRefusedError);
    expect(w.svm.executed).toEqual(["create_drop"]);
  });
});

describe("guard 4, simulate, cap, budget", () => {
  it("refuses a transaction that would fail, naming the program error, and sends nothing", async () => {
    const w = world();
    const { created } = await createThree(w);
    // Not funded: activate fails with Underfunded in simulation.
    const error = await w.adapter.activate(created.drop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SimulationFailedError);
    expect((error as SimulationFailedError).programError).toBe("Underfunded");
    expect(w.svm.executed).toEqual(["create_drop"]);
    // Nothing was reserved for the refused send.
    expect(w.budget.reserved).toHaveLength(1);
  });

  it("charges the worst case before the send and settles to what the relayer really spent", async () => {
    const w = world();
    const before = w.svm.lamportsOf(w.signer.publicKey);
    const { created } = await createThree(w);
    const rent = rentFor(424) + rentFor(1291);
    // create_drop reserves fee plus rent, then settles to the actual balance change.
    expect(w.budget.reserved[0]).toBe(5_000n + rent);
    expect(w.budget.settled[0]).toEqual([
      5_000n + rent,
      before - w.svm.lamportsOf(w.signer.publicKey),
    ]);
    expect(before - w.svm.lamportsOf(w.signer.publicKey)).toBe(5_000n + rent);
    expect(created.drop).toBe(
      pubkeyToBase58(dropPda(hexToBytes(unblindedCommitment(1234567890n, 0n)), 0n).address),
    );
  });

  it("refuses when the day's lamport budget would be exceeded", async () => {
    const w = world({ budgetLimit: 1_000n });
    await expect(createThree(w)).rejects.toThrow(GasBudgetExceededError);
    await expect(createThree(w)).rejects.toThrow(/lamports/);
    expect(w.svm.executed).toEqual([]);
  });

  it("gives up when the blockhash expires and returns the reservation", async () => {
    const w = world({ rpc: { neverConfirm: true } });
    await expect(createThree(w)).rejects.toThrow(TransactionExpiredError);
    expect(w.budget.settled.at(-1)?.[1]).toBe(0n);
  });
});

describe("the adapter rule by rule", () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it("predicts the PDA and reports it taken once the account exists", async () => {
    const commitment = unblindedCommitment(1234567890n, 0n);
    const first = await w.adapter.predictDrop(commitment, 0n);
    expect(first.taken).toBe(false);
    expect(first.address).toBe(pubkeyToBase58(dropPda(hexToBytes(commitment), 0n).address));
    await createThree(w);
    const again = await w.adapter.predictDrop(commitment, 0n);
    expect(again.taken).toBe(true);
    // The next nonce is free.
    expect((await w.adapter.predictDrop(unblindedCommitment(1234567890n, 1n), 1n)).taken).toBe(
      false,
    );
  });

  it("reads the drop account back field by field after create_drop", async () => {
    const { created, tree } = await createThree(w);
    expect(created.merkleRoot).toBe(tree.root);
    expect(created.manifestHash).toBe(`0x${"11".repeat(32)}`);
    expect(created.totalEntitlements).toBe(LEAF * 3n);
    expect(created.leafCount).toBe(3);
    expect(created.refundRecipient).toBe(REFUND);
    expect(created.asset).toBe(DEFAULT_PUBKEY_BASE58);
    expect(created.feeAmount).toBe(0n);
    expect(created.grossRequired).toBe(LEAF * 3n);
    expect(created.fundingDeadline).toBe(w.svm.clock + BigInt(7 * 86_400));
    expect(created.claimPeriod).toBe(30 * 86_400);
    expect(created.salt).toBeNull();
    expect(created.txId.length).toBeGreaterThan(40);
  });

  it("counts only lamports above the rent minimum as spendable", async () => {
    const { created, drop } = await createThree(w);
    expect(await w.adapter.getSpendableBalance(created.drop)).toBe(0n);
    w.svm.fund(drop, 1n);
    expect(await w.adapter.getSpendableBalance(created.drop)).toBe(1n);
    w.svm.fund(drop, LEAF * 3n);
    expect(await w.adapter.getSpendableBalance(created.drop)).toBe(LEAF * 3n + 1n);
  });

  it("activates with the fee wallet from the drop, then pays a batch and reports the Claimed events", async () => {
    const { created, tree, drop } = await createThree(w);
    w.svm.fund(drop, LEAF * 3n);
    const activated = await w.adapter.activate(created.drop);
    expect(activated.cost).toBe(5_000n);
    expect((await w.adapter.readDrop(created.drop)).status).toBe(SVM_STATUS_ACTIVE);

    const items = tree.entries.map((e) => ({
      index: e.index,
      recipient: e.recipient,
      amount: e.amount,
      proof: e.proof,
    }));
    const result = await w.adapter.claimBatch(created.drop, items);
    expect(result.paid.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(result.paid.map((p) => p.recipient)).toEqual(items.map((i) => i.recipient));
    expect(result.paid.every((p) => p.amount === LEAF)).toBe(true);
    expect(w.svm.lamportsOf(pubkeyFromBase58(items[0]?.recipient ?? ""))).toBe(LEAF);
    expect(w.svm.executed).toEqual(["create_drop", "activate", "claim", "claim", "claim"]);

    const claimed = await w.adapter.readClaimed(created.drop, [0, 1, 2]);
    expect([...claimed].sort()).toEqual([0, 1, 2]);
    const onChain = await w.adapter.readDrop(created.drop);
    expect(onChain.claimedCount).toBe(3);
    expect(onChain.totalClaimed).toBe(LEAF * 3n);
  });

  it("reads the bitmap so an already claimed leaf is never sent", async () => {
    const { created, drop } = await createThree(w);
    w.svm.fund(drop, LEAF * 3n);
    await w.adapter.activate(created.drop);
    w.svm.setClaimed(drop, 1);
    const claimed = await w.adapter.readClaimed(created.drop, [0, 1, 2]);
    expect([...claimed]).toEqual([1]);
  });

  it("fails the whole transaction when one claim in it fails, writing nothing", async () => {
    const { created, tree, drop } = await createThree(w);
    w.svm.fund(drop, LEAF * 3n);
    await w.adapter.activate(created.drop);
    w.svm.failingIndexes.add(1);
    const items = tree.entries.map((e) => ({
      index: e.index,
      recipient: e.recipient,
      amount: e.amount,
      proof: e.proof,
    }));
    await expect(w.adapter.claimBatch(created.drop, items)).rejects.toThrow(SimulationFailedError);
    expect(await w.adapter.readClaimed(created.drop, [0, 1, 2])).toEqual(new Set());
    // Without the bad leaf it goes through.
    const result = await w.adapter.claimBatch(
      created.drop,
      items.filter((i) => i.index !== 1),
    );
    expect(result.paid.map((p) => p.index)).toEqual([0, 2]);
  });

  it("refunds after the claim deadline and closes, rent back to the relayer", async () => {
    const { created, tree, drop } = await createThree(w);
    w.svm.fund(drop, LEAF * 3n);
    await w.adapter.activate(created.drop);
    const first = tree.entries[0];
    if (first === undefined) throw new Error("no entries");
    await w.adapter.claimBatch(created.drop, [
      { index: 0, recipient: first.recipient, amount: first.amount, proof: first.proof },
    ]);

    await expect(w.adapter.refund(created.drop)).rejects.toThrow(/ClaimWindowOpen/);
    w.svm.clock += BigInt(30 * 86_400 + 1);
    const refundKey = pubkeyFromBase58(REFUND);
    await w.adapter.refund(created.drop);
    expect(w.svm.lamportsOf(refundKey)).toBe(LEAF * 2n);
    expect((await w.adapter.readDrop(created.drop)).status).toBe(SVM_STATUS_FINALIZED);

    const relayerBefore = w.svm.lamportsOf(w.signer.publicKey);
    await w.adapter.closeDrop(created.drop);
    const after = await w.adapter.readDrop(created.drop);
    expect(after.closed).toBe(true);
    expect(after.status).toBe(SVM_STATUS_FINALIZED);
    // The bitmap rent came back, minus the fee for the close. The drop account stays.
    expect(w.svm.lamportsOf(w.signer.publicKey)).toBe(relayerBefore + rentFor(1291) - 5_000n);
    expect(w.svm.accounts.has(pubkeyToBase58(bitmapPda(drop).address))).toBe(false);
    expect(w.svm.drop(drop)).not.toBeNull();
    // A closed drop reads every leaf as spoken for.
    expect(await w.adapter.readClaimed(created.drop, [0, 1, 2])).toEqual(new Set([0, 1, 2]));
  });

  it("cancels an unfunded drop after the funding deadline and closes it", async () => {
    const { created, drop } = await createThree(w);
    w.svm.fund(drop, LEAF); // partial
    await expect(w.adapter.cancelUnfunded(created.drop)).rejects.toThrow(/FundingStillOpen/);
    w.svm.clock += BigInt(7 * 86_400 + 1);
    await w.adapter.cancelUnfunded(created.drop);
    expect(w.svm.lamportsOf(pubkeyFromBase58(REFUND))).toBe(LEAF);
    expect((await w.adapter.readDrop(created.drop)).status).toBe(SVM_STATUS_CANCELLED);
    await w.adapter.closeDrop(created.drop);
    expect((await w.adapter.readDrop(created.drop)).closed).toBe(true);
  });

  it("reports the six capabilities honestly and the Solana Pay funding card", () => {
    expect(w.adapter.capabilities).toEqual({
      refund: true,
      cancelUnfunded: true,
      close: true,
      handleClaims: true,
    });
    const funding = w.adapter.fundingInstructions({
      drop: "G5wphfR2mffv3dd2yWb5eFioBf1BFGVtAZfbG6CXQbh5",
      amount: 30_000_000n,
      fundingDeadline: 1_800_604_800n,
    });
    expect(funding.paymentUri).toBe(
      "solana:G5wphfR2mffv3dd2yWb5eFioBf1BFGVtAZfbG6CXQbh5?amount=0.03",
    );
    expect(funding.amountDisplay).toBe("0.03");
    expect(funding.amountBaseUnits).toBe("30000000");
    expect(funding.symbol).toBe("SOL");
    expect(funding.decimals).toBe(9);
    expect(funding.family).toBe("svm");
    expect(funding.chainId).toBe(103);
  });

  it("refuses a SOL leaf under the rent floor and a non key", () => {
    expect(() => w.adapter.normalizeReceivers([{ recipient: REFUND, amount: 890_879n }])).toThrow(
      /890880/,
    );
    expect(w.adapter.normalizeReceivers([{ recipient: REFUND, amount: 890_880n }])).toHaveLength(1);
    expect(() =>
      w.adapter.normalizeReceivers([
        { recipient: "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD", amount: LEAF },
      ]),
    ).toThrow(/public key/);
    expect(() => w.adapter.parseAddress("nope")).toThrow(/public key/);
  });
});

describe("the fit table and formatting", () => {
  it("follows, SOL column", () => {
    expect(solClaimsPerTx(1)).toBe(9);
    expect(solClaimsPerTx(2)).toBe(9);
    expect(solClaimsPerTx(3)).toBe(7);
    expect(solClaimsPerTx(4)).toBe(7);
    expect(solClaimsPerTx(5)).toBe(5);
    expect(solClaimsPerTx(8)).toBe(5);
    expect(solClaimsPerTx(9)).toBe(4);
    expect(solClaimsPerTx(32)).toBe(4);
    expect(solClaimsPerTx(33)).toBe(3);
    expect(solClaimsPerTx(128)).toBe(3);
    expect(solClaimsPerTx(129)).toBe(2);
    expect(solClaimsPerTx(4096)).toBe(2);
    expect(solClaimsPerTx(4097)).toBe(1);
    expect(solClaimsPerTx(10_000)).toBe(1);
  });

  it("formats lamports as whole SOL without trailing zeros", () => {
    expect(formatLamports(0n)).toBe("0");
    expect(formatLamports(1n)).toBe("0.000000001");
    expect(formatLamports(890_880n)).toBe("0.00089088");
    expect(formatLamports(ONE_SOL)).toBe("1");
    expect(formatLamports(1_500_000_000n)).toBe("1.5");
  });
});

describe("the config gate", () => {
  const expected = (relayer: Pubkey) => ({ relayer, chainId: 103n, chainKey: "solana-devnet" });

  it("reports a missing config with the script to run", async () => {
    const signer = randomSigner();
    const svm = new FakeSvm({ relayer: signer.publicKey, withConfig: false });
    const check = await checkSolanaConfig(createFakeSvmRpc(svm), expected(signer.publicKey));
    expect(check.kind).toBe("missing");
    if (check.kind === "missing") {
      expect(check.hint).toContain("init-solana-config");
      expect(check.configAddress).toBe("bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD");
    }
  });

  it("refuses another relayer or another chain id, naming both values", async () => {
    const signer = randomSigner();
    const svm = new FakeSvm({ relayer: signer.publicKey });
    const stranger = randomSigner().publicKey;
    await expect(checkSolanaConfig(createFakeSvmRpc(svm), expected(stranger))).rejects.toThrow(
      SolanaConfigMismatchError,
    );
    await expect(checkSolanaConfig(createFakeSvmRpc(svm), expected(stranger))).rejects.toThrow(
      new RegExp(pubkeyToBase58(stranger)),
    );
    await expect(
      checkSolanaConfig(createFakeSvmRpc(svm), { ...expected(signer.publicKey), chainId: 101n }),
    ).rejects.toThrow(/chain_id 103/);
  });

  it("passes when the config names us and the cluster", async () => {
    const signer = randomSigner();
    const svm = new FakeSvm({ relayer: signer.publicKey });
    const check = await checkSolanaConfig(createFakeSvmRpc(svm), expected(signer.publicKey));
    expect(check.kind).toBe("ok");
    if (check.kind === "ok") {
      expect(check.config.defaultFeeBps).toBe(0);
      expect(check.config.paused).toBe(false);
      expect(pubkeyToBase58(check.config.relayer)).toBe(pubkeyToBase58(signer.publicKey));
    }
  });
});
