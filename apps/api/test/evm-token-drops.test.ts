/**
 * Robinhood token drops, the api. Off until `DropFactoryV3`
 * is recorded in `packages/chains`; here a fake chain plays V3 (version 3) to test what happens
 * once it is.
 *
 * - `GET /api/tokens/:address?chain=robinhood`: the EVM check when it is on, `400
 *   chain_not_supported` while it is off, `400 bad_mint`, `503 robinhood_unavailable`, the logo
 *   route `404 no_logo`.
 * - `POST /api/drops` with a token on Robinhood: handle mode only, the token checked again, the
 *   tier fee in ETH rounded up to 0.00001 ETH, at most 0.05 ETH, no price, the gas guard with the
 *   token gas numbers, the `NativeFeeSet` read back, the `0018` columns reused, two part funding.
 * - The `token` object on the drop page; `GET /api/chains` tiers with `wei` once V3 is on.
 * - The pieces under it: the fee rule, the relayer's V3 `createDrop`, `evmFactoryFor`, the
 *   `NativeFeeSet` decoder, the adapter's token gas estimate.
 */
import { getChain, type DeployedChain } from "@dropchad/chains";
import { dropFactoryV3Abi } from "@dropchad/shared";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { createEvmTokenChecker, type Erc20Reads } from "../src/chain/evm/token-check.js";
import { decodeNativeFeeSet } from "../src/chain/gateway.js";
import {
  ALLOWED_SELECTORS,
  CREATE_DROP_V3_SELECTOR,
  RelayerRefusedError,
  createRelayer,
  type CreateDropParams,
  type ReceiptLike,
} from "../src/chain/relayer.js";
import { evmFactoryFor } from "../src/chain/write-side.js";
import { drops } from "../src/db/schema.js";
import { MAX_ETH_FEE_WEI, tokenFeeRule, usdToWei } from "../src/drops/token-fee.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor, FAKE_CHAIN_ID, type FakeChain } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV } from "./test-binders.js";

const TEST = getAddress("0x7e57000000000000000000000000000000007e57");
const NOT_LISTED = getAddress("0x0bad000000000000000000000000000000000bad");
const REFUND = getAddress("0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD");
const ONE = 10n ** 18n;

/** X accounts the harness X stub knows: `p0`, `p1`, ... */
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(9_000_000_000 + i),
    username: `p${String(i)}`,
    name: `P ${String(i)}`,
  }));

const priceOf = (eth: number | null): PriceService => ({
  usdPrice: (symbol) => Promise.resolve(symbol === "ETH" ? eth : null),
});

