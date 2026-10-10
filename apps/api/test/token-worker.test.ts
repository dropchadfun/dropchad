/**
 * the worker for token drops.
 * -: a token `claim_handle` fits at depth 9 only without compute budget instructions, so
 *   it carries none; the relayer still refuses one above the default 200,000 units
 * - the five instructions carry the token accounts in the IDL order; SOL drops are unchanged
 * -: funded only when the vault holds the tokens **and** the SOL above rent covers the
 *   fee and the account budget; one part alone is not funded
 * - the worker end to end: watch, activate, claim with the
 *   receiver's token account and the rent paid back, refund, cancel and close with the sender's
 *   token account
 * - the token accounts must be the drop's own, else the simulation fails and nothing is sent
 *
 * No socket: `test/fake-svm.ts` is the cluster.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { buildHandleDropTree, svmBindingMessage, toHandleManifest } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";
import { toHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import {
  SVM_STATUS_ACTIVE,
  SVM_STATUS_CANCELLED,
  SVM_STATUS_FINALIZED,
} from "../src/chain/svm/accounts.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import {
  activateInstruction,
  cancelUnfundedInstruction,
  claimHandleInstruction,
  closeDropInstruction,
  ed25519Instruction,
  refundInstruction,
  setComputeUnitLimit,
  setComputeUnitPrice,
} from "../src/chain/svm/instructions.js";
import { randomSigner, type Signer } from "../src/chain/svm/keypair.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  bitmapPda,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/chain/svm/pda.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  DROPCHAD_PROGRAM_ID,
  pubkeyEquals,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import {
  ComputeCapExceededError,
  SimulationFailedError,
  createSvmRelayer,
  type SvmRelayer,
} from "../src/chain/svm/relayer.js";
import { MAX_TRANSACTION_BYTES, transactionSize } from "../src/chain/svm/transaction.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropHandleLeaves, dropJobs, drops, handleBindings, profiles } from "../src/db/schema.js";
import type { DropEvent } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { FakeSvm, createFakeSvmRpc, decodeTransaction, rentFor } from "./fake-svm.js";
import { classicMintData, fromB64, PUMP_MINT, PUMP_MINT_DATA } from "./token-fixtures.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const BINDER_SEED = new Uint8Array(32).fill(7);
const BINDER: Pubkey = ed25519.getPublicKey(BINDER_SEED);
const FUNDING_PERIOD = 7 * 86_400;
const CLAIM_PERIOD = 30 * 86_400;
/** Past a deadline by more than the settle job's 120 s copy margin. */
const PAST_MARGIN = 200;
/** 1 token at 6 decimals per person. */
const TOKENS = 1_000_000n;
/** A token drop's SOL fee, any value under the 1 SOL cap. */
const SOL_FEE = 100_000_000n;
/** A classic mint with no freeze authority, made up for these tests. */
const CLASSIC_MINT: Pubkey = new Uint8Array(32).fill(0x5c);

/** A wallet on the ed25519 curve, as the bind route requires. */
const wallet = (seed: number): Pubkey => ed25519.getPublicKey(new Uint8Array(32).fill(seed));

let handle: DatabaseHandle;
let svm: FakeSvm;
let signer: Signer;
let relayer: SvmRelayer;
let adapter: ChainAdapter;
let rpc: SvmRpc;
let worker: Worker;
let seen: DropEvent[];
let clock: Date;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  signer = randomSigner();
  svm = new FakeSvm({
    relayer: signer.publicKey,
    feeWallet: wallet(0x0f),
    binder: BINDER,
    relayerLamports: 50_000_000_000n,
  });
  clock = new Date(Number(svm.clock) * 1000);
  rpc = createFakeSvmRpc(svm);
  relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: async (address) =>
      (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1)).length ===
      1,
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN });
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
    // A price is there: the token drop must still get none.
    prices: { usdPrice: () => Promise.resolve(150) },
  });
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
});

/** Move both clocks, the worker's and the cluster's. */
function advance(seconds: number) {
  svm.clock += BigInt(seconds);
  clock = new Date(Number(svm.clock) * 1000);
}

interface TokenDrop {
  readonly address: string;
  readonly drop: Pubkey;
  readonly mint: Pubkey;
  readonly tokenProgram: Pubkey;
  readonly vault: Pubkey;
  readonly budget: bigint;
  readonly tree: ReturnType<typeof buildHandleDropTree>;
}

