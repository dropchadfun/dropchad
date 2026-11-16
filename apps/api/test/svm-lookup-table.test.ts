/**
 * The lookup table for a token `claim_handle`
 * - one table, six fixed read-only addresses in a fixed order, frozen
 * - a token `claim_handle` as a v0 transaction with both compute budget instructions: 1,135
 *   bytes at depth 9 with binding v2, under the 1,232 byte limit
 * - only read-only, non-signer, non-program keys move into the table
 * - the start check:, no authority, not deactivated, active, the exact list
 * - the fallback: the legacy transaction with no compute budget, and a table error in the
 *   simulation rebuilds the same attempt as legacy
 * - the guard on the compiled message: one table, the registry one, no writable lookup, every
 *   instruction resolves to exactly the accounts it names
 * - the fee steps on a v0 token claim
 * - every other send stays legacy
 * - `getTransaction` appends the loaded addresses
 */
import { ed25519 } from "@noble/curves/ed25519";
import { buildDropTree, buildHandleDropTree, svmBindingMessage } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { toHex } from "viem";
import { describe, expect, it } from "vitest";

import type { ChainAdapter } from "../src/chain/adapter.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import {
  claimHandleInstruction,
  ed25519Instruction,
  setComputeUnitLimit,
  setComputeUnitPrice,
} from "../src/chain/svm/instructions.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
  LOOKUP_TABLE_RECHECK_MS,
  TOKEN_CLAIM_TABLE_ADDRESSES,
  checkLookupTable,
  parseLookupTable,
} from "../src/chain/svm/lookup-table.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  bitmapPda,
  configPda,
} from "../src/chain/svm/pda.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  DROPCHAD_PROGRAM_ID,
  ED25519_PROGRAM_ID,
  INSTRUCTIONS_SYSVAR_ID,
  SYSTEM_PROGRAM_ID,
  pubkeyEquals,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import { RelayerRefusedError, checkV0Message, createSvmRelayer } from "../src/chain/svm/relayer.js";
import { createSvmRpc, type AccountInfo } from "../src/chain/svm/rpc.js";
import {
  MAX_TRANSACTION_BYTES,
  compileMessageV0,
  serializeMessageV0,
  signTransactionV0,
  transactionSizeV0,
  verifySignature,
  type Instruction,
  type LookupTable,
} from "../src/chain/svm/transaction.js";
import {
  FAKE_ALT_PROGRAM,
  FakeSvm,
  createFakeSvmRpc,
  decodeTransaction,
  encodeLookupTable,
  rentFor,
  type FakeSvmRpcOptions,
} from "./fake-svm.js";
import { classicMintData } from "./token-fixtures.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const TABLE: Pubkey = new Uint8Array(32).fill(0x7a);
const OTHER_TABLE: Pubkey = new Uint8Array(32).fill(0x7b);
const BINDER_SEED = new Uint8Array(32).fill(7);
const BINDER: Pubkey = ed25519.getPublicKey(BINDER_SEED);
const CLASSIC_MINT: Pubkey = new Uint8Array(32).fill(0x5c);
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const TOKENS = 1_000_000n;
const SOL_FEE = 100_000_000n;
const ONE_SOL = 1_000_000_000n;

const wallet = (seed: number): Pubkey => ed25519.getPublicKey(new Uint8Array(32).fill(seed));
const b58 = (keys: readonly Pubkey[]) => keys.map(pubkeyToBase58);

/** The table's six addresses, written out here, not taken from the code under test. */
const SIX: Pubkey[] = [
  configPda().address,
  SYSTEM_PROGRAM_ID,
  INSTRUCTIONS_SYSVAR_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
];
const table: LookupTable = { address: TABLE, addresses: SIX };

