/**
 * `POST /api/drops/check`. amount check on `/create`.
 * - the same X sign in and CSRF as `POST /api/drops`, 30 a minute per session, never counted
 *   toward the create limit of 5 an hour
 * - the amounts only, one per person after merging, in base units; no handle, no address
 * - the create checks in the create order, stopping at the first refusal: `too_many`,
 *   `drop_too_big`, then native `price_unavailable`, `below_min_usd`, `fee_below_gas`, token
 *   `price_unavailable`, `fee_too_high`, `fee_below_gas`; the same codes and bodies as create
 * - all good is `200 { ok: true }`, and nothing is made: no chain write, no row, no X call
 */
import { getChain } from "@dropchad/chains";
import { afterEach, describe, expect, it } from "vitest";

import { adaptersFrom, singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { createTokenChecker } from "../src/chain/svm/token-check.js";
import { drops } from "../src/db/schema.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor, type FakeChainOptions } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";
import { DEVNET_USDC, TOKEN_PROGRAM, classicMintData } from "./token-fixtures.js";

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const C = "0xCcCcCCCcCCCCcCCCCCcCcCccCcCCCcCcccccCCcC";
const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const SOL = 1_000_000_000n;
const ALICE = { id: "44196397", username: "Alice", name: "alice" };

/** ETH at 2,000 usd: 0.01 usd is exactly 5,000,000,000,000 wei. */
const PRICES: PriceService = {
  usdPrice: (symbol) => Promise.resolve(symbol === "ETH" ? 2_000 : symbol === "SOL" ? 150 : null),
};
const NO_PRICE: PriceService = { usdPrice: () => Promise.resolve(null) };

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

interface World {
  readonly h: Harness;
  readonly headers: Record<string, string>;
  check(body: unknown, headers?: Record<string, string>): Promise<Response>;
  create(body: unknown): Promise<Response>;
}

type HarnessOptions = NonNullable<Parameters<typeof createHarness>[0]>;

async function world(
  writeSides: NonNullable<HarnessOptions["writeSides"]>,
  options: { prices?: PriceService; env?: Record<string, string> } = {},
  extra: Partial<HarnessOptions> = {},
): Promise<World> {
  harness = await createHarness({
    writeSides,
    prices: options.prices ?? PRICES,
    // The edges at 0.01 usd, as in `fee-guards.test.ts`; the 1 usd default is in config.test.ts.
    env: {
      X_BEARER_TOKEN: "test-bearer",
      ...TEST_BINDER_ENV,
      MIN_RECEIVER_USD_TESTNET: "0.01",
      ...options.env,
    },
    xLookup: [ALICE],
    ...extra,
  });
  const h = harness;
  const { jar } = await login(h);
  const headers: Record<string, string> = {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
  const send =
    (path: string) =>
    async (body: unknown, with_: Record<string, string> = headers) =>
      h.app.request(path, { method: "POST", headers: with_, body: JSON.stringify(body) });
  return { h, headers, check: send("/api/drops/check"), create: send("/api/drops") };
}

function evm(options: FakeChainOptions = {}) {
  const chain = createFakeChain(options);
  return { chain, adapter: evmAdapterFor(chain) };
}

const ethCheck = (amounts: readonly string[], mode: "address" | "handle" = "address") => ({
  mode,
  chain: "robinhood-testnet",
  asset: "native",
  amounts,
});

const ethCreate = (amounts: readonly string[]) => ({
  mode: "address",
  chain: "robinhood-testnet",
  receivers: amounts.map((amount, i) => ({ address: [A, B, C][i], amount })),
  refundRecipient: REFUND,
});

/** Solana over the fake cluster, devnet or the mainnet entry, devnet USDC in place. */
async function solanaWorld(chainKey: "solana-devnet" | "solana", prices: PriceService = PRICES) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    relayerLamports: 50n * SOL,
  });
  svm.putAccount(DEVNET_USDC, TOKEN_PROGRAM, classicMintData({ decimals: 6, freeze: true }));
  const rpc = createFakeSvmRpc(svm);
  const caps = { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n };
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(false),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps,
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  const solana: ChainAdapter = createSvmAdapter({
    rpc,
    relayer,
    chain: getChain(chainKey) as ReturnType<typeof getChain> & { chainId: number },
    feeModel: caps,
  });
  const w = await world(
    adaptersFrom([solana, evmAdapterFor(createFakeChain())], solana.chainKey),
    { prices },
    { tokenChecker: createTokenChecker({ rpc }) },
  );
  return { ...w, svm };
}

const rowsOf = async (h: Harness) => (await h.deps.db.select().from(drops)).length;

describe("POST /api/drops/check, the sign in", () => {
  it("refuses without a session: 401, as create", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter));
    const res = await w.check(ethCheck(["5000000000000"]), { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it("refuses without the CSRF header: 403 csrf_failed, as create", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter));
    const { [CSRF_HEADER]: _csrf, ...noCsrf } = w.headers;
    const res = await w.check(ethCheck(["5000000000000"]), noCsrf);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "csrf_failed" });
  });

  it("refuses a body without amounts: 400 invalid_body", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter));
    const res = await w.check({ mode: "address", chain: "robinhood-testnet", amounts: [] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_body");
  });
});

