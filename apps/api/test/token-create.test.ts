/**
 * creating a token drop
 * - `asset` is `"native"` or a mint; a chain with token drops, handle mode only
 * - the token is checked again at create (`token_refused`, `solana_unavailable`)
 * - at most 500 people after the merge (`too_many`); amounts above 0; no usd minimum, no rent
 *   floor on token amounts
 * - the fee: the usd tier by people, in lamports at the SOL price, rounded up; no price
 *   (`price_unavailable`), over 1 SOL (`fee_too_high`), and the relayer estimate
 * - `create_drop` with mint, vault, token program and ATA program; the read back checks; the
 *   row; the two part funding; the relayer budget counts the vault rent
 *
 * No socket: `test/fake-svm.ts` is the cluster, and the token check runs over the same fake.
 */
import { getChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { decodeDrop, DROP_ACCOUNT_BYTES } from "../src/chain/svm/accounts.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { createDropInstruction } from "../src/chain/svm/instructions.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/chain/svm/pda.js";
import {
  DROPCHAD_PROGRAM_ID,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { createTokenChecker } from "../src/chain/svm/token-check.js";
import { loadConfig } from "../src/config.js";
import { dropJobs, drops } from "../src/db/schema.js";
import {
  MAX_SOL_FEE_LAMPORTS,
  parseTokenFeeTiers,
  tokenFeeTierUsd,
  tokenMaxPeople,
  usdToLamports,
} from "../src/drops/token-fee.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, fakeAta, rentFor, type FakeDrop } from "./fake-svm.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";
import {
  classicMintData,
  DEVNET_USDC,
  DEVNET_USDC_HOLDER,
  DEVNET_USDC_HOLDER_ATA,
  fromB64,
  PUMP_CURVE,
  PUMP_CURVE_ATA,
  PUMP_MINT,
  PUMP_MINT_DATA,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  ATA_PROGRAM,
} from "./token-fixtures.js";

const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const EVM_REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const SOL = 1_000_000_000n;

/** The SOL part of a token drop's funding, rounded up to 0.001 SOL. */
const upToMilliSol = (lamports: bigint) => ((lamports + 999_999n) / 1_000_000n) * 1_000_000n;

/** X accounts the harness X stub knows: `p0`, `p1`, ... */
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(9_000_000_000 + i),
    username: `p${String(i)}`,
    name: `P ${String(i)}`,
  }));

const priceOf = (sol: number | null): PriceService => ({
  usdPrice: (symbol) => Promise.resolve(symbol === "SOL" ? sol : symbol === "ETH" ? 2_000 : null),
});

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

interface WorldOptions {
  readonly solPrice?: number | null;
  readonly priorityFeeMicroLamports?: bigint;
  readonly checker?: boolean;
  readonly env?: Record<string, string>;
  readonly users?: number;
}