/** A token handle drop made the way `create.ts` makes it: the chain, our row, the first job. */
async function seedTokenDrop(
  options: { count?: number; kind?: "classic" | "2022"; nonce?: bigint } = {},
): Promise<TokenDrop> {
  const count = options.count ?? 3;
  const nonce = options.nonce ?? 0n;
  const is2022 = options.kind === "2022";
  const mint = is2022 ? pubkeyFromBase58(PUMP_MINT) : CLASSIC_MINT;
  const tokenProgram = is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  if (svm.ownerOf(mint) === null) {
    svm.putAccount(
      mint,
      tokenProgram,
      is2022 ? fromB64(PUMP_MINT_DATA) : classicMintData({ decimals: 6 }),
    );
  }
  const commitment = unblindedCommitment(1n, nonce);
  const prediction = await adapter.predictDrop(commitment, nonce);
  const tree = buildHandleDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: Array.from({ length: count }, (_, i) => ({
      xId: 5_000_000n + BigInt(i),
      amount: TOKENS,
    })),
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
    token: {
      mint: pubkeyToBase58(mint),
      tokenProgram: pubkeyToBase58(tokenProgram),
      solFeeLamports: SOL_FEE,
    },
  });
  const drop = pubkeyFromBase58(created.drop);
  const onChain = svm.drop(drop);
  if (onChain === null) throw new Error("no drop");
  await handle.db.insert(drops).values({
    address: created.drop,
    chainId: 103,
    chainKey: "solana-devnet",
    xUserId: "1",
    nonce,
    creatorCommitment: commitment,
    salt: null,
    asset: pubkeyToBase58(mint),
    merkleRoot: tree.root,
    manifestHash: created.manifestHash,
    manifestJson: JSON.stringify(toHandleManifest(tree), (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    totalEntitlements: tree.totalEntitlements.toString(),
    feeAmount: "0",
    grossRequired: tree.totalEntitlements.toString(),
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    fundingDeadline: created.fundingDeadline,
    claimPeriod: CLAIM_PERIOD,
    mode: "handle",
    createTxHash: created.txId,
    tokenProgram: pubkeyToBase58(tokenProgram),
    tokenDecimals: 6,
    tokenName: "Test",
    tokenSymbol: "TEST",
    vault: pubkeyToBase58(onChain.vault),
    solFeeLamports: SOL_FEE.toString(),
    accountBudgetLamports: (onChain.accountBudgetLamports ?? 0n).toString(),
    feeTierUsd: "15",
    feeSolPriceUsd: "150",
    createdAt: clock,
    updatedAt: clock,
  });
  await handle.db.insert(dropHandleLeaves).values(
    tree.entries.map((e) => ({
      dropAddress: created.drop,
      leafIndex: e.index,
      xUserId: e.xId.toString(),
      amount: e.amount.toString(),
    })),
  );
  await handle.db
    .insert(dropJobs)
    .values({ dropAddress: created.drop, kind: "watch_funding", runAfter: clock });
  return {
    address: created.drop,
    drop,
    mint,
    tokenProgram,
    vault: onChain.vault,
    budget: onChain.accountBudgetLamports ?? 0n,
    tree,
  };
}

/** Both parts: the tokens to the vault, the fee and the budget to the drop. */
function fundBoth(t: TokenDrop) {
  svm.mintTokens(t.vault, t.tree.totalEntitlements);
  svm.fund(t.drop, SOL_FEE + t.budget);
}

async function bind(t: TokenDrop, index: number, to: Pubkey) {
  const entry = t.tree.entries[index] as (typeof t.tree.entries)[number];
  const message = svmBindingMessage({
    drop: t.address,
    chainId: 103,
    index,
    xId: entry.xId,
    recipient: pubkeyToBase58(to),
  });
  await handle.db.insert(handleBindings).values({
    dropAddress: t.address,
    leafIndex: index,
    xUserId: entry.xId.toString(),
    recipient: pubkeyToBase58(to),
    binderSignature: toHex(ed25519.sign(message, BINDER_SEED)),
  });
}

async function dropRow(address: string) {
  return (await handle.db.select().from(drops).where(eq(drops.address, address)).limit(1))[0];
}

/** True when the transaction addresses the compute budget program at all. */
function hasComputeBudget(tx: Uint8Array): boolean {
  const { message } = decodeTransaction(tx);
  return message.instructions.some((ix) =>
    pubkeyEquals(message.accountKeys[ix.programIdIndex] as Pubkey, COMPUTE_BUDGET_PROGRAM_ID),
  );
}

const ED25519_PROGRAM = pubkeyFromBase58("Ed25519SigVerify111111111111111111111111111");

/** The transactions that carried a `claim_handle`: the only ones with an Ed25519 instruction. */
function claimTxs(): Uint8Array[] {
  return svm.sent.filter((tx) => {
    const { message } = decodeTransaction(tx);
    return message.instructions.some((ix) =>
      pubkeyEquals(message.accountKeys[ix.programIdIndex] as Pubkey, ED25519_PROGRAM),
    );
  });
}

// -------------------------------------------------------------------------------------------
// the size
// -------------------------------------------------------------------------------------------

describe("a token claim_handle fits at depth 9 only without compute budget instructions", () => {
  const drop = wallet(3);
  const recipient = wallet(4);
  const token = {
    mint: CLASSIC_MINT,
    vault: associatedTokenAddress(drop, CLASSIC_MINT, TOKEN_PROGRAM_ID),
    tokenProgram: TOKEN_PROGRAM_ID,
  };
  const ixs = (depth: number) => [
    ed25519Instruction(new Uint8Array(304)),
    claimHandleInstruction({
      caller: wallet(5),
      drop,
      bitmap: bitmapPda(drop).address,
      recipient,
      index: 499,
      xId: 1_214_999_437_505_785_857n,
      amount: 10n ** 15n,
      proof: Array.from({ length: depth }, (_, i) => new Uint8Array(32).fill(i + 1)),
      token,
    }),
  ];
  const size = (instructions: Parameters<typeof transactionSize>[0]["instructions"]) =>
    transactionSize({ feePayer: wallet(5), instructions });

  it("the measured numbers: 1,194 bytes with none, 1,234 with the unit limit, 1,246 with a price", () => {
    expect(size(ixs(9))).toBe(1_194);
    expect(size([setComputeUnitLimit(200_000), ...ixs(9)])).toBe(1_234);
    expect(size([setComputeUnitLimit(200_000), setComputeUnitPrice(1_000n), ...ixs(9)])).toBe(
      1_246,
    );
    expect(size(ixs(8))).toBe(1_162);
    expect(size(ixs(9))).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
    expect(size([setComputeUnitLimit(200_000), ...ixs(9)])).toBeGreaterThan(MAX_TRANSACTION_BYTES);
  });
});

// -------------------------------------------------------------------------------------------
// the instruction shapes, IDL order
// -------------------------------------------------------------------------------------------

describe("the token accounts in the IDL order", () => {
  const drop = wallet(3);
  const caller = wallet(5);
  const recipient = wallet(4);
  const refundRecipient = pubkeyFromBase58(REFUND);
  const tokenOf = (mint: Pubkey, tokenProgram: Pubkey) => ({
    mint,
    vault: associatedTokenAddress(drop, mint, tokenProgram),
    tokenProgram,
  });
  const classic = tokenOf(CLASSIC_MINT, TOKEN_PROGRAM_ID);
  const t22 = tokenOf(pubkeyFromBase58(PUMP_MINT), TOKEN_2022_PROGRAM_ID);
  const shape = (keys: readonly { pubkey: Pubkey; isWritable: boolean }[], from: number) =>
    keys.slice(from).map((k) => [pubkeyToBase58(k.pubkey), k.isWritable]);
  const b58 = pubkeyToBase58;

  it("activate: mint, vault, token program, all read only", () => {
    const ix = activateInstruction({ caller, drop, feeWallet: wallet(6), token: classic });
    expect(shape(ix.keys, 3)).toEqual([
      [b58(classic.mint), false],
      [b58(classic.vault), false],
      [b58(TOKEN_PROGRAM_ID), false],
    ]);
  });

  it("claim_handle: mint, vault, the receiver's token account, token program, ATA program", () => {
    for (const token of [classic, t22]) {
      const ix = claimHandleInstruction({
        caller,
        drop,
        bitmap: bitmapPda(drop).address,
        recipient,
        index: 0,
        xId: 1n,
        amount: 1n,
        proof: [],
        token,
      });
      expect(ix.keys).toHaveLength(12);
      expect(shape(ix.keys, 5)).toEqual([
        [b58(token.mint), false],
        [b58(token.vault), true],
        [b58(associatedTokenAddress(recipient, token.mint, token.tokenProgram)), true],
        [b58(token.tokenProgram), false],
        [b58(ASSOCIATED_TOKEN_PROGRAM_ID), false],
        ["Sysvar1nstructions1111111111111111111111111", false],
        ["11111111111111111111111111111111", false],
      ]);
    }
  });

  it("refund and cancel_unfunded: mint, vault, the sender's token account, token program, ATA program", () => {
    for (const build of [refundInstruction, cancelUnfundedInstruction]) {
      const ix = build({ caller, drop, refundRecipient, token: t22 });
      expect(shape(ix.keys, 3)).toEqual([
        [b58(t22.mint), false],
        [b58(t22.vault), true],
        [b58(associatedTokenAddress(refundRecipient, t22.mint, TOKEN_2022_PROGRAM_ID)), true],
        [b58(TOKEN_2022_PROGRAM_ID), false],
        [b58(ASSOCIATED_TOKEN_PROGRAM_ID), false],
        ["11111111111111111111111111111111", false],
      ]);
    }
  });

  it("close_drop: the same five after the refund recipient", () => {
    const ix = closeDropInstruction({
      caller,
      drop,
      bitmap: bitmapPda(drop).address,
      rentPayer: caller,
      refundRecipient,
      token: classic,
    });
    expect(shape(ix.keys, 5)).toEqual([
      [b58(classic.mint), false],
      [b58(classic.vault), true],
      [b58(associatedTokenAddress(refundRecipient, classic.mint, TOKEN_PROGRAM_ID)), true],
      [b58(TOKEN_PROGRAM_ID), false],
      [b58(ASSOCIATED_TOKEN_PROGRAM_ID), false],
      ["11111111111111111111111111111111", false],
    ]);
  });

  it("a SOL drop keeps its absent slots, the program id, read only", () => {
    const absent = [b58(DROPCHAD_PROGRAM_ID), false];
    expect(shape(activateInstruction({ caller, drop, feeWallet: wallet(6) }).keys, 3)).toEqual([
      absent,
      absent,
      absent,
    ]);
    expect(shape(refundInstruction({ caller, drop, refundRecipient }).keys, 3).slice(0, 5)).toEqual(
      [absent, absent, absent, absent, absent],
    );
  });
});

// -------------------------------------------------------------------------------------------
// the funding check
// -------------------------------------------------------------------------------------------

describe("a token drop is funded only when both parts are there", () => {
  it("nothing, tokens only, SOL only, one unit short of either: not funded; both: funded", async () => {
    const t = await seedTokenDrop();
    const status = () =>
      (adapter.fundingStatus as NonNullable<ChainAdapter["fundingStatus"]>)(t.address);
    expect(await status()).toMatchObject({ funded: false, lamports: 0n, tokenAmount: 0n });

    svm.mintTokens(t.vault, t.tree.totalEntitlements - 1n);
    svm.fund(t.drop, SOL_FEE + t.budget);
    expect((await status()).funded).toBe(false); // one token unit short

    svm.mintTokens(t.vault, 1n);
    expect(await status()).toMatchObject({
      funded: true,
      lamports: SOL_FEE + t.budget,
      tokenAmount: t.tree.totalEntitlements,
    });

    svm.setLamports(t.drop, svm.lamportsOf(t.drop) - 1n);
    expect((await status()).funded).toBe(false); // one lamport short
  });

  it("two waiting token drops in one turn: the drops in one batch, the vaults in one more", async () => {
    const a = await seedTokenDrop({ nonce: 0n });
    const b = await seedTokenDrop({ nonce: 1n });
    svm.mintTokens(a.vault, a.tree.totalEntitlements);
    svm.fund(a.drop, SOL_FEE + a.budget);
    svm.mintTokens(b.vault, b.tree.totalEntitlements); // tokens only: not funded
    const many = vi.spyOn(rpc, "getMultipleAccounts");
    const one = vi.spyOn(rpc, "getAccountInfo");

    await worker.tick();
    expect(many).toHaveBeenCalledTimes(2);
    expect(many.mock.calls[0]?.[0].map(pubkeyToBase58).sort()).toEqual(
      [a.address, b.address].sort(),
    );
    expect(many.mock.calls[1]?.[0].map(pubkeyToBase58).sort()).toEqual(
      [pubkeyToBase58(a.vault), pubkeyToBase58(b.vault)].sort(),
    );
    expect(one).not.toHaveBeenCalled();
    expect((await dropRow(a.address))?.state).toBe("funded");
    expect((await dropRow(b.address))?.state).toBe("created");
    expect(seen).toContainEqual({
      type: "funding_seen",
      drop: a.address,
      balanceWei: (SOL_FEE + a.budget).toString(),
      tokenAmount: a.tree.totalEntitlements.toString(),
    });
  });

  it("tokens only never activates: the watcher keeps waiting", async () => {
    const t = await seedTokenDrop();
    svm.mintTokens(t.vault, t.tree.totalEntitlements);
    await worker.tick();
    expect((await dropRow(t.address))?.state).toBe("created");
    expect(svm.executed).not.toContain("activate");
  });

  it("SOL only never activates either, even far more than the fee and the budget", async () => {
    const t = await seedTokenDrop();
    svm.fund(t.drop, 10n * (SOL_FEE + t.budget));
    await worker.tick();
    expect((await dropRow(t.address))?.state).toBe("created");
  });

  it("a SOL drop: the SOL check, and no token amount", async () => {
    const commitment = unblindedCommitment(1n, 9n);
    const prediction = await adapter.predictDrop(commitment, 9n);
    const tree = buildHandleDropTree({
      family: "svm",
      drop: prediction.address,
      chainId: 103,
      receivers: [{ xId: 77n, amount: 10_000_000n }],
    });
    const created = await adapter.createDrop({
      merkleRoot: tree.root,
      manifestHash: `0x${"11".repeat(32)}`,
      totalEntitlements: tree.totalEntitlements,
      leafCount: tree.leafCount,
      refundRecipient: REFUND,
      creatorCommitment: commitment,
      nonce: 9n,
      fundingPeriod: FUNDING_PERIOD,
      claimPeriod: CLAIM_PERIOD,
    });
    const status = () =>
      (adapter.fundingStatus as NonNullable<ChainAdapter["fundingStatus"]>)(created.drop);
    svm.fund(pubkeyFromBase58(created.drop), created.grossRequired - 1n);
    expect(await status()).toMatchObject({ funded: false, tokenAmount: null });
    svm.fund(pubkeyFromBase58(created.drop), 1n);
    expect(await status()).toMatchObject({
      funded: true,
      lamports: created.grossRequired,
      tokenAmount: null,
    });
  });
});

// -------------------------------------------------------------------------------------------
// the worker, end to end
// -------------------------------------------------------------------------------------------

describe("a token drop through the worker", () => {
  it("classic: watches both parts, activates with no usd price, claims with the rent paid back, refunds the rest and closes", async () => {
    const t = await seedTokenDrop({ count: 3 });
    const feeWallet = svm.drop(t.drop)?.feeWallet as Pubkey;

    // Tokens first: not funded.
    svm.mintTokens(t.vault, t.tree.totalEntitlements);
    await worker.tick();
    expect((await dropRow(t.address))?.state).toBe("created");

    // Then the SOL: funded, and the event says both.
    svm.fund(t.drop, SOL_FEE + t.budget);
    clock = new Date(clock.getTime() + 5_000);
    await worker.tick();
    expect((await dropRow(t.address))?.state).toBe("funded");
    expect(seen.at(-1)).toMatchObject({
      type: "funding_seen",
      balanceWei: (SOL_FEE + t.budget).toString(),
      tokenAmount: t.tree.totalEntitlements.toString(),
    });

    // Activate: the SOL fee to the fee wallet, no usd price frozen.
    const feeBefore = svm.lamportsOf(feeWallet);
    await worker.tick();
    expect(svm.drop(t.drop)?.status).toBe(SVM_STATUS_ACTIVE);
    expect(svm.lamportsOf(feeWallet) - feeBefore).toBe(SOL_FEE);
    const active = await dropRow(t.address);
    expect(active?.state).toBe("active");
    expect(active?.priceUsd).toBeNull();
    expect(active?.pricedAt).toBeNull();

    // Two receivers bind: one with no token account yet, one who has it already.
    const fresh = wallet(0x21);
    const holder = wallet(0x22);
    const holderAta = svm.putTokenAccount(holder, t.mint, t.tokenProgram);
    await bind(t, 0, fresh);
    await bind(t, 1, holder);
    const relayerBefore = svm.lamportsOf(signer.publicKey);
    await worker.tick(); // claim_handles
    const freshAta = associatedTokenAddress(fresh, t.mint, t.tokenProgram);
    expect(svm.tokenAmountOf(freshAta)).toBe(TOKENS);
    expect(svm.tokenAmountOf(holderAta)).toBe(TOKENS);
    // the new account's rent came back from the budget, so the relayer paid fees only.
    expect(relayerBefore - svm.lamportsOf(signer.publicKey)).toBe(2n * 5_000n);
    expect(svm.drop(t.drop)?.accountBudgetUsed).toBe(rentFor(165));
    const paid = seen.filter((e) => e.type === "claim_paid");
    expect(paid.map((e) => (e as { amountWei: string }).amountWei)).toEqual([
      TOKENS.toString(),
      TOKENS.toString(),
    ]);
    // no compute budget instruction on a token claim.
    const claims = claimTxs();
    expect(claims).toHaveLength(2);
    for (const tx of claims) expect(hasComputeBudget(tx)).toBe(false);

    // The claim window closes with leaf 2 unclaimed: refund, then close.
    advance(CLAIM_PERIOD + PAST_MARGIN);
    await worker.tick(); // claim_handles sees the deadline, claims_expired, settle queued
    const refundLamportsBefore = svm.lamportsOf(pubkeyFromBase58(REFUND));
    await worker.tick(); // settle: refund
    expect(svm.drop(t.drop)?.status).toBe(SVM_STATUS_FINALIZED);
    const refundAta = associatedTokenAddress(pubkeyFromBase58(REFUND), t.mint, t.tokenProgram);
    expect(svm.tokenAmountOf(refundAta)).toBe(TOKENS);
    // the budget never used goes back to the sender.
    expect(svm.lamportsOf(pubkeyFromBase58(REFUND)) - refundLamportsBefore).toBe(
      t.budget - rentFor(165),
    );
    await worker.tick(); // settle: close
    expect(svm.drop(t.drop)?.closed).toBe(true);
    expect(svm.tokenAmountOf(t.vault)).toBeNull();
    expect((await dropRow(t.address))?.closedAt).not.toBeNull();
  });

  it("the SOL part rounded up to 0.001 SOL: the watcher activates, the extra comes back at refund", async () => {
    const t = await seedTokenDrop({ count: 2 });
    const exact = SOL_FEE + t.budget;
    // What the funding card asks for: the api's own rounding.
    const rounded = BigInt(
      adapter.fundingInstructions({
        drop: t.address,
        amount: exact,
        fundingDeadline: 1n,
        token: {
          mint: pubkeyToBase58(t.mint),
          vault: pubkeyToBase58(t.vault),
          tokenProgram: pubkeyToBase58(t.tokenProgram),
          name: null,
          symbol: null,
          decimals: 6,
          amount: t.tree.totalEntitlements,
        },
      }).amountBaseUnits,
    );
    expect(rounded % 1_000_000n).toBe(0n);
    expect(rounded).toBeGreaterThan(exact); // the fake rent makes the exact sum uneven
    expect(rounded - exact).toBeLessThan(1_000_000n);

    svm.mintTokens(t.vault, t.tree.totalEntitlements);
    svm.fund(t.drop, rounded);
    clock = new Date(clock.getTime() + 5_000);
    await worker.tick();
    expect((await dropRow(t.address))?.state).toBe("funded");
    await worker.tick();
    expect(svm.drop(t.drop)?.status).toBe(SVM_STATUS_ACTIVE);

    // Nobody claims: at the refund the whole budget and the extra go back to the sender.
    advance(CLAIM_PERIOD + PAST_MARGIN);
    await worker.tick();
    const before = svm.lamportsOf(pubkeyFromBase58(REFUND));
    await worker.tick(); // settle: refund
    expect(svm.drop(t.drop)?.status).toBe(SVM_STATUS_FINALIZED);
    expect(svm.lamportsOf(pubkeyFromBase58(REFUND)) - before).toBe(t.budget + (rounded - exact));
  });

  it("Token-2022: the receiver's account is made under Token-2022 and its 170 byte rent comes back", async () => {
    const t = await seedTokenDrop({ count: 2, kind: "2022" });
    fundBoth(t);
    await worker.tick(); // watch
    await worker.tick(); // activate
    const to = wallet(0x31);
    await bind(t, 0, to);
    await worker.tick(); // claim_handles
    const ata = associatedTokenAddress(to, t.mint, TOKEN_2022_PROGRAM_ID);
    expect(svm.ownerOf(ata)).toEqual(TOKEN_2022_PROGRAM_ID);
    expect(svm.tokenAmountOf(ata)).toBe(TOKENS);
    expect(svm.drop(t.drop)?.accountBudgetUsed).toBe(rentFor(170));
  });

  it("500 people, depth 9: the deepest leaf is claimed in one transaction under 1,232 bytes", async () => {
    const t = await seedTokenDrop({ count: 500 });
    fundBoth(t);
    await worker.tick();
    await worker.tick();
    const deepest = t.tree.entries.reduce((a, b) => (b.proof.length > a.proof.length ? b : a));
    expect(deepest.proof).toHaveLength(9);
    await bind(t, deepest.index, wallet(0x41));
    await worker.tick();
    const [binding] = await handle.db.select().from(handleBindings);
    expect(binding?.state).toBe("paid");
    const [tx] = claimTxs();
    expect(tx).toBeDefined();
    expect((tx as Uint8Array).length).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
    expect(hasComputeBudget(tx as Uint8Array)).toBe(false);
  });

  it("only tokens arrive before the funding deadline: cancel sends them back, then close", async () => {
    const t = await seedTokenDrop();
    svm.mintTokens(t.vault, t.tree.totalEntitlements);
    advance(FUNDING_PERIOD + PAST_MARGIN);
    await worker.tick(); // watch: funding_expired, settle queued
    expect((await dropRow(t.address))?.state).toBe("funding_expired");
    await worker.tick(); // settle: cancel_unfunded
    expect(svm.drop(t.drop)?.status).toBe(SVM_STATUS_CANCELLED);
    const refundAta = associatedTokenAddress(pubkeyFromBase58(REFUND), t.mint, t.tokenProgram);
    expect(svm.tokenAmountOf(refundAta)).toBe(t.tree.totalEntitlements);
    await worker.tick(); // settle: close
    expect(svm.drop(t.drop)?.closed).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------
// the relayer
// -------------------------------------------------------------------------------------------

describe("the relayer and the token accounts", () => {
  it("refuses a token claim_handle above the default 200,000 units, nothing sent", async () => {
    const t = await seedTokenDrop();
    fundBoth(t);
    await worker.tick();
    await worker.tick();
    const entry = t.tree.entries[0] as (typeof t.tree.entries)[number];
    const to = wallet(0x51);
    const message = svmBindingMessage({
      drop: t.address,
      chainId: 103,
      index: 0,
      xId: entry.xId,
      recipient: pubkeyToBase58(to),
    });
    svm.unitsOverride = 250_000;
    const sent = svm.sent.length;
    await expect(
      adapter.claimHandle(t.address, {
        index: 0,
        xId: entry.xId,
        amount: entry.amount,
        recipient: pubkeyToBase58(to),
        proof: entry.proof,
        signature: toHex(ed25519.sign(message, BINDER_SEED)),
      }),
    ).rejects.toThrow(ComputeCapExceededError);
    expect(svm.sent.length).toBe(sent);
  });

  it("a wrong mint fails the simulation with AssetAccountsMismatch, nothing sent", async () => {
    const t = await seedTokenDrop();
    fundBoth(t);
    const other = new Uint8Array(32).fill(0x6d);
    svm.putAccount(other, TOKEN_PROGRAM_ID, classicMintData({ decimals: 6 }));
    const sent = svm.sent.length;
    await expect(
      relayer.activate({
        drop: t.drop,
        feeWallet: svm.drop(t.drop)?.feeWallet as Pubkey,
        token: {
          mint: other,
          vault: associatedTokenAddress(t.drop, other, TOKEN_PROGRAM_ID),
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      }),
    ).rejects.toThrow(SimulationFailedError);
    expect(svm.sent.length).toBe(sent);
  });

  it("a token drop activated without its token accounts fails the simulation too", async () => {
    const t = await seedTokenDrop();
    fundBoth(t);
    await expect(
      relayer.activate({ drop: t.drop, feeWallet: svm.drop(t.drop)?.feeWallet as Pubkey }),
    ).rejects.toThrow(SimulationFailedError);
    expect(svm.drop(t.drop)?.status).not.toBe(SVM_STATUS_ACTIVE);
  });
});
