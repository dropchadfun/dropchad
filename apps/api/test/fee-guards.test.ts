/**
 * the fee guards.
 * - a minimum per receiver in usd, per chain kind in api config: 5 usd on mainnet, 0.01 usd on the
 *   testnets; both modes, every leaf after merging; `400 below_min_usd`
 * - no price, no drop: `503 price_unavailable`
 * - the fee, `max(minFee, total * bps / 10_000)`, must cover the relayer's estimated cost of
 *   `createDrop`, `activate` and every claim; handle leaves one claim per transaction;
 *   `400 fee_below_gas`
 * - on Solana the rent floor holds on handle leaves too
 * Nothing is sent to the chain when a guard refuses.
 */
import { getChain } from "@dropchad/chains";
import { MIN_SOL_LEAF_LAMPORTS } from "@dropchad/shared";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { loadConfig } from "../src/config.js";
import { minReceiverUsd } from "../src/drops/fee-guards.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor, type FakeChainOptions } from "./fake-chain.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const C = "0xCcCcCCCcCCCCcCCCCCcCcCccCcCCCcCcccccCCcC";
const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const SOL_REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const ALICE = { id: "44196397", username: "Alice", name: "alice" };

/** ETH at 2,000 usd: 0.01 usd is exactly 5,000,000,000,000 wei. */
const PRICES: PriceService = {
  usdPrice: (symbol) => Promise.resolve(symbol === "ETH" ? 2_000 : symbol === "SOL" ? 100 : null),
};
const NO_PRICE: PriceService = { usdPrice: () => Promise.resolve(null) };

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function signedIn(
  adapter: ChainAdapter,
  prices: PriceService = PRICES,
): Promise<Record<string, string>> {
  harness = await createHarness({
    writeSides: singleAdapter(adapter),
    prices,
    // Handle mode needs our binder key and the same binder on chain.
    // The edges are tested at 0.01 usd on purpose; the 1 usd default is in config.test.ts.
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV, MIN_RECEIVER_USD_TESTNET: "0.01" },
    xLookup: [ALICE],
  });
  const { jar } = await login(harness);
  return {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

const post = (headers: Record<string, string>, body: unknown) =>
  (harness as Harness).app.request("/api/drops", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

const addressDrop = (amounts: string[]) => ({
  mode: "address",
  receivers: amounts.map((amount, i) => ({ address: [A, B, C][i], amount })),
  refundRecipient: REFUND,
});

function evm(options: FakeChainOptions = {}) {
  const chain = createFakeChain(options);
  return { chain, adapter: evmAdapterFor(chain) };
}

describe("the minimum per receiver in usd", () => {
  it("is 1 usd on a mainnet and on a testnet by default", () => {
    const { MIN_RECEIVER_USD_TESTNET: _fixture, ...real } = TEST_ENV;
    const config = loadConfig(real);
    expect(minReceiverUsd(config, getChain("robinhood"))).toBe("1");
    expect(minReceiverUsd(config, getChain("robinhood-testnet"))).toBe("1");
    expect(minReceiverUsd(config, getChain("solana-devnet"))).toBe("1");
    const tuned = loadConfig({ ...TEST_ENV, MIN_RECEIVER_USD_TESTNET: "0.5" });
    expect(minReceiverUsd(tuned, getChain("robinhood-testnet"))).toBe("0.5");
  });

  it("refuses a receiver one wei under the minimum and names it, nothing sent", async () => {
    const { chain, adapter } = evm();
    const headers = await signedIn(adapter);
    const res = await post(headers, addressDrop(["5000000000000", "4999999999999"]));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "below_min_usd",
      minimum: "5000000000000",
      minUsd: "0.01",
      priceUsd: 2000,
      symbol: "ETH",
    });
    expect(chain.creates).toHaveLength(0);
  });

  it("takes a receiver at exactly the minimum", async () => {
    const { chain, adapter } = evm();
    const headers = await signedIn(adapter);
    const res = await post(headers, addressDrop(["5000000000000"]));
    expect(res.status).toBe(201);
    expect(chain.creates).toHaveLength(1);
  });

  it("checks amounts after merging: two small lines for one address count as one leaf", async () => {
    const { adapter } = evm();
    const headers = await signedIn(adapter);
    const res = await post(headers, {
      mode: "address",
      receivers: [
        { address: A, amount: "2500000000000" },
        { address: A, amount: "2500000000000" },
      ],
      refundRecipient: REFUND,
    });
    expect(res.status).toBe(201);
  });

  it("applies to handle drops too", async () => {
    const { chain, adapter } = evm();
    const headers = await signedIn({ ...adapter, handleModeReady: () => Promise.resolve(true) });
    const res = await post(headers, {
      mode: "handle",
      handles: [{ handle: "alice", amount: "4999999999999" }],
      refundRecipient: REFUND,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("below_min_usd");
    expect(chain.creates).toHaveLength(0);
  });

  it("refuses with 503 price_unavailable when there is no price, nothing sent", async () => {
    const { chain, adapter } = evm();
    const headers = await signedIn(adapter, NO_PRICE);
    const res = await post(headers, addressDrop(["100000000000000"]));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("price_unavailable");
    expect(chain.creates).toHaveLength(0);
  });
});

describe("the fee must cover the relayer's cost", () => {
  it("EVM estimate: createDrop, activate, batches of 20 address claims, one tx per handle claim", async () => {
    const { adapter } = evm({ gasPrice: 1n });
    // 45 address leaves: 3 batches. 360,000 + 90,000 + 3 x 86,000 + 45 x 50,000.
    expect(
      await adapter.estimateRelayerCost({ addressLeaves: 45, handleLeaves: 0, leafCount: 45 }),
    ).toEqual({ cost: 2_958_000n, unitPrice: 1n });
    // 2 handle leaves: 360,000 + 90,000 + 2 x 130,000.
    expect(
      await adapter.estimateRelayerCost({ addressLeaves: 0, handleLeaves: 2, leafCount: 2 }),
    ).toEqual({ cost: 710_000n, unitPrice: 1n });
  });

  it("refuses a drop whose fee is under the estimate and says the fee, the estimate and the price", async () => {
    // 3 x 0.0001 ETH at 100 bps is a 0.000003 ETH fee. Gas: 360k + 90k + 86k + 3 x 50k = 686,000
    // at 1 gwei is 0.000686 ETH.
    const { chain, adapter } = evm({ gasPrice: 1_000_000_000n, defaultFeeBps: 100 });
    const headers = await signedIn(adapter);
    const res = await post(
      headers,
      addressDrop(["100000000000000", "100000000000000", "100000000000000"]),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "fee_below_gas",
      fee: "3000000000000",
      estimate: "686000000000000",
      gasPrice: "1000000000",
    });
    expect(chain.creates).toHaveLength(0);
  });

  it("takes the same drop once the minimum fee covers it: max(minFee, bps)", async () => {
    const { chain, adapter } = evm({
      gasPrice: 1_000_000_000n,
      defaultFeeBps: 100,
      minFeeAmount: 1_000_000_000_000_000n,
    });
    const headers = await signedIn(adapter);
    const res = await post(
      headers,
      addressDrop(["100000000000000", "100000000000000", "100000000000000"]),
    );
    expect(res.status).toBe(201);
    expect(chain.creates).toHaveLength(1);
  });

  it("Solana estimate: the fit table for address claims, one tx per handle claim, base plus priority fee", async () => {
    const svm = new FakeSvm({ relayer: randomSigner().publicKey });
    const adapter = svmAdapter(svm, { priorityFeeMicroLamports: 1_000n, maxComputeUnits: 400_000 });
    // 5,000 base + 400,000 x 1,000 / 1,000,000 = 400 priority, per transaction.
    const perTx = 5_400n;
    expect(
      await adapter.estimateRelayerCost({ addressLeaves: 0, handleLeaves: 3, leafCount: 3 }),
    ).toEqual({ cost: 5n * perTx, unitPrice: perTx });
    const perBatch = adapter.claimsPerTx(10);
    const batches = BigInt(Math.ceil(10 / perBatch));
    expect(
      await adapter.estimateRelayerCost({ addressLeaves: 10, handleLeaves: 0, leafCount: 10 }),
    ).toEqual({ cost: (2n + batches) * perTx, unitPrice: perTx });
  });
});

describe("the Solana rent floor on handle leaves", () => {
  it("refuses a handle leaf under 890,880 lamports even when it clears the usd minimum", async () => {
    const svm = new FakeSvm({
      relayer: randomSigner().publicKey,
      defaultFeeBps: 100,
      binder: TEST_SOL_BINDER_PUBKEY,
    });
    const adapter = svmAdapter(svm);
    const headers = await signedIn({ ...adapter, handleModeReady: () => Promise.resolve(true) });
    // 0.01 usd at 100 usd a SOL is 100,000 lamports; 500,000 clears it but not the floor.
    const res = await post(headers, {
      mode: "handle",
      handles: [{ handle: "alice", amount: "500000" }],
      refundRecipient: SOL_REFUND,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_receivers");
    expect(body.message).toContain(MIN_SOL_LEAF_LAMPORTS.toString());
  });
});

function svmAdapter(
  svm: FakeSvm,
  caps: { priorityFeeMicroLamports: bigint; maxComputeUnits: number } = {
    priorityFeeMicroLamports: 0n,
    maxComputeUnits: 400_000,
  },
): ChainAdapter {
  const rpc = createFakeSvmRpc(svm);
  const signer = randomSigner();
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(false),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps,
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  return createSvmAdapter({
    rpc,
    relayer,
    chain: getChain("solana-devnet") as ReturnType<typeof getChain> & { chainId: number },
    feeModel: caps,
  });
}