async function world(options: WorldOptions = {}) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    relayerLamports: 50n * SOL,
  });
  const rpc = createFakeSvmRpc(svm);
  const caps = {
    maxComputeUnits: 400_000,
    priorityFeeMicroLamports: options.priorityFeeMicroLamports ?? 0n,
  };
  const reserves: bigint[] = [];
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(false),
    budget: {
      reserve: (amount) => {
        reserves.push(amount);
        return Promise.resolve();
      },
      settle: () => Promise.resolve(),
    },
    caps,
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  const solana: ChainAdapter = createSvmAdapter({
    rpc,
    relayer,
    chain: getChain("solana-devnet") as ReturnType<typeof getChain> & { chainId: number },
    feeModel: caps,
  });
  const evm = evmAdapterFor(createFakeChain());
  harness = await createHarness({
    writeSides: adaptersFrom([solana, evm], solana.chainKey),
    prices: priceOf(options.solPrice === undefined ? 150 : options.solPrice),
    ...(options.checker === false ? {} : { tokenChecker: createTokenChecker({ rpc }) }),
    // The tier mechanics are tested at the prices on purpose; the defaults are tested above
    // and in config.test.ts.
    env: {
      X_BEARER_TOKEN: "test-bearer",
      ...TEST_BINDER_ENV,
      TOKEN_FEE_TIERS_USD: "5:3,20:8,50:15,100:25,500:40",
      ...options.env,
    },
    xLookup: people(options.users ?? 10),
  });
  const { jar } = await login(harness);
  const headers = {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
  const post = (body: unknown) =>
    (harness as Harness).app.request("/api/drops", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const rows = () => (harness as Harness).deps.db.select().from(drops);
  const creates = () => svm.executed.filter((name) => name === "create_drop").length;
  return { svm, rpc, post, rows, creates, reserves, evm };
}

const tokenBody = (
  asset: string,
  lines: { handle: string; amount: string }[],
  extra: Record<string, unknown> = {},
) => ({
  mode: "handle",
  chain: "solana-devnet",
  asset,
  handles: lines,
  refundRecipient: REFUND,
  ...extra,
});

const lines = (n: number, amount = "1000000") =>
  Array.from({ length: n }, (_, i) => ({ handle: `p${String(i)}`, amount }));

const putUsdc = (svm: FakeSvm) =>
  svm.putAccount(DEVNET_USDC, TOKEN_PROGRAM, classicMintData({ decimals: 6, freeze: true }));
const putPump = (svm: FakeSvm) =>
  svm.putAccount(PUMP_MINT, TOKEN_2022_PROGRAM, fromB64(PUMP_MINT_DATA));
/** Its pump.fun bonding curve, owned by the pump program: the launchpad sign. */
const putPumpCurve = (svm: FakeSvm) =>
  svm.putAccount(
    PUMP_CURVE,
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    Uint8Array.from([...Buffer.from("17b7f83760d8ac60", "hex"), ...new Uint8Array(143)]),
  );

// --- the token account address -----------------------------------------------------------------

describe("the associated token account, real accounts read on chain", () => {
  it("the program ids", () => {
    expect(pubkeyToBase58(TOKEN_PROGRAM_ID)).toBe(TOKEN_PROGRAM);
    expect(pubkeyToBase58(TOKEN_2022_PROGRAM_ID)).toBe(TOKEN_2022_PROGRAM);
    expect(pubkeyToBase58(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(ATA_PROGRAM);
  });

  it("classic, devnet USDC", () => {
    const ata = associatedTokenAddress(
      pubkeyFromBase58(DEVNET_USDC_HOLDER),
      pubkeyFromBase58(DEVNET_USDC),
      TOKEN_PROGRAM_ID,
    );
    expect(pubkeyToBase58(ata)).toBe(DEVNET_USDC_HOLDER_ATA);
  });

  it("Token-2022, the pump coin's curve account on mainnet", () => {
    const ata = associatedTokenAddress(
      pubkeyFromBase58(PUMP_CURVE),
      pubkeyFromBase58(PUMP_MINT),
      TOKEN_2022_PROGRAM_ID,
    );
    expect(pubkeyToBase58(ata)).toBe(PUMP_CURVE_ATA);
  });
});

// --- the instruction ---------------------------------------------------------------------------

describe("create_drop with a mint, 6.1", () => {
  const relayer = new Uint8Array(32).fill(1);
  const drop = new Uint8Array(32).fill(2);
  const bitmap = new Uint8Array(32).fill(3);
  const params = {
    merkleRoot: new Uint8Array(32).fill(4),
    manifestHash: new Uint8Array(32).fill(5),
    totalEntitlements: 3n,
    leafCount: 3,
    refundRecipient: new Uint8Array(32).fill(6),
    creatorCommitment: new Uint8Array(32).fill(7),
    nonce: 0n,
    fundingPeriod: 1,
    claimPeriod: 1,
    solFeeLamports: 100_000_000n,
  };

  it("passes mint, vault (writable), the token program and the ATA program in the program's order", () => {
    const mint = pubkeyFromBase58(PUMP_MINT);
    const vault = new Uint8Array(32).fill(9);
    const ix = createDropInstruction({
      relayer,
      drop,
      bitmap,
      params,
      token: { mint, vault, tokenProgram: TOKEN_2022_PROGRAM_ID },
    });
    expect(
      ix.keys.slice(4).map((k) => [pubkeyToBase58(k.pubkey), k.isWritable, k.isSigner]),
    ).toEqual([
      [PUMP_MINT, false, false],
      [pubkeyToBase58(vault), true, false],
      [TOKEN_2022_PROGRAM, false, false],
      [ATA_PROGRAM, false, false],
      ["11111111111111111111111111111111", false, false],
    ]);
  });

  it("a SOL drop keeps the four slots absent", () => {
    const ix = createDropInstruction({
      relayer,
      drop,
      bitmap,
      params: { ...params, solFeeLamports: 0n },
    });
    for (const k of ix.keys.slice(4, 8)) {
      expect(pubkeyToBase58(k.pubkey)).toBe(pubkeyToBase58(DROPCHAD_PROGRAM_ID));
    }
  });
});

// --- the decoder -------------------------------------------------------------------------------

describe("the Drop account's token fields, 5.2 fields 20 to 22", () => {
  it("a 360 byte drop from before reads zero in all three", async () => {
    const w = await world();
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(2)));
    expect(res.status).toBe(201);
    const { drop } = (await res.json()) as { drop: { address: string } };
    const info = await w.rpc.getAccountInfo(pubkeyFromBase58(drop.address), "confirmed");
    if (info === null) throw new Error("no drop");
    const old = decodeDrop({ ...info, data: info.data.subarray(0, DROP_ACCOUNT_BYTES) });
    expect([old.solFeeLamports, old.accountBudgetLamports, old.accountBudgetUsed]).toEqual([
      0n,
      0n,
      0n,
    ]);
    const now = decodeDrop(info);
    expect(now.solFeeLamports).toBe(20_000_000n); // 3 usd at 150 usd a SOL
    expect(now.accountBudgetLamports).toBe(2n * rentFor(165));
    expect(now.accountBudgetUsed).toBe(0n);
  });
});

// --- the fee -----------------------------------------------------------------------------------

describe("the fee tiers", () => {
  const tiers = parseTokenFeeTiers(loadConfig({ ...TEST_ENV }).TOKEN_FEE_TIERS_USD);

  it("are api config, the 's table by default, and end at 500 people", () => {
    expect(tiers).toEqual([
      { upTo: 5, usd: "1" },
      { upTo: 20, usd: "3" },
      { upTo: 50, usd: "6" },
      { upTo: 100, usd: "10" },
      { upTo: 500, usd: "20" },
    ]);
    expect(tokenMaxPeople(tiers)).toBe(500);
    expect(MAX_SOL_FEE_LAMPORTS).toBe(SOL);
  });

  it("each edge picks its tier", () => {
    const at = (n: number) => tokenFeeTierUsd(n, tiers);
    expect([1, 5, 6, 20, 21, 50, 51, 100, 101, 500].map(at)).toEqual([
      "1",
      "1",
      "3",
      "3",
      "6",
      "6",
      "10",
      "10",
      "20",
      "20",
    ]);
    expect(() => at(0)).toThrow();
    expect(() => at(501)).toThrow();
  });

  it("refuses a table that does not go up", () => {
    expect(() => parseTokenFeeTiers("5:15,3:25")).toThrow();
    expect(() => parseTokenFeeTiers("")).toThrow();
    expect(() => parseTokenFeeTiers("5:abc")).toThrow();
    expect(() => loadConfig({ ...TEST_ENV, TOKEN_FEE_TIERS_USD: "5:15,3:25" })).toThrow();
  });

  it("usd to lamports at the SOL price, rounded up", () => {
    expect(usdToLamports("15", 150)).toBe(100_000_000n);
    expect(usdToLamports("37.50", 100)).toBe(375_000_000n);
    expect(usdToLamports("15", 143.27)).toBe(104_697_425n); // 104,697,424.4 rounded up
    expect(usdToLamports("60", 60)).toBe(SOL);
    expect(usdToLamports("60", 59.99)).toBe(1_000_166_695n);
  });
});

// --- the route ---------------------------------------------------------------------------------

describe("POST /api/drops with a token, the happy path", () => {
  it("devnet USDC: the vault, the tier fee, the budget, the row and the two part funding", async () => {
    const w = await world();
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(3)));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      drop: Record<string, unknown> & { address: string };
      funding: Record<string, unknown> & { token: Record<string, unknown> };
    };
    const dropKey = pubkeyFromBase58(body.drop.address);
    const vault = fakeAta(dropKey, pubkeyFromBase58(DEVNET_USDC), pubkeyFromBase58(TOKEN_PROGRAM));
    const fee = 20_000_000n; // 3 usd at 150 usd a SOL
    const budget = 3n * rentFor(165);

    expect(body.drop).toMatchObject({
      asset: DEVNET_USDC,
      assetKind: "token",
      feeAmountWei: "0",
      totalEntitlementsWei: "3000000",
      grossRequiredWei: "3000000",
      leafCount: 3,
      mode: "handle",
    });
    // The top part is the SOL to send, the token part the tokens; both to the drop.
    expect(body.funding).toMatchObject({
      family: "svm",
      address: body.drop.address,
      asset: "native",
      symbol: "SOL",
      // Rounded up to 0.001 SOL; the extra goes back at the end.
      amountBaseUnits: upToMilliSol(fee + budget).toString(),
    });
    expect(body.funding["paymentUri"]).toMatch(
      new RegExp(`^solana:${body.drop.address}\\?amount=`),
    );
    expect(body.funding.token).toEqual({
      mint: DEVNET_USDC,
      vault: pubkeyToBase58(vault),
      tokenProgram: TOKEN_PROGRAM,
      // devnet USDC is a quick token, so the name and ticker are ours.
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "3000000",
      amountDisplay: "3",
      paymentUri: `solana:${body.drop.address}?amount=3&spl-token=${DEVNET_USDC}`,
    });

    // The chain: the vault exists under the classic program, the fee and the budget on the drop.
    expect(pubkeyToBase58(w.svm.ownerOf(vault) as Pubkey)).toBe(TOKEN_PROGRAM);
    const onChain = w.svm.drop(dropKey) as FakeDrop;
    expect(onChain.solFeeLamports).toBe(fee);
    expect(onChain.accountBudgetLamports).toBe(budget);

    const [row] = await w.rows();
    expect(row).toMatchObject({
      asset: DEVNET_USDC,
      tokenProgram: TOKEN_PROGRAM,
      tokenDecimals: 6,
      tokenName: "USD Coin",
      tokenSymbol: "USDC",
      vault: pubkeyToBase58(vault),
      solFeeLamports: fee.toString(),
      accountBudgetLamports: budget.toString(),
      feeTierUsd: "3",
      feeSolPriceUsd: "150",
      // no launchpad sign on devnet USDC.
      tokenLaunchpad: null,
      feeAmount: "0",
      grossRequired: "3000000",
      priceUsd: null,
    });
    const jobs = await (harness as Harness).deps.db
      .select()
      .from(dropJobs)
      .where(eq(dropJobs.dropAddress, row?.address ?? ""));
    expect(jobs.map((j) => j.kind)).toEqual(["watch_funding"]);
  });

  it("the real pump.fun coin, Token-2022: 170 byte accounts, its name, a duplicate merged, tiny amounts fine", async () => {
    const w = await world();
    putPump(w.svm);
    putPumpCurve(w.svm);
    // 7 lines, p0 twice: 6 people, so the 25 usd tier. 1 base unit is fine, no usd minimum.
    const res = await w.post(
      tokenBody(PUMP_MINT, [...lines(6, "1"), { handle: "@P0", amount: "1" }]),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      drop: { address: string; leafCount: number };
      funding: { amountBaseUnits: string; token: Record<string, unknown> };
    };
    const fee = 53_333_334n; // 8 usd at 150, rounded up
    const budget = 6n * rentFor(170);
    expect(body.drop.leafCount).toBe(6);
    expect(body.funding.amountBaseUnits).toBe(upToMilliSol(fee + budget).toString());
    expect(body.funding.token).toMatchObject({
      tokenProgram: TOKEN_2022_PROGRAM,
      name: "Doomed Rocket",
      symbol: "DOOROC",
      decimals: 6,
      amountBaseUnits: "7",
      amountDisplay: "0.000007",
    });
    const [row] = await w.rows();
    expect(row).toMatchObject({
      tokenProgram: TOKEN_2022_PROGRAM,
      tokenName: "Doomed Rocket",
      tokenSymbol: "DOOROC",
      // the check saw the pump.fun curve, kept on the row.
      tokenLaunchpad: "pump.fun",
      feeTierUsd: "8",
      solFeeLamports: fee.toString(),
      accountBudgetLamports: budget.toString(),
    });
  });

  it("a fee of exactly 1 SOL is fine", async () => {
    const w = await world({ solPrice: 3 });
    putUsdc(w.svm);
    expect((await w.post(tokenBody(DEVNET_USDC, lines(1)))).status).toBe(201);
    expect(((await w.rows())[0] as { solFeeLamports: string }).solFeeLamports).toBe(SOL.toString());
  });

  it("the relayer's budget counts the vault rent with the drop and the bitmap", async () => {
    const w = await world();
    putUsdc(w.svm);
    expect((await w.post(tokenBody(DEVNET_USDC, lines(1)))).status).toBe(201);
    expect(w.reserves).toEqual([5_000n + rentFor(424) + rentFor(1291) + rentFor(165)]);
  });

  it("a SOL drop is unchanged: no token part, no token columns", async () => {
    const w = await world();
    const res = await w.post({
      mode: "handle",
      chain: "solana-devnet",
      handles: lines(2, "10000000"),
      refundRecipient: REFUND,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      drop: { assetKind: string };
      funding: { token?: unknown };
    };
    expect(body.drop.assetKind).toBe("native");
    expect(body.funding.token).toBeUndefined();
    expect(w.reserves).toEqual([5_000n + rentFor(424) + rentFor(1291)]);
    expect((await w.rows())[0]).toMatchObject({
      tokenProgram: null,
      vault: null,
      solFeeLamports: null,
      feeTierUsd: null,
    });
  });
});

