/**
 * The cap per drop: api env per
 * chain, 2 SOL, 0.1 ETH, 200 whole tokens of each quick token, no value cap on any other token,
 * **on mainnet chains only**, picked by the chain's `kind` like `MIN_RECEIVER_USD_MAINNET`. A
 * testnet has no cap and works as before. `totalEntitlements` is counted, never the fee. At the
 * cap is allowed; one base unit over is `400 drop_too_big` with `max`, `symbol` and `decimals`.
 *
 * The fake cluster's `Config` says chain id 103, so a whole create on the `solana` mainnet entry
 * would stop at the read back for that reason alone. The mainnet refusal comes before anything is
 * sent, so it runs through the route; "at the cap is allowed" on mainnet is checked on
 * `dropCapFor`, and so is Robinhood mainnet, which has no factory in the registry yet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getChain } from "@dropchad/chains";
import { getAddress, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { adaptersFrom, singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import { createEvmTokenChecker, type Erc20Reads } from "../src/chain/evm/token-check.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { createTokenChecker } from "../src/chain/svm/token-check.js";
import { loadConfig, redactedConfig } from "../src/config.js";
import { drops } from "../src/db/schema.js";
import { checkDropCap, dropCapFor, DropTooBigError } from "../src/drops/drop-cap.js";
import { createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";
import { DEVNET_USDC, TOKEN_PROGRAM, classicMintData } from "./token-fixtures.js";

const SOL = 1_000_000_000n;
const ETH = 10n ** 18n;
const USDC = 1_000_000n;
const SOL_A = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const SOL_B = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";
const SOL_REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const EVM_A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const EVM_B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const EVM_REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
/** USDC on Solana mainnet, a quick token of the `solana` entry. */
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** USD1 on Solana mainnet, a quick token since, capped like USDC. */
const MAINNET_USD1 = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";
/** The Robinhood testnet quick token, `packages/chains`. */
const TUSDC = getAddress("0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C");
/** Any other ERC20, listed on the factory. */
const OTHER = getAddress("0x7e57000000000000000000000000000000007e57");

const CAPS = loadConfig({ ...TEST_ENV });

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(9_000_000_000 + i),
    username: `p${String(i)}`,
    name: `P ${String(i)}`,
  }));

const handles = (amounts: readonly bigint[]) =>
  amounts.map((amount, i) => ({
    handle: `p${String(i)}`,
    amount: amount.toString(),
    xUserId: String(9_000_000_000 + i),
  }));

async function signedIn(h: Harness) {
  const { jar } = await login(h);
  const headers = {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
  return (body: unknown) =>
    h.app.request("/api/drops", { method: "POST", headers, body: JSON.stringify(body) });
}

/** Solana over the fake cluster, devnet or the mainnet entry, with both USDC mints in place. */
async function solanaWorld(chainKey: "solana-devnet" | "solana", env: Record<string, string> = {}) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    relayerLamports: 50n * SOL,
  });
  for (const mint of [DEVNET_USDC, MAINNET_USDC, MAINNET_USD1]) {
    svm.putAccount(mint, TOKEN_PROGRAM, classicMintData({ decimals: 6, freeze: true }));
  }
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
  const evm = evmAdapterFor(createFakeChain());
  harness = await createHarness({
    writeSides: adaptersFrom([solana, evm], solana.chainKey),
    prices: { usdPrice: (s) => Promise.resolve(s === "SOL" ? 150 : s === "ETH" ? 2_000 : null) },
    tokenChecker: createTokenChecker({ rpc }),
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV, ...env },
    xLookup: people(4),
  });
  const creates = () => svm.executed.filter((name) => name === "create_drop").length;
  return { post: await signedIn(harness), creates, h: harness };
}