/** The chain as the EVM check reads it: TEST is listed and plain, anything else is not listed. */
function fakeReads(options: { down?: boolean } = {}): Erc20Reads {
  const up = <T>(value: T) =>
    options.down === true ? Promise.reject(new Error("rpc down")) : Promise.resolve(value);
  return {
    code: () => up(`0x6080604052${"00".repeat(64)}` as Hex),
    slot: () => up(0n),
    decimals: () => up(18),
    name: () => up("Test Coin"),
    symbol: () => up("TEST"),
    allowedToken: (token) => up(getAddress(token) === TEST),
    fromLaunchpad: () => up(false),
  };
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

interface WorldOptions {
  /** 3 is V3 recorded, token drops on; 2 is today. */
  readonly version?: 2 | 3;
  readonly ethPrice?: number | null;
  readonly gasPrice?: bigint;
  readonly checker?: boolean;
  readonly readsDown?: boolean;
  readonly tamperNativeFee?: (fee: bigint) => bigint;
  readonly users?: number;
}

async function world(options: WorldOptions = {}) {
  const chain: FakeChain = createFakeChain({
    version: options.version ?? 3,
    defaultFeeBps: 100,
    gasPrice: options.gasPrice ?? 0n,
    ...(options.tamperNativeFee === undefined ? {} : { tamperNativeFee: options.tamperNativeFee }),
  });
  harness = await createHarness({
    writeSides: singleAdapter(evmAdapterFor(chain)),
    prices: priceOf(options.ethPrice === undefined ? 2_000 : options.ethPrice),
    ...(options.checker === false
      ? {}
      : {
          evmTokenChecker: createEvmTokenChecker({
            reads: fakeReads({ down: options.readsDown === true }),
          }),
        }),
    // The tier mechanics at the prices on purpose; the defaults are in config.test.ts.
    env: {
      X_BEARER_TOKEN: "test-bearer",
      ...TEST_BINDER_ENV,
      TOKEN_FEE_TIERS_USD: "5:3,20:8,50:15,100:25,500:40",
    },
    xLookup: people(options.users ?? 10),
  });
  const { jar } = await login(harness);
  const headers = {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
  const app = harness.app;
  const post = (body: unknown) =>
    app.request("/api/drops", { method: "POST", headers, body: JSON.stringify(body) });
  const get = (path: string) => app.request(path, { headers });
  const rows = () => (harness as Harness).deps.db.select().from(drops);
  return { chain, post, get, rows };
}

const tokenBody = (
  asset: string,
  n: number,
  extra: Record<string, unknown> = {},
  amount: bigint = 1_000n * ONE,
) => ({
  mode: "handle",
  chain: "robinhood-testnet",
  asset,
  handles: Array.from({ length: n }, (_, i) => ({
    handle: `p${String(i)}`,
    amount: amount.toString(),
  })),
  refundRecipient: REFUND,
  ...extra,
});

// --- the check route -------------------------------------------------------------------------

describe("GET /api/tokens/:address?chain=robinhood", () => {
  it("off, no V3 recorded: 400 chain_not_supported, as today", async () => {
    const w = await world({ version: 2, checker: false });
    const res = await w.get(`/api/tokens/${TEST}?chain=robinhood`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "chain_not_supported" });
    const logo = await w.get(`/api/tokens/${TEST}/logo?chain=robinhood`);
    expect(await logo.json()).toEqual({ error: "chain_not_supported" });
  });

  it("on: the check, the same shape as Solana's", async () => {
    const w = await world();
    const res = await w.get(`/api/tokens/${TEST}?chain=robinhood`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mint: TEST,
      tokenProgram: "erc20",
      name: "Test Coin",
      symbol: "TEST",
      decimals: 18,
      logoUrl: null,
      launchpad: null,
      ok: true,
      reason: null,
    });
  });

  it("a token on no list: ok false with the plain reason", async () => {
    const w = await world();
    const body = (await (await w.get(`/api/tokens/${NOT_LISTED}?chain=robinhood`)).json()) as {
      ok: boolean;
      reason: string;
    };
    expect(body).toMatchObject({ ok: false, reason: "it is not on our list yet" });
  });

  it("not a 20 byte 0x address: 400 bad_mint, before any read", async () => {
    const w = await world();
    for (const bad of ["0x1234", "So11111111111111111111111111111111111111112", "0xZZ"]) {
      const res = await w.get(`/api/tokens/${bad}?chain=robinhood`);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_mint" });
    }
  });

  it("a chain that cannot be read: 503 robinhood_unavailable", async () => {
    const w = await world({ readsDown: true });
    const res = await w.get(`/api/tokens/${TEST}?chain=robinhood`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "robinhood_unavailable" });
  });

  it("an ERC20 has no logo: the logo route says 404 no_logo", async () => {
    const w = await world();
    const res = await w.get(`/api/tokens/${TEST}/logo?chain=robinhood`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_logo" });
  });
});

// --- create ----------------------------------------------------------------------------------