describe("POST /api/drops with a token, refused before anything is sent", () => {
  it("a mint in address mode, or an asset that is not a key: invalid_asset", async () => {
    const w = await world();
    putUsdc(w.svm);
    const address = await w.post({
      mode: "address",
      chain: "solana-devnet",
      asset: DEVNET_USDC,
      receivers: [{ address: REFUND, amount: "1000000" }],
      refundRecipient: REFUND,
    });
    expect(address.status).toBe(400);
    expect(await address.json()).toMatchObject({ error: "invalid_asset" });
    const notKey = await w.post(tokenBody("not-a-mint", lines(1)));
    expect(notKey.status).toBe(400);
    expect(await notKey.json()).toMatchObject({ error: "invalid_asset" });
    expect(w.creates()).toBe(0);
    expect(await w.rows()).toHaveLength(0);
  });

  it("a token on Robinhood before DropFactoryV3: invalid_asset", async () => {
    const w = await world();
    const res = await w.post({
      mode: "handle",
      chain: w.evm.chainKey,
      asset: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      handles: lines(1),
      refundRecipient: EVM_REFUND,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_asset" });
    expect(await w.rows()).toHaveLength(0);
  });

  it("a token the check refuses: token_refused with its reason", async () => {
    const w = await world();
    const frozen = pubkeyToBase58(new Uint8Array(32).fill(77));
    w.svm.putAccount(frozen, TOKEN_PROGRAM, classicMintData({ freeze: true }));
    const res = await w.post(tokenBody(frozen, lines(1)));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "token_refused",
      reason: "the creator can freeze it",
    });
    const nothing = await w.post(tokenBody(pubkeyToBase58(new Uint8Array(32).fill(78)), lines(1)));
    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toMatchObject({ error: "token_refused", reason: "not a token" });
    expect(w.creates()).toBe(0);
    expect(await w.rows()).toHaveLength(0);
  });

  it("no token check on this api: solana_unavailable", async () => {
    const w = await world({ checker: false });
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(1)));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "solana_unavailable" });
    expect(w.creates()).toBe(0);
  });

  it("no SOL price: price_unavailable, in the 's words", async () => {
    const w = await world({ solPrice: null });
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(1)));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "price_unavailable",
      message: "no SOL price right now, try again in a minute.",
    });
    expect(w.creates()).toBe(0);
  });

  it("a fee over 1 SOL: fee_too_high, in the 's words", async () => {
    const w = await world({ solPrice: 2 }); // 3 usd is 1.5 SOL
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(1)));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "fee_too_high",
      message: "the fee is too high right now, try again later.",
    });
    expect(w.creates()).toBe(0);
  });

  it("more than 500 people: too_many, whatever HANDLE_MAX_RECEIVERS says", async () => {
    const w = await world({ env: { HANDLE_MAX_RECEIVERS: "600" }, users: 501 });
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(501)));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("too_many");
    expect(body.message).toContain("500");
    expect(w.creates()).toBe(0);
  });

  it("a tier fee under the relayer's estimate: fee_below_gas", async () => {
    // 400,000 units at 1,000,000,000 micro lamports: 0.4 SOL a transaction, far above 3 usd.
    const w = await world({ priorityFeeMicroLamports: 1_000_000_000n });
    putUsdc(w.svm);
    const res = await w.post(tokenBody(DEVNET_USDC, lines(1)));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "fee_below_gas" });
    expect(w.creates()).toBe(0);
  });
});