/** The ERC20 reads: tUSDC with 6 decimals and OTHER with 18, both listed and plain. */
function reads(): Erc20Reads {
  const isTusdc = (token: string) => getAddress(token) === TUSDC;
  return {
    code: () => Promise.resolve(`0x6080604052${"00".repeat(64)}` as Hex),
    slot: () => Promise.resolve(0n),
    decimals: (token) => Promise.resolve(isTusdc(token) ? 6 : 18),
    name: (token) => Promise.resolve(isTusdc(token) ? "Test USDC" : "Other Coin"),
    symbol: (token) => Promise.resolve(isTusdc(token) ? "tUSDC" : "OTHER"),
    allowedToken: (token) => Promise.resolve([TUSDC, OTHER].includes(getAddress(token))),
    fromLaunchpad: () => Promise.resolve(false),
  };
}

/** Robinhood testnet over the fake factory, V3, token drops on. */
async function evmWorld(env: Record<string, string> = {}) {
  const chain: FakeChain = createFakeChain({ version: 3, defaultFeeBps: 100, gasPrice: 0n });
  harness = await createHarness({
    writeSides: singleAdapter(evmAdapterFor(chain)),
    prices: { usdPrice: (s) => Promise.resolve(s === "ETH" ? 2_000 : null) },
    evmTokenChecker: createEvmTokenChecker({ reads: reads() }),
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV, ...env },
    xLookup: people(4),
  });
  return { post: await signedIn(harness), chain, h: harness };
}

const solMultisend = (chain: string, amounts: readonly bigint[]) => ({
  mode: "address",
  chain,
  receivers: amounts.map((amount, i) => ({
    address: [SOL_A, SOL_B][i],
    amount: amount.toString(),
  })),
  refundRecipient: SOL_REFUND,
});

const ethMultisend = (amounts: readonly bigint[]) => ({
  mode: "address",
  chain: "robinhood-testnet",
  receivers: amounts.map((amount, i) => ({
    address: [EVM_A, EVM_B][i],
    amount: amount.toString(),
  })),
  refundRecipient: EVM_REFUND,
});

const tokenDrop = (chain: string, asset: string, amounts: readonly bigint[], refund: string) => ({
  mode: "handle",
  chain,
  asset,
  handles: handles(amounts),
  refundRecipient: refund,
});

/** The registry facts `dropCapFor` reads, for a chain key. */
const chainOf = (key: string) => {
  const entry = getChain(key);
  return {
    // Only the four evm and svm entries are used here; the registry type also has `tvm`.
    family: entry.family as "evm" | "svm",
    chainKey: entry.key,
    nativeSymbol: entry.nativeSymbol,
    decimals: entry.family === "svm" ? 9 : 18,
  };
};

describe("the caps, config", () => {
  it("default to 2 SOL, 0.1 ETH and 200 whole tokens", () => {
    expect(CAPS.SOLANA_MAX_DROP_LAMPORTS).toBe("2000000000");
    expect(CAPS.EVM_MAX_DROP_WEI).toBe("100000000000000000");
    expect(CAPS.SOLANA_MAX_DROP_STABLE).toBe("200");
    expect(CAPS.EVM_MAX_DROP_STABLE).toBe("200");
  });

  it("take another whole number above zero", () => {
    const config = loadConfig({
      ...TEST_ENV,
      SOLANA_MAX_DROP_LAMPORTS: "3000000000",
      EVM_MAX_DROP_STABLE: "250",
    });
    expect(config.SOLANA_MAX_DROP_LAMPORTS).toBe("3000000000");
    expect(config.EVM_MAX_DROP_STABLE).toBe("250");
  });

  it("anything else stops the start, naming the variable", () => {
    for (const name of [
      "SOLANA_MAX_DROP_LAMPORTS",
      "EVM_MAX_DROP_WEI",
      "SOLANA_MAX_DROP_STABLE",
      "EVM_MAX_DROP_STABLE",
    ]) {
      for (const bad of ["0", "-1", "1.5", "abc", "", "007"]) {
        expect(() => loadConfig({ ...TEST_ENV, [name]: bad })).toThrow(new RegExp(name));
      }
    }
  });

  it("the printed config shows all four", () => {
    const printed = redactedConfig(CAPS);
    expect(printed["SOLANA_MAX_DROP_LAMPORTS"]).toBe("2000000000");
    expect(printed["EVM_MAX_DROP_WEI"]).toBe("100000000000000000");
    expect(printed["SOLANA_MAX_DROP_STABLE"]).toBe("200");
    expect(printed["EVM_MAX_DROP_STABLE"]).toBe("200");
  });
});