describe("POST /api/drops with a token on Robinhood", () => {
  it("the happy path: V3 createDrop with the ETH fee, the row, the two part funding", async () => {
    // 2 people is the $3 tier; at 2,345 usd an ETH that is 0.0012793... ETH, rounded up to
    // a whole 0.00001 ETH: 0.00128 ETH.
    const w = await world({ ethPrice: 2_345 });
    const res = await w.post(tokenBody(TEST, 2));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      drop: Record<string, unknown> & { address: string };
      funding: Record<string, unknown> & { token: Record<string, unknown> };
    };
    const fee = 1_280_000_000_000_000n;
    const drop = getAddress(body.drop.address);

    const sent = w.chain.creates[0] as CreateDropParams;
    expect(sent.asset).toBe(TEST);
    expect(sent.nativeFee).toBe(fee);
    expect(sent.tokenFactory).toBe(zeroAddress);

    expect(body.drop).toMatchObject({
      asset: TEST,
      assetKind: "token",
      feeAmountWei: "0",
      totalEntitlementsWei: (2_000n * ONE).toString(),
      grossRequiredWei: (2_000n * ONE).toString(),
      mode: "handle",
    });
    expect(body.funding).toMatchObject({
      family: "evm",
      address: drop,
      chainId: FAKE_CHAIN_ID,
      symbol: "ETH",
      amountBaseUnits: fee.toString(),
      amountDisplay: "0.00128",
      paymentUri: `ethereum:${drop}@${String(FAKE_CHAIN_ID)}?value=${fee.toString()}`,
    });
    expect(body.funding.token).toMatchObject({
      mint: TEST,
      vault: drop,
      tokenProgram: "erc20",
      name: "Test Coin",
      symbol: "TEST",
      decimals: 18,
      amountBaseUnits: (2_000n * ONE).toString(),
      amountDisplay: "2000",
      paymentUri: `ethereum:${TEST}@${String(FAKE_CHAIN_ID)}/transfer?address=${drop}&uint256=${(2_000n * ONE).toString()}`,
    });

    const [row] = await w.rows();
    expect(row).toMatchObject({
      tokenProgram: "erc20",
      tokenDecimals: 18,
      tokenName: "Test Coin",
      tokenSymbol: "TEST",
      tokenLaunchpad: null,
      solFeeLamports: fee.toString(),
      accountBudgetLamports: "0",
      feeTierUsd: "3",
      feeSolPriceUsd: "2345",
    });
    expect(String(row?.vault).toLowerCase()).toBe(drop.toLowerCase());
  });

  it("the drop page: the token object and, while created, the same funding", async () => {
    const w = await world();
    const created = (await (await w.post(tokenBody(TEST, 2))).json()) as {
      drop: { address: string };
      funding: unknown;
    };
    const detail = (await (await w.get(`/api/drops/${created.drop.address}`)).json()) as {
      ours: { data: Record<string, unknown> };
    };
    expect(detail.ours.data["token"]).toEqual({
      mint: TEST,
      symbol: "TEST",
      name: "Test Coin",
      decimals: 18,
      tokenProgram: "erc20",
      logoUrl: `/api/tokens/${TEST}/logo?chain=robinhood`,
      launchpad: null,
    });
    expect(detail.ours.data["funding"]).toEqual(created.funding);
  });

  it("off, no V3 recorded: 400 invalid_asset and nothing sent", async () => {
    const w = await world({ version: 2 });
    const res = await w.post(tokenBody(TEST, 2));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_asset");
    expect(w.chain.creates).toHaveLength(0);
  });

  it("a token in address mode: 400 invalid_asset", async () => {
    const w = await world();
    const res = await w.post({
      mode: "address",
      chain: "robinhood-testnet",
      asset: TEST,
      receivers: [{ address: REFUND, amount: "1000" }],
      refundRecipient: REFUND,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_asset");
  });

  it("a token on no list: 400 token_refused with the plain reason", async () => {
    const w = await world();
    const res = await w.post(tokenBody(NOT_LISTED, 2));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "token_refused",
      reason: "it is not on our list yet",
    });
    expect(w.chain.creates).toHaveLength(0);
  });

  it("no Robinhood token check: 503 robinhood_unavailable", async () => {
    const w = await world({ checker: false });
    const res = await w.post(tokenBody(TEST, 2));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("robinhood_unavailable");
  });

  it("no ETH price: price_unavailable, in the 's words", async () => {
    const w = await world({ ethPrice: null });
    const res = await w.post(tokenBody(TEST, 1));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "price_unavailable",
      message: "no ETH price right now, try again in a minute.",
    });
  });

  it("a fee over 0.05 ETH: fee_too_high", async () => {
    const w = await world({ ethPrice: 50 }); // $3 is 0.06 ETH
    const res = await w.post(tokenBody(TEST, 1));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("fee_too_high");
    expect(w.chain.creates).toHaveLength(0);
  });

  it("a fee of exactly 0.05 ETH is fine", async () => {
    const w = await world({ ethPrice: 60 }); // $3 is 0.05 ETH
    expect((await w.post(tokenBody(TEST, 1))).status).toBe(201);
    expect(w.chain.creates[0]?.nativeFee).toBe(MAX_ETH_FEE_WEI);
  });

  it("with the token gas numbers: a fee the native numbers would pass is refused", async () => {
    // 2 people at 2,000 usd: $3 is 0.0015 ETH. At 2 gwei the native numbers cost
    // (360k + 90k + 2 x 130k) x 2 gwei = 0.00142 ETH, under the fee; the token numbers cost
    // (400k + 130k + 2 x 160k) x 2 gwei = 0.0017 ETH, over it.
    const w = await world({ gasPrice: 2_000_000_000n });
    const res = await w.post(tokenBody(TEST, 2));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("fee_below_gas");
  });

  it("the chain reports another ETH fee: chain_disagreed, and no row", async () => {
    const w = await world({ tamperNativeFee: (fee) => fee + 1n });
    const res = await w.post(tokenBody(TEST, 2));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("chain_disagreed");
    expect(await w.rows()).toHaveLength(0);
  });
});