/** A token `claim_handle` at `depth`, its Ed25519 data the 312 bytes of binding v2. */
function tokenClaim(depth: number, payer: Pubkey = wallet(5)): Instruction[] {
  const drop = wallet(3);
  return [
    ed25519Instruction(new Uint8Array(312)),
    claimHandleInstruction({
      caller: payer,
      drop,
      bitmap: bitmapPda(drop).address,
      recipient: wallet(4),
      index: 499,
      xId: 1_214_999_437_505_785_857n,
      amount: 10n ** 15n,
      proof: Array.from({ length: depth }, (_, i) => new Uint8Array(32).fill(i + 1)),
      token: {
        mint: CLASSIC_MINT,
        vault: associatedTokenAddress(drop, CLASSIC_MINT, TOKEN_PROGRAM_ID),
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    }),
  ];
}

const budgetIxs = () => [setComputeUnitLimit(200_000), setComputeUnitPrice(200_000n)];

// -------------------------------------------------------------------------------------------
// the six addresses and the table account
// -------------------------------------------------------------------------------------------

describe("the table's six addresses", () => {
  it("the lookup table program and the six addresses, in order", () => {
    expect(pubkeyToBase58(ADDRESS_LOOKUP_TABLE_PROGRAM_ID)).toBe(FAKE_ALT_PROGRAM);
    expect(b58(TOKEN_CLAIM_TABLE_ADDRESSES)).toEqual([
      pubkeyToBase58(configPda().address),
      "11111111111111111111111111111111",
      "Sysvar1nstructions1111111111111111111111111",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    ]);
  });

  it("parses the table layout: slots, the authority and the addresses from byte 56", () => {
    const data = encodeLookupTable({
      addresses: SIX,
      authority: wallet(9),
      deactivationSlot: 77n,
      lastExtendedSlot: 42n,
    });
    const parsed = parseLookupTable(data);
    expect(parsed.deactivationSlot).toBe(77n);
    expect(parsed.lastExtendedSlot).toBe(42n);
    expect(parsed.authority === null ? null : pubkeyToBase58(parsed.authority)).toBe(
      pubkeyToBase58(wallet(9)),
    );
    expect(b58(parsed.addresses)).toEqual(b58(SIX));
    expect(parseLookupTable(encodeLookupTable({ addresses: SIX })).authority).toBeNull();
  });

  it("refuses a table with a cut address or a wrong type", () => {
    const data = encodeLookupTable({ addresses: SIX });
    expect(() => parseLookupTable(data.slice(0, data.length - 1))).toThrow();
    const wrong = new Uint8Array(data);
    wrong[0] = 2;
    expect(() => parseLookupTable(wrong)).toThrow();
  });

  /**
   * A real mainnet-beta table, `49KhWdeuCRiS4icxMQcoDFne7f7eBHiNwKec6mMCHdDj`, read
   * with `getAccountInfo` base64: 152 bytes, owner the lookup table program. The values below
   * are what `jsonParsed` and `solana address-lookup-table get` showed for it.
   */
  const REAL_TABLE =
    "AQAAAP//////////yxoHGQAAAAAAAf5V0RnLGJW5Iulh6KqCgXOCnKTdTYb8khy1dV5RfyS0AAD+VdEZyxiVuSLpYeiq" +
    "goFzgpyk3U2G/JIctXVeUX8ktC1SpBFACEpOX/IM4iSFBrZZIYIsyYOSHhb6q5oyvz/hMboNOvSunaV3+J+JgZJNtNkS" +
    "UIy33QiIVu2+l+fvsHQ=";

  it("parses a real mainnet table the way the cluster reads it", () => {
    const data = new Uint8Array(Buffer.from(REAL_TABLE, "base64"));
    expect(data.length).toBe(152);
    const parsed = parseLookupTable(data);
    expect(parsed.deactivationSlot).toBe(0xffff_ffff_ffff_ffffn);
    expect(parsed.lastExtendedSlot).toBe(419_896_011n);
    expect(parsed.authority === null ? null : pubkeyToBase58(parsed.authority)).toBe(
      "J7pTDgEw7yrrRX22T3XLMGfNmnXJMfJuSVyCRo86YnFm",
    );
    expect(b58(parsed.addresses)).toEqual([
      "J7pTDgEw7yrrRX22T3XLMGfNmnXJMfJuSVyCRo86YnFm",
      "43vSCPWAaLQdXTf7PDnnf1jPbyPCXwgjLHQe895B3dq2",
      "4M7XHpHwbMQwX2w8DRzy8JP969EWmbBaNRBdPNPZEN35",
    ]);
  });

  it("the fake's encoder writes the same bytes as the real table", () => {
    const data = new Uint8Array(Buffer.from(REAL_TABLE, "base64"));
    const parsed = parseLookupTable(data);
    const encoded = encodeLookupTable({
      addresses: parsed.addresses,
      authority: parsed.authority,
      deactivationSlot: parsed.deactivationSlot,
      lastExtendedSlot: parsed.lastExtendedSlot,
    });
    expect(Buffer.from(encoded).toString("base64")).toBe(REAL_TABLE);
  });

  /**
   * The token claim table on mainnet-beta, `7W9coGsnBN7fNQaUmxmPDt7kBeRtAGhPsL1s5L7R6GQX`, read
   * after its freeze with `getAccountInfo` base64: 248 bytes, owner the lookup table
   * program, no authority, still active, last extended at slot 469,372,522.
   */
  const FROZEN_TABLE =
    "AQAAAP//////////ag76GwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI0JUzytpLf8xfLQCG" +
    "wJRaJR8vo8R3Dpzb4C4Kt+iHmgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABqfVFxh70WY12tQEVf3CwMEk" +
    "xo8hVnWl27rLXwgAAACMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WQbd9uHXZaGT2cvhRs7reawctIXtX1s3" +
    "kTqM9YV+/wCpBt324e51j94YQl285GzN2rYa/E2DuQ0n/r35KNihi/w=";

  it("parses the real frozen token claim table: no authority, active, the six addresses", () => {
    const data = new Uint8Array(Buffer.from(FROZEN_TABLE, "base64"));
    expect(data.length).toBe(248);
    const parsed = parseLookupTable(data);
    expect(parsed.authority).toBeNull();
    expect(parsed.deactivationSlot).toBe(0xffff_ffff_ffff_ffffn);
    expect(parsed.lastExtendedSlot).toBe(469_372_522n);
    expect(b58(parsed.addresses)).toEqual(b58(TOKEN_CLAIM_TABLE_ADDRESSES));
  });

  it("the real frozen table passes the start check, and the fake's encoder writes its bytes", () => {
    const data = new Uint8Array(Buffer.from(FROZEN_TABLE, "base64"));
    const account: AccountInfo = {
      lamports: 1_910_080n,
      owner: ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
      data,
      executable: false,
    };
    expect(checkLookupTable(account, 469_372_523n)).toEqual({
      ok: true,
      addresses: TOKEN_CLAIM_TABLE_ADDRESSES,
    });
    expect(checkLookupTable(account, 469_372_522n)).toEqual({
      ok: false,
      reason: "not active yet",
    });
    const encoded = encodeLookupTable({
      addresses: TOKEN_CLAIM_TABLE_ADDRESSES,
      authority: null,
      lastExtendedSlot: 469_372_522n,
    });
    expect(Buffer.from(encoded).toString("base64")).toBe(FROZEN_TABLE);
  });
});

describe("the start check", () => {
  const account = (
    data: Uint8Array,
    owner: Pubkey = ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
  ): AccountInfo => ({ lamports: rentFor(data.length), owner, data, executable: false });
  const good = () => encodeLookupTable({ addresses: SIX, lastExtendedSlot: 10n });
  const reason = (info: AccountInfo | null, slot = 11n) => {
    const result = checkLookupTable(info, slot);
    return result.ok ? "ok" : result.reason;
  };

  it("a frozen, active table with exactly the six addresses passes", () => {
    expect(reason(account(good()))).toBe("ok");
  });

  it("each bad table is refused with its reason", () => {
    expect(reason(null)).toBe("missing");
    expect(reason(account(good(), SYSTEM_PROGRAM_ID))).toBe("owner");
    expect(reason(account(new Uint8Array(40)))).toBe("data");
    expect(
      reason(
        account(encodeLookupTable({ addresses: SIX, authority: wallet(9), lastExtendedSlot: 10n })),
      ),
    ).toBe("authority");
    expect(
      reason(
        account(encodeLookupTable({ addresses: SIX, deactivationSlot: 5n, lastExtendedSlot: 1n })),
      ),
    ).toBe("deactivated");
    expect(reason(account(good()), 10n)).toBe("not active yet");
    expect(
      reason(account(encodeLookupTable({ addresses: SIX.slice(0, 5), lastExtendedSlot: 1n }))),
    ).toBe("addresses");
    expect(
      reason(
        account(
          encodeLookupTable({
            addresses: [SIX[1], SIX[0], ...SIX.slice(2)] as Pubkey[],
            lastExtendedSlot: 1n,
          }),
        ),
      ),
    ).toBe("addresses");
    expect(
      reason(account(encodeLookupTable({ addresses: [...SIX, wallet(1)], lastExtendedSlot: 1n }))),
    ).toBe("addresses");
  });
});

// -------------------------------------------------------------------------------------------
// the v0 message
// -------------------------------------------------------------------------------------------

describe("the size of a v0 token claim_handle at depth 9, binding v2", () => {
  const size = (instructions: Instruction[]) =>
    transactionSizeV0({ feePayer: wallet(5), instructions, table });

  it("1,083 bytes with no compute budget, 1,135 with the limit and a price", () => {
    expect(size(tokenClaim(9))).toBe(1_083);
    expect(size([...budgetIxs(), ...tokenClaim(9)])).toBe(1_135);
    expect(size([...budgetIxs(), ...tokenClaim(9)])).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
  });
});

describe("what moves into the table", () => {
  const compile = (instructions: Instruction[]) =>
    compileMessageV0({
      feePayer: wallet(5),
      recentBlockhash: new Uint8Array(32).fill(1),
      instructions,
      table,
    });

  it("only the five read-only table keys a token claim names, as read-only lookups", () => {
    const message = compile([...budgetIxs(), ...tokenClaim(9)]);
    expect(message.lookups).toHaveLength(1);
    const [lookup] = message.lookups;
    expect(pubkeyToBase58(lookup?.accountKey as Pubkey)).toBe(pubkeyToBase58(TABLE));
    expect(lookup?.writableIndexes).toEqual([]);
    expect(lookup?.readonlyIndexes).toEqual([0, 1, 2, 3, 4]);
    const statics = b58(message.accountKeys);
    for (const moved of SIX.slice(0, 5)) expect(statics).not.toContain(pubkeyToBase58(moved));
  });

  it("the fee payer and every invoked program stay in the static keys", () => {
    const message = compile([...budgetIxs(), ...tokenClaim(9)]);
    const statics = b58(message.accountKeys);
    expect(statics[0]).toBe(pubkeyToBase58(wallet(5)));
    for (const program of [DROPCHAD_PROGRAM_ID, ED25519_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID]) {
      expect(statics).toContain(pubkeyToBase58(program));
    }
    for (const ix of message.instructions) expect(ix.programIdIndex).toBeLessThan(statics.length);
  });

  it("serializes with the 0x80 version byte, signs, and decodes to the same accounts", async () => {
    const signer = randomSigner();
    const instructions = [...budgetIxs(), ...tokenClaim(9, signer.publicKey)];
    const message = compileMessageV0({
      feePayer: signer.publicKey,
      recentBlockhash: new Uint8Array(32).fill(1),
      instructions,
      table,
    });
    expect(serializeMessageV0(message)[0]).toBe(0x80);
    const tx = await signTransactionV0(message, [signer]);
    expect(tx.bytes.length).toBe(1_135);
    expect(verifySignature(tx)).toBe(true);
    const decoded = decodeTransaction(tx.bytes, () => SIX);
    expect(decoded.version).toBe(0);
    decoded.message.instructions.forEach((ix, i) => {
      const want = instructions[i] as Instruction;
      expect(pubkeyToBase58(decoded.message.accountKeys[ix.programIdIndex] as Pubkey)).toBe(
        pubkeyToBase58(want.programId),
      );
      expect(
        ix.accountIndexes.map((k) => pubkeyToBase58(decoded.message.accountKeys[k] as Pubkey)),
      ).toEqual(b58(want.keys.map((k) => k.pubkey)));
    });
  });
});

describe("the guard on the compiled message", () => {
  const instructions = () => [...budgetIxs(), ...tokenClaim(9)];
  const compile = () =>
    compileMessageV0({
      feePayer: wallet(5),
      recentBlockhash: new Uint8Array(32).fill(1),
      instructions: instructions(),
      table,
    });

  it("the message as compiled passes", () => {
    expect(() => checkV0Message(compile(), instructions(), table)).not.toThrow();
  });

  it("another table is refused", () => {
    const m = compile();
    const tampered = {
      ...m,
      lookups: m.lookups.map((l) => ({ ...l, accountKey: OTHER_TABLE })),
    };
    expect(() => checkV0Message(tampered, instructions(), table)).toThrow(RelayerRefusedError);
  });

  it("two tables are refused", () => {
    const m = compile();
    const tampered = { ...m, lookups: [...m.lookups, ...m.lookups] };
    expect(() => checkV0Message(tampered, instructions(), table)).toThrow(RelayerRefusedError);
  });

  it("a writable lookup is refused", () => {
    const m = compile();
    const tampered = {
      ...m,
      lookups: m.lookups.map((l) => ({ ...l, writableIndexes: [5] })),
    };
    expect(() => checkV0Message(tampered, instructions(), table)).toThrow(RelayerRefusedError);
  });

  it("a lookup that resolves to another address is refused", () => {
    const m = compile();
    // Token-2022 at index 5 in place of the Token program at index 4.
    const tampered = {
      ...m,
      lookups: m.lookups.map((l) => ({ ...l, readonlyIndexes: [0, 1, 2, 3, 5] })),
    };
    expect(() => checkV0Message(tampered, instructions(), table)).toThrow(RelayerRefusedError);
  });
});

// -------------------------------------------------------------------------------------------
// the relayer, a token drop through the adapter on the fake cluster
// -------------------------------------------------------------------------------------------

interface World {
  svm: FakeSvm;
  adapter: ChainAdapter;
  relayer: ReturnType<typeof createSvmRelayer>;
  log: string[];
  now: { ms: number };
}

function world(
  options: { rpc?: FakeSvmRpcOptions; table?: Uint8Array | null; withTable?: boolean } = {},
): World {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    feeWallet: wallet(0x0f),
    binder: BINDER,
    relayerLamports: 50n * ONE_SOL,
  });
  if (options.table !== null) {
    svm.putAccount(
      TABLE,
      FAKE_ALT_PROGRAM,
      options.table ?? encodeLookupTable({ addresses: SIX, lastExtendedSlot: 10n }),
    );
  }
  svm.putAccount(CLASSIC_MINT, TOKEN_PROGRAM_ID, classicMintData({ decimals: 6 }));
  const rpc = createFakeSvmRpc(svm, options.rpc);
  const log: string[] = [];
  const now = { ms: 1_000_000 };
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(true),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: {
      maxComputeUnits: 400_000,
      priorityFeeMicroLamports: 200_000n,
      priorityFeeMaxMicroLamports: 1_000_000n,
    },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    commitment: "confirmed",
    sleep: () => Promise.resolve(),
    ...(options.withTable === false ? {} : { lookupTable: { address: TABLE } }),
    nowMs: () => now.ms,
    log: (line: string) => log.push(line),
  });
  const adapter = createSvmAdapter({ rpc, relayer, chain: CHAIN });
  return { svm, adapter, relayer, log, now };
}