describe("a mainnet chain has the caps", () => {
  it("Solana mainnet: one lamport over 2 SOL is refused, and nothing is written or sent", async () => {
    const w = await solanaWorld("solana");
    const res = await w.post(solMultisend("solana", [SOL, SOL + 1n]));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "drop_too_big",
      max: "2000000000",
      symbol: "SOL",
      decimals: 9,
    });
    expect(w.creates()).toBe(0);
    expect(await w.h.deps.db.select().from(drops)).toHaveLength(0);
  });

  it("Solana mainnet: one base unit over 200 USDC is refused", async () => {
    const w = await solanaWorld("solana");
    const res = await w.post(
      tokenDrop("solana", MAINNET_USDC, [100n * USDC, 100n * USDC + 1n], SOL_REFUND),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "drop_too_big",
      max: "200000000",
      symbol: "USDC",
      decimals: 6,
    });
    expect(w.creates()).toBe(0);
  });

  it("Solana mainnet: the env changes the cap", async () => {
    const w = await solanaWorld("solana", { SOLANA_MAX_DROP_LAMPORTS: "100000000" });
    const res = await w.post(solMultisend("solana", [SOL / 20n, SOL / 20n + 1n]));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "drop_too_big", max: "100000000" });
  });

  it("Solana mainnet: the caps, and exactly at the cap is allowed", () => {
    const sol = dropCapFor(CAPS, chainOf("solana"), null);
    expect(sol).toEqual({ max: 2n * SOL, symbol: "SOL", decimals: 9 });
    expect(() => checkDropCap(sol, 2n * SOL)).not.toThrow();
    expect(() => checkDropCap(sol, 2n * SOL + 1n)).toThrow(DropTooBigError);
    const usdt = dropCapFor(CAPS, chainOf("solana"), {
      mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      decimals: 6,
    });
    expect(usdt).toEqual({ max: 200n * USDC, symbol: "USDT", decimals: 6 });
  });

  it("Robinhood mainnet: 0.1 ETH, exactly at the cap is allowed", () => {
    const eth = dropCapFor(CAPS, chainOf("robinhood"), null);
    expect(eth).toEqual({ max: ETH / 10n, symbol: "ETH", decimals: 18 });
    expect(() => checkDropCap(eth, ETH / 10n)).not.toThrow();
    expect(() => checkDropCap(eth, ETH / 10n + 1n)).toThrow(DropTooBigError);
  });

  it("Robinhood mainnet: 200 USDG, a quick token", () => {
    const usdg = dropCapFor(CAPS, chainOf("robinhood"), {
      mint: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      decimals: 6,
    });
    expect(usdg).toEqual({ max: 200n * USDC, symbol: "USDG", decimals: 6 });
    expect(() => checkDropCap(usdg, 200n * USDC)).not.toThrow();
    expect(() => checkDropCap(usdg, 200n * USDC + 1n)).toThrow(DropTooBigError);
  });

  it("Robinhood testnet: USDG has no cap, as every testnet", () => {
    expect(
      dropCapFor(CAPS, chainOf("robinhood-testnet"), {
        mint: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
        decimals: 6,
      }),
    ).toBe(null);
  });

  it("only quick tokens carry the stable cap: no other list", () => {
    const src = readFileSync(join(__dirname, "..", "src", "drops", "drop-cap.ts"), "utf8");
    expect(src).not.toContain("CAPPED_PASTED_TOKENS");
    expect(src).not.toContain("USD1ttGY");
  });

  it("Solana mainnet: 200 USD1 as a quick token", () => {
    const usd1 = dropCapFor(CAPS, chainOf("solana"), { mint: MAINNET_USD1, decimals: 6 });
    expect(usd1).toEqual({ max: 200n * USDC, symbol: "USD1", decimals: 6 });
    expect(() => checkDropCap(usd1, 200n * USDC)).not.toThrow();
    expect(() => checkDropCap(usd1, 200n * USDC + 1n)).toThrow(DropTooBigError);
    expect(dropCapFor(CAPS, chainOf("solana-devnet"), { mint: MAINNET_USD1, decimals: 6 })).toBe(
      null,
    );
  });

  it("Solana mainnet: one base unit over 200 USD1 is refused", async () => {
    const w = await solanaWorld("solana");
    const res = await w.post(
      tokenDrop("solana", MAINNET_USD1, [100n * USDC, 100n * USDC + 1n], SOL_REFUND),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "drop_too_big",
      max: "200000000",
      symbol: "USD1",
      decimals: 6,
    });
    expect(w.creates()).toBe(0);
  });

  it("a token that is not a quick token has no value cap, on mainnet too", () => {
    expect(dropCapFor(CAPS, chainOf("robinhood"), { mint: OTHER, decimals: 18 })).toBe(null);
    expect(
      dropCapFor(CAPS, chainOf("solana"), {
        mint: "So11111111111111111111111111111111111111112",
        decimals: 9,
      }),
    ).toBe(null);
  });
});