// --- the create page tiers -------------------------------------------------------------------

describe("GET /api/chains on Robinhood", () => {
  it("off: tokenFeeTiers null", async () => {
    const w = await world({ version: 2 });
    const body = (await (await w.get("/api/chains")).json()) as {
      chains: { family: string; tokenFeeTiers: unknown }[];
    };
    expect(body.chains.find((c) => c.family === "evm")?.tokenFeeTiers).toBeNull();
  });

  it("on: each tier with `wei`, the ETH estimate rounded up like at create", async () => {
    const w = await world({ ethPrice: 2_000 });
    const body = (await (await w.get("/api/chains")).json()) as {
      chains: { family: string; tokenFeeTiers: Record<string, unknown>[] | null }[];
    };
    const tiers = body.chains.find((c) => c.family === "evm")?.tokenFeeTiers;
    expect(tiers?.[0]).toEqual({ upTo: 5, usd: "3", wei: "1500000000000000" });
    expect(tiers?.[4]).toEqual({ upTo: 500, usd: "40", wei: "20000000000000000" });
  });
});

// --- the pieces under it ---------------------------------------------------------------------

describe("the ETH fee rule", () => {
  it("usd to wei at the ETH price, rounded up to a whole 0.00001 ETH", () => {
    expect(usdToWei("3", 2_000)).toBe(1_500_000_000_000_000n);
    expect(usdToWei("3", 2_345)).toBe(1_280_000_000_000_000n);
    expect(usdToWei("40", 3_000)).toBe(13_340_000_000_000_000n); // 0.013333... up to 0.01334
  });

  it("the cap is 0.05 ETH; Solana keeps lamports and 1 SOL", () => {
    expect(MAX_ETH_FEE_WEI).toBe(50_000_000_000_000_000n);
    expect(tokenFeeRule("evm").cap).toBe(MAX_ETH_FEE_WEI);
    expect(tokenFeeRule("evm").toBaseUnits("3", 2_000)).toBe(1_500_000_000_000_000n);
    expect(tokenFeeRule("svm").cap).toBe(1_000_000_000n);
    expect(tokenFeeRule("svm").toBaseUnits("15", 150)).toBe(100_000_000n);
  });
});

describe("the relayer's createDrop on DropFactoryV3", () => {
  const FACTORY = getAddress("0x00000000000000000000000000000000000fac73");
  const params: CreateDropParams = {
    asset: TEST,
    merkleRoot: `0x${"11".repeat(32)}`,
    manifestHash: `0x${"22".repeat(32)}`,
    totalEntitlements: 1_000n,
    leafCount: 1,
    refundRecipient: REFUND,
    creatorCommitment: `0x${"33".repeat(32)}`,
    nonce: 0n,
    fundingPeriod: 3_600,
    claimPeriod: 86_400,
    tokenFactory: zeroAddress,
    nativeFee: 1_500_000_000_000_000n,
  };

  function relayerFor(version: 1 | 2 | 3) {
    const sent: { to: Address; data: Hex }[] = [];
    const ok: ReceiptLike = {
      status: "success",
      transactionHash: `0x${"aa".repeat(32)}`,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [],
    };
    const relayer = createRelayer({
      transport: {
        address: getAddress("0x000000000000000000000000000000000000be11"),
        pendingNonce: () => Promise.resolve(0),
        estimateGas: () => Promise.resolve(400_000n),
        maxFeePerGas: () => Promise.resolve(1n),
        send: (tx) => {
          sent.push({ to: tx.to, data: tx.data });
          return Promise.resolve(ok.transactionHash);
        },
        waitForReceipt: () => Promise.resolve(ok),
      },
      factory: FACTORY,
      factoryVersion: version,
      isKnownDrop: () => Promise.resolve(false),
      gasBudget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      gasCaps: { createDrop: 2_000_000n, claimBatch: 2_000_000n, claimHandle: 300_000n },
    });
    return { relayer, sent };
  }

  it("V3: the V3 selector, the ETH fee inside the struct", async () => {
    const { relayer, sent } = relayerFor(3);
    await relayer.createDrop(params);
    const data = sent[0]?.data as Hex;
    expect(data.slice(0, 10)).toBe(CREATE_DROP_V3_SELECTOR);
    expect(CREATE_DROP_V3_SELECTOR).not.toBe(ALLOWED_SELECTORS.createDrop);
    const decoded = decodeFunctionData({ abi: dropFactoryV3Abi, data });
    expect((decoded.args[0] as { nativeFee: bigint }).nativeFee).toBe(params.nativeFee);
  });

  it("V2: the old selector, and an ETH fee is refused, never dropped in silence", async () => {
    const { relayer, sent } = relayerFor(2);
    await expect(relayer.createDrop(params)).rejects.toBeInstanceOf(RelayerRefusedError);
    await relayer.createDrop({ ...params, nativeFee: 0n });
    expect(sent[0]?.data.slice(0, 10)).toBe(ALLOWED_SELECTORS.createDrop);
  });
});