/** A funded, active three person token handle drop. */
async function tokenDrop(w: World, nonce = 0n) {
  const commitment = unblindedCommitment(1n, nonce);
  const prediction = await w.adapter.predictDrop(commitment, nonce);
  const tree = buildHandleDropTree({
    family: "svm",
    drop: prediction.address,
    chainId: 103,
    receivers: [0, 1, 2].map((i) => ({ xId: 5_000_000n + BigInt(i), amount: TOKENS })),
  });
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
    token: {
      mint: pubkeyToBase58(CLASSIC_MINT),
      tokenProgram: pubkeyToBase58(TOKEN_PROGRAM_ID),
      solFeeLamports: SOL_FEE,
    },
  });
  const drop = pubkeyFromBase58(created.drop);
  const onChain = w.svm.drop(drop);
  if (onChain === null) throw new Error("no drop");
  w.svm.mintTokens(onChain.vault, tree.totalEntitlements);
  w.svm.fund(drop, SOL_FEE + (onChain.accountBudgetLamports ?? 0n));
  await w.adapter.activate(created.drop);
  return { address: created.drop, drop, tree };
}

async function claim(
  w: World,
  d: Awaited<ReturnType<typeof tokenDrop>>,
  index: number,
  to: Pubkey,
) {
  const entry = d.tree.entries[index] as (typeof d.tree.entries)[number];
  const message = svmBindingMessage({
    drop: d.address,
    chainId: 103,
    index,
    xId: entry.xId,
    recipient: pubkeyToBase58(to),
  });
  return w.adapter.claimHandle(d.address, {
    index,
    xId: entry.xId,
    amount: entry.amount,
    recipient: pubkeyToBase58(to),
    proof: entry.proof,
    signature: toHex(ed25519.sign(message, BINDER_SEED)),
  });
}