describe("a testnet has no cap at all", () => {
  it("the testnet entries get no cap from dropCapFor", () => {
    expect(dropCapFor(CAPS, chainOf("solana-devnet"), null)).toBe(null);
    expect(dropCapFor(CAPS, chainOf("robinhood-testnet"), null)).toBe(null);
    expect(dropCapFor(CAPS, chainOf("solana-devnet"), { mint: DEVNET_USDC, decimals: 6 })).toBe(
      null,
    );
    expect(dropCapFor(CAPS, chainOf("robinhood-testnet"), { mint: TUSDC, decimals: 6 })).toBe(null);
  });

  it("Solana devnet: a SOL drop over 2 SOL is made", async () => {
    const w = await solanaWorld("solana-devnet");
    const res = await w.post(solMultisend("solana-devnet", [2n * SOL, SOL / 2n]));
    expect(res.status).toBe(201);
    expect(w.creates()).toBe(1);
  });

  it("Solana devnet: a USDC drop over 200 is made", async () => {
    const w = await solanaWorld("solana-devnet");
    const res = await w.post(
      tokenDrop("solana-devnet", DEVNET_USDC, [200n * USDC, 50n * USDC], SOL_REFUND),
    );
    expect(res.status).toBe(201);
  });

  it("Robinhood testnet: an ETH drop over 0.1 ETH is made", async () => {
    const w = await evmWorld();
    expect((await w.post(ethMultisend([ETH / 10n, ETH / 40n]))).status).toBe(201);
    expect(w.chain.creates).toHaveLength(1);
  });

  it("Robinhood testnet: a tUSDC drop over 200 is made", async () => {
    const w = await evmWorld();
    const res = await w.post(
      tokenDrop("robinhood-testnet", TUSDC, [200n * USDC, 50n * USDC], EVM_REFUND),
    );
    expect(res.status).toBe(201);
  });

  it("Robinhood testnet: any other token, any amount, as before", async () => {
    const w = await evmWorld();
    const res = await w.post(
      tokenDrop("robinhood-testnet", OTHER, [1_000_000n * ETH, 1_000_000n * ETH], EVM_REFUND),
    );
    expect(res.status).toBe(201);
  });
});