describe("evmFactoryFor", () => {
  const live = getChain("robinhood-testnet") as DeployedChain;
  const v3 = {
    factoryV3: "0x0000000000000000000000000000000000000f03",
    implementationV3: "0x0000000000000000000000000000000000000d03",
    deployBlockV3: 130_000_000,
  };

  it("today: V4 on robinhood testnet since, over V3", () => {
    expect(evmFactoryFor(live).version).toBe(4);
  });

  it("with V3 recorded and no V4: V3 creates every new drop, with the live registry", () => {
    const noV4 = { factoryV4: null, implementationV4: null, deployBlockV4: null };
    const picked = evmFactoryFor({ ...live, contracts: { ...live.contracts, ...v3, ...noV4 } });
    expect(picked).toEqual({
      version: 3,
      factory: getAddress(v3.factoryV3),
      implementation: getAddress(v3.implementationV3),
      binderRegistry: getAddress(live.contracts.binderRegistry as string),
    });
  });
});

describe("decodeNativeFeeSet", () => {
  const factory = getAddress("0x00000000000000000000000000000000000fac73");
  const drop = getAddress("0x00000000000000000000000000000000000d70b0");
  const item = getAbiItem({ abi: dropFactoryV3Abi, name: "NativeFeeSet" });
  const log = (from: Address, fee: bigint) => ({
    address: from,
    topics: encodeEventTopics({ abi: [item], eventName: "NativeFeeSet", args: { drop } }) as Hex[],
    data: encodeAbiParameters([{ name: "nativeFee", type: "uint256" }], [fee]),
  });

  it("reads the factory's own log", () => {
    expect(decodeNativeFeeSet({ logs: [log(factory, 7n)] }, factory)).toBe(7n);
  });

  it("ignores a log from anywhere else; none at all is null", () => {
    expect(decodeNativeFeeSet({ logs: [log(drop, 7n)] }, factory)).toBeNull();
    expect(decodeNativeFeeSet({ logs: [] }, factory)).toBeNull();
  });
});

describe("the EVM adapter's estimate for a token drop", () => {
  it("uses the token numbers when the shape says token", async () => {
    const adapter = evmAdapterFor(createFakeChain({ version: 3, gasPrice: 1n }));
    const native = await adapter.estimateRelayerCost({
      addressLeaves: 0,
      handleLeaves: 2,
      leafCount: 2,
    });
    const token = await adapter.estimateRelayerCost({
      addressLeaves: 0,
      handleLeaves: 2,
      leafCount: 2,
      token: true,
    });
    expect(native.cost).toBe(360_000n + 90_000n + 2n * 130_000n);
    expect(token.cost).toBe(400_000n + 130_000n + 2n * 160_000n);
  });

  it("token drops exist on the adapter only on V3", () => {
    expect(evmAdapterFor(createFakeChain({ version: 3 })).tokenVault).toBeDefined();
    expect(evmAdapterFor(createFakeChain({ version: 2 })).tokenVault).toBeUndefined();
  });
});