describe("POST /api/drops/check, all good", () => {
  it("answers 200 ok and makes nothing: no create on chain, no row, no X call", async () => {
    const { chain, adapter } = evm();
    const w = await world(singleAdapter(adapter));
    const xCalls = w.h.x.calls.length;
    const res = await w.check(ethCheck(["5000000000000", "5000000000000"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(chain.creates).toHaveLength(0);
    expect(await rowsOf(w.h)).toBe(0);
    expect(w.h.x.calls.length).toBe(xCalls);
  });

  it("asset defaults to native and chain to the default chain, as create", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter));
    const res = await w.check({ mode: "address", amounts: ["5000000000000"] });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/drops/check, the native refusals, the same as create", () => {
  it("below_min_usd: one wei under the minimum, the same body as create", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter));
    const amounts = ["5000000000000", "4999999999999"];
    const checked = await w.check(ethCheck(amounts));
    const created = await w.create(ethCreate(amounts));
    expect(checked.status).toBe(400);
    expect(created.status).toBe(400);
    const body = await checked.json();
    expect(body).toMatchObject({ error: "below_min_usd", minimum: "5000000000000", symbol: "ETH" });
    expect(body).toEqual(await created.json());
  });

  it("price_unavailable: no price, 503, as create", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter), { prices: NO_PRICE });
    const res = await w.check(ethCheck(["100000000000000"]));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("price_unavailable");
  });

  it("fee_below_gas: the fee under the estimate, the same body as create", async () => {
    // 3 x 0.0001 ETH at 100 bps is a 0.000003 ETH fee; the estimate is 686,000 gas at 1 gwei.
    const { adapter } = evm({ gasPrice: 1_000_000_000n, defaultFeeBps: 100 });
    const w = await world(singleAdapter(adapter));
    const amounts = ["100000000000000", "100000000000000", "100000000000000"];
    const checked = await w.check(ethCheck(amounts));
    const created = await w.create(ethCreate(amounts));
    expect(checked.status).toBe(400);
    const body = await checked.json();
    expect(body).toMatchObject({
      error: "fee_below_gas",
      fee: "3000000000000",
      estimate: "686000000000000",
      gasPrice: "1000000000",
    });
    expect(body).toEqual(await created.json());
  });

  it("the handle estimate in handle mode: one claimHandle a person", async () => {
    // 1 handle leaf at 1 gwei: 360k + 90k + 130k = 580,000 gas against a 0.000001 ETH fee.
    const { adapter } = evm({ gasPrice: 1_000_000_000n, defaultFeeBps: 100 });
    const w = await world(
      singleAdapter({ ...adapter, handleModeReady: () => Promise.resolve(true) }),
    );
    const res = await w.check(ethCheck(["100000000000000"], "handle"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "fee_below_gas",
      estimate: "580000000000000",
    });
  });
});

describe("POST /api/drops/check, the people and the cap", () => {
  it("too_many: more people than HANDLE_MAX_RECEIVERS in handle mode", async () => {
    const { adapter } = evm();
    const w = await world(
      singleAdapter({ ...adapter, handleModeReady: () => Promise.resolve(true) }),
      { env: { HANDLE_MAX_RECEIVERS: "2" } },
    );
    const res = await w.check(
      ethCheck(["5000000000000", "5000000000000", "5000000000000"], "handle"),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("too_many");
  });

  it("too_many comes first: too many people and too small, the answer is too_many", async () => {
    const { adapter } = evm();
    const w = await world(
      singleAdapter({ ...adapter, handleModeReady: () => Promise.resolve(true) }),
      { env: { HANDLE_MAX_RECEIVERS: "2" } },
    );
    const res = await w.check(ethCheck(["1", "1", "1"], "handle"));
    expect(((await res.json()) as { error: string }).error).toBe("too_many");
  });

  it("too_many on a token drop: more than the last fee tier, 500", async () => {
    const w = await solanaWorld("solana-devnet");
    const res = await w.check({
      mode: "handle",
      chain: "solana-devnet",
      asset: DEVNET_USDC,
      amounts: Array.from({ length: 501 }, () => "1000000"),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("too_many");
  });

  it("drop_too_big: over 2 SOL on the solana mainnet entry, with max, symbol, decimals", async () => {
    const w = await solanaWorld("solana");
    const res = await w.check({
      mode: "address",
      chain: "solana",
      asset: "native",
      amounts: [SOL.toString(), (SOL + 1n).toString()],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "drop_too_big",
      max: "2000000000",
      symbol: "SOL",
      decimals: 9,
    });
  });

  it("drop_too_big comes before the price: no price and too big, the answer is drop_too_big", async () => {
    const w = await solanaWorld("solana", NO_PRICE);
    const res = await w.check({
      mode: "address",
      chain: "solana",
      asset: "native",
      amounts: [(3n * SOL).toString()],
    });
    expect(((await res.json()) as { error: string }).error).toBe("drop_too_big");
  });

  it("a token drop within the tiers: 200 ok, nothing made", async () => {
    const w = await solanaWorld("solana-devnet");
    const res = await w.check({
      mode: "handle",
      chain: "solana-devnet",
      asset: DEVNET_USDC,
      amounts: ["1000000", "2000000"],
    });
    expect(res.status).toBe(200);
    expect(w.svm.executed.filter((name) => name === "create_drop")).toHaveLength(0);
    expect(await rowsOf(w.h)).toBe(0);
  });
});

describe("POST /api/drops/check, the rate limit", () => {
  it("30 a minute per session, the 31st is 429 rate_limited", async () => {
    const { adapter } = evm();
    const w = await world(singleAdapter(adapter));
    for (let i = 0; i < 30; i++) {
      expect((await w.check(ethCheck(["5000000000000"]))).status).toBe(200);
    }
    const res = await w.check(ethCheck(["5000000000000"]));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("never counts toward the create limit of 5 an hour", async () => {
    const { chain, adapter } = evm();
    const w = await world(singleAdapter(adapter));
    for (let i = 0; i < 6; i++) {
      expect((await w.check(ethCheck(["5000000000000"]))).status).toBe(200);
    }
    const res = await w.create(ethCreate(["5000000000000"]));
    expect(res.status).toBe(201);
    expect(chain.creates).toHaveLength(1);
  });
});