describe("POST /api/drops with a token, the read back", () => {
  it("any field the chain got wrong: chain_disagreed, and no row", async () => {
    const w = await world();
    putUsdc(w.svm);
    const other = new Uint8Array(32).fill(99);
    const lies: [string, (d: FakeDrop) => FakeDrop][] = [
      ["asset", (d) => ({ ...d, asset: other })],
      ["vault", (d) => ({ ...d, vault: other })],
      ["feeAmount", (d) => ({ ...d, feeAmount: 1n })],
      ["grossRequired", (d) => ({ ...d, grossRequired: d.grossRequired + 1n })],
      ["solFeeLamports", (d) => ({ ...d, solFeeLamports: (d.solFeeLamports ?? 0n) + 1n })],
      [
        "accountBudgetLamports",
        (d) => ({ ...d, accountBudgetLamports: (d.accountBudgetLamports ?? 0n) + 1n }),
      ],
    ];
    for (const [field, lie] of lies) {
      w.svm.tamperCreate = lie;
      const res = await w.post(tokenBody(DEVNET_USDC, lines(2)));
      expect([field, res.status]).toEqual([field, 500]);
      const body = (await res.json()) as { error: string; message: string };
      expect([field, body.error]).toEqual([field, "chain_disagreed"]);
      expect(body.message).toContain(field);
    }
    expect(await w.rows()).toHaveLength(0);
  });
});