/** The sent transactions that carried a `claim_handle`: the ones with an Ed25519 instruction. */
function claimTxs(w: World) {
  return w.svm.sent
    .map((bytes) => decodeTransaction(bytes, () => SIX))
    .filter((d) =>
      d.message.instructions.some((ix) =>
        pubkeyEquals(d.message.accountKeys[ix.programIdIndex] as Pubkey, ED25519_PROGRAM_ID),
      ),
    );
}

function priceOf(d: ReturnType<typeof decodeTransaction>): bigint | null {
  for (const ix of d.message.instructions) {
    const program = d.message.accountKeys[ix.programIdIndex] as Pubkey;
    if (!pubkeyEquals(program, COMPUTE_BUDGET_PROGRAM_ID) || ix.data[0] !== 3) continue;
    return new DataView(ix.data.buffer, ix.data.byteOffset + 1, 8).getBigUint64(0, true);
  }
  return null;
}

function hasUnitLimit(d: ReturnType<typeof decodeTransaction>): boolean {
  return d.message.instructions.some(
    (ix) =>
      pubkeyEquals(d.message.accountKeys[ix.programIdIndex] as Pubkey, COMPUTE_BUDGET_PROGRAM_ID) &&
      ix.data[0] === 2,
  );
}

const ataOf = (owner: Pubkey) => associatedTokenAddress(owner, CLASSIC_MINT, TOKEN_PROGRAM_ID);

describe("a ready table", () => {
  it("the start state says on, with the table address", async () => {
    const w = world();
    expect(await w.relayer.lookupTableState()).toEqual({ on: true });
    expect(w.log).toContain(`lookup table on ${pubkeyToBase58(TABLE)}`);
  });

  it("a token claim_handle goes v0 with the limit and the base price, and pays", async () => {
    const w = world();
    const d = await tokenDrop(w);
    await claim(w, d, 1, wallet(0x41));
    const [tx] = claimTxs(w);
    expect(tx?.version).toBe(0);
    expect(pubkeyToBase58(tx?.lookups[0]?.table as Pubkey)).toBe(pubkeyToBase58(TABLE));
    expect(tx?.lookups[0]?.writable).toEqual([]);
    expect(hasUnitLimit(tx as ReturnType<typeof decodeTransaction>)).toBe(true);
    expect(priceOf(tx as ReturnType<typeof decodeTransaction>)).toBe(200_000n);
    expect(w.svm.tokenAmountOf(ataOf(wallet(0x41)))).toBe(TOKENS);
  });

  it("fee steps: an expired v0 claim is sent again at twice the price, still v0", async () => {
    // Sends: create 1, activate 2, the claim 3 is lost, its new send 4 lands.
    const w = world({ rpc: { loseSends: [3] } });
    const d = await tokenDrop(w);
    await claim(w, d, 0, wallet(0x42));
    const txs = claimTxs(w);
    expect(txs.map((t) => t.version)).toEqual([0, 0]);
    expect(txs.map(priceOf)).toEqual([200_000n, 400_000n]);
    expect(w.svm.tokenAmountOf(ataOf(wallet(0x42)))).toBe(TOKENS);
  });

  it("every other send stays legacy: create, activate, a SOL claim_handle, a claim batch", async () => {
    const w = world();
    await tokenDrop(w);

    // A SOL address drop: create, activate, one claim batch.
    const c1 = unblindedCommitment(2n, 5n);
    const p1 = await w.adapter.predictDrop(c1, 5n);
    const tree = buildDropTree({
      family: "svm",
      drop: p1.address,
      chainId: 103,
      receivers: [
        { recipient: pubkeyToBase58(wallet(0x51)), amount: 10_000_000n },
        { recipient: pubkeyToBase58(wallet(0x52)), amount: 10_000_000n },
      ],
    });
    const created = await w.adapter.createDrop({
      merkleRoot: tree.root,
      manifestHash: `0x${"22".repeat(32)}`,
      totalEntitlements: tree.totalEntitlements,
      leafCount: tree.leafCount,
      refundRecipient: REFUND,
      creatorCommitment: c1,
      nonce: 5n,
      fundingPeriod: 7 * 86_400,
      claimPeriod: 30 * 86_400,
    });
    w.svm.fund(pubkeyFromBase58(created.drop), ONE_SOL);
    await w.adapter.activate(created.drop);
    await w.adapter.claimBatch(
      created.drop,
      tree.entries.map((e) => ({
        index: e.index,
        recipient: e.recipient,
        amount: e.amount,
        proof: e.proof,
      })),
    );

    // A SOL handle drop: one claim_handle.
    const c2 = unblindedCommitment(3n, 6n);
    const p2 = await w.adapter.predictDrop(c2, 6n);
    const handleTree = buildHandleDropTree({
      family: "svm",
      drop: p2.address,
      chainId: 103,
      receivers: [{ xId: 9n, amount: 10_000_000n }],
    });
    const handleDrop = await w.adapter.createDrop({
      merkleRoot: handleTree.root,
      manifestHash: `0x${"33".repeat(32)}`,
      totalEntitlements: handleTree.totalEntitlements,
      leafCount: handleTree.leafCount,
      refundRecipient: REFUND,
      creatorCommitment: c2,
      nonce: 6n,
      fundingPeriod: 7 * 86_400,
      claimPeriod: 30 * 86_400,
    });
    w.svm.fund(pubkeyFromBase58(handleDrop.drop), ONE_SOL);
    await w.adapter.activate(handleDrop.drop);
    const sent = w.svm.sent.length;
    await claim(
      w,
      { address: handleDrop.drop, drop: pubkeyFromBase58(handleDrop.drop), tree: handleTree },
      0,
      wallet(0x53),
    );
    expect(w.svm.sent.length).toBe(sent + 1);

    const versions = w.svm.sent.map((bytes) => decodeTransaction(bytes).version);
    expect(versions).toHaveLength(8);
    expect(versions.every((v) => v === "legacy")).toBe(true);
  });
});

describe("the table off and the fallback", () => {
  const legacyClaim = async (w: World, to: number) => {
    const d = await tokenDrop(w);
    await claim(w, d, 0, wallet(to));
    const [tx] = claimTxs(w);
    expect(tx?.version).toBe("legacy");
    expect(hasUnitLimit(tx as ReturnType<typeof decodeTransaction>)).toBe(false);
    expect(priceOf(tx as ReturnType<typeof decodeTransaction>)).toBeNull();
    expect(w.svm.tokenAmountOf(ataOf(wallet(to)))).toBe(TOKENS);
  };

  it("no table configured: legacy, no compute budget, as today", async () => {
    await legacyClaim(world({ withTable: false, table: null }), 0x61);
  });

  it("a table with an authority: off, the reason in the log, legacy", async () => {
    const w = world({
      table: encodeLookupTable({ addresses: SIX, authority: wallet(9), lastExtendedSlot: 10n }),
    });
    expect(await w.relayer.lookupTableState()).toEqual({ on: false, reason: "authority" });
    expect(w.log).toContain("lookup table off: authority");
    await legacyClaim(w, 0x62);
  });

  it("a missing table: legacy; read again only after 10 minutes, then v0", async () => {
    const w = world({ table: null });
    expect(await w.relayer.lookupTableState()).toEqual({ on: false, reason: "missing" });
    w.svm.putAccount(
      TABLE,
      FAKE_ALT_PROGRAM,
      encodeLookupTable({ addresses: SIX, lastExtendedSlot: 10n }),
    );
    w.now.ms += LOOKUP_TABLE_RECHECK_MS - 1;
    expect(await w.relayer.lookupTableState()).toEqual({ on: false, reason: "missing" });
    expect(LOOKUP_TABLE_RECHECK_MS).toBe(600_000);
    w.now.ms += 1;
    expect(await w.relayer.lookupTableState()).toEqual({ on: true });
    const d = await tokenDrop(w);
    await claim(w, d, 2, wallet(0x63));
    expect(claimTxs(w).map((t) => t.version)).toEqual([0]);
  });

  it("a failed read at start: off, legacy", async () => {
    const w = world();
    const failing = createSvmRelayer({
      rpc: {
        ...createFakeSvmRpc(w.svm),
        getMultipleAccounts: () => Promise.reject(new Error("rpc down")),
        getAccountInfo: () => Promise.reject(new Error("rpc down")),
      },
      signer: randomSigner(),
      isKnownDrop: () => Promise.resolve(true),
      budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 200_000n },
      rentForCreate: () => Promise.resolve(0n),
      sleep: () => Promise.resolve(),
      lookupTable: { address: TABLE },
      nowMs: () => 0,
      log: () => undefined,
    });
    expect(await failing.lookupTableState()).toEqual({ on: false, reason: "read failed" });
  });

  it("a table gone after the start check: the simulation error rebuilds the attempt as legacy", async () => {
    const w = world();
    expect(await w.relayer.lookupTableState()).toEqual({ on: true });
    const d = await tokenDrop(w);
    w.svm.accounts.delete(pubkeyToBase58(TABLE));
    await claim(w, d, 0, wallet(0x64));
    const versions = claimTxs(w).map((t) => t.version);
    expect(versions).toEqual(["legacy"]);
    expect(w.svm.tokenAmountOf(ataOf(wallet(0x64)))).toBe(TOKENS);
    expect(await w.relayer.lookupTableState()).toEqual({
      on: false,
      reason: "AddressLookupTableNotFound",
    });
  });

  it("the same when the node answers the simulation with an rpc error", async () => {
    const w = world({ rpc: { lookupErrorAsRpc: true } });
    expect(await w.relayer.lookupTableState()).toEqual({ on: true });
    const d = await tokenDrop(w);
    w.svm.accounts.delete(pubkeyToBase58(TABLE));
    await claim(w, d, 1, wallet(0x65));
    expect(claimTxs(w).map((t) => t.version)).toEqual(["legacy"]);
    expect(w.svm.tokenAmountOf(ataOf(wallet(0x65)))).toBe(TOKENS);
  });
});

// -------------------------------------------------------------------------------------------
// The read
// -------------------------------------------------------------------------------------------

describe("getTransaction appends the loaded addresses", () => {
  it("static keys, then loaded writable, then loaded readonly", async () => {
    const [a, b, c, d] = [wallet(1), wallet(2), wallet(3), wallet(4)].map(pubkeyToBase58);
    const result = {
      slot: 7,
      blockTime: 1,
      meta: {
        fee: 10_000,
        err: null,
        logMessages: [],
        computeUnitsConsumed: 100,
        preBalances: [1, 2, 3, 4],
        postBalances: [1, 2, 3, 4],
        loadedAddresses: { writable: [c], readonly: [d] },
      },
      transaction: { message: { accountKeys: [a, b] } },
      version: 0,
    };
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 }),
      )) as unknown as typeof fetch;
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    const tx = await rpc.getTransaction("sig", "confirmed");
    expect(b58(tx?.accountKeys ?? [])).toEqual([a, b, c, d]);
  });

  it("a legacy transaction keeps its keys as they are", async () => {
    const [a, b] = [wallet(1), wallet(2)].map(pubkeyToBase58);
    const result = {
      slot: 7,
      blockTime: 1,
      meta: { fee: 5_000, err: null, preBalances: [1, 2], postBalances: [1, 2] },
      transaction: { message: { accountKeys: [a, b] } },
    };
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 }),
      )) as unknown as typeof fetch;
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    expect(b58((await rpc.getTransaction("sig", "confirmed"))?.accountKeys ?? [])).toEqual([a, b]);
  });
});
