/**
 * every api answer names the token.
 * - one `token` object, `{ mint, symbol, name, decimals, tokenProgram, logoUrl }`, on
 *   `GET /api/drops`, `GET /api/drops/:address`, `/share` and `GET /api/claims`; `null` on a
 *   SOL or ETH drop
 * - the plain `symbol` and `decimals` fields (share card, claim list) carry the token's; no
 *   ticker known: the word `tokens`, while `token.symbol` stays `null`
 * - `logoUrl` is always `/api/tokens/<mint>/logo?chain=solana`; the route says `404 no_logo`
 * - the drop page, while the drop is `created`, gets the same `funding` object as the create
 *   answer, a SOL drop too, so a reload never builds the funding card from the token total
 *
 * No socket: `test/fake-svm.ts` is the cluster.
 */
import { getChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER, SESSION_COOKIE, createSession } from "../src/auth/session.js";
import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmReader } from "../src/chain/svm/reader.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { createTokenChecker } from "../src/chain/svm/token-check.js";
import { drops } from "../src/db/schema.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";
import {
  classicMintData,
  DEVNET_USDC,
  fromB64,
  PUMP_MINT,
  PUMP_MINT_DATA,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./token-fixtures.js";

const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const SOL = 1_000_000_000n;
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(9_000_000_000 + i),
    username: `p${String(i)}`,
    name: `P ${String(i)}`,
  }));
const priceOf: PriceService = {
  usdPrice: (symbol) => Promise.resolve(symbol === "SOL" ? 150 : symbol === "ETH" ? 2_000 : null),
};

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function world() {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    relayerLamports: 50n * SOL,
  });
  svm.putAccount(DEVNET_USDC, TOKEN_PROGRAM, classicMintData({ decimals: 6, freeze: true }));
  svm.putAccount(PUMP_MINT, TOKEN_2022_PROGRAM, fromB64(PUMP_MINT_DATA));
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
    chain: getChain("solana-devnet") as ReturnType<typeof getChain> & { chainId: number },
    feeModel: caps,
  });
  const h = await createHarness({
    writeSides: adaptersFrom([solana, evmAdapterFor(createFakeChain())], solana.chainKey),
    prices: priceOf,
    tokenChecker: createTokenChecker({ rpc }),
    solanaReader: createSvmReader({ rpc, chainKey: "solana-devnet", chainId: 103, cacheMs: 0 }),
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV },
    xLookup: people(3),
  });
  harness = h;
  const { jar } = await login(h);
  const sender = cookieHeader(jar);
  const post = async (asset: string, n = 2, amount = "1500000") => {
    const res = await h.app.request("/api/drops", {
      method: "POST",
      headers: {
        cookie: sender,
        [CSRF_HEADER]: jar["dc_csrf"] ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "handle",
        chain: "solana-devnet",
        asset,
        handles: Array.from({ length: n }, (_, i) => ({ handle: `p${String(i)}`, amount })),
        refundRecipient: REFUND,
      }),
    });
    const text = await res.text();
    expect(res.status, text).toBe(201);
    return JSON.parse(text) as { drop: { address: string }; funding: Record<string, unknown> };
  };
  const get = async (path: string, cookie = sender) => {
    const res = await h.app.request(path, { headers: { cookie } });
    const text = await res.text();
    expect(res.status, `${path} ${text}`).toBe(200);
    return JSON.parse(text) as Record<string, unknown>;
  };
  const setState = (address: string, state: string) =>
    h.deps.db.update(drops).set({ state }).where(eq(drops.address, address));
  /** A signed in receiver: X id `p<i>`'s, as the X login would make it. */
  const receiver = async (i: number) => {
    const person = people(3)[i] as { id: string; username: string; name: string };
    const session = await createSession(h.deps.db, {
      secret: h.deps.config.SESSION_SECRET,
      user: { id: person.id, username: person.username, name: person.name, profileImageUrl: null },
      ttlSeconds: 3_600,
    });
    return `${SESSION_COOKIE}=${session.sessionId}`;
  };
  return { svm, post, get, setState, receiver };
}

const logoOf = (mint: string) => `/api/tokens/${mint}/logo?chain=solana`;
const PUMP_TOKEN = {
  mint: PUMP_MINT,
  symbol: "DOOROC",
  name: "Doomed Rocket",
  decimals: 6,
  tokenProgram: TOKEN_2022_PROGRAM,
  logoUrl: logoOf(PUMP_MINT),
  // these seeded rows carry no launchpad.
  launchpad: null,
};
// Devnet USDC has no ticker on chain, but it is a quick token: the ticker, the name and the logo
// are ours, never `tokens`.
const USDC_TOKEN = {
  mint: DEVNET_USDC,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  tokenProgram: TOKEN_PROGRAM,
  logoUrl: "/tokens/usdc.png",
  // these seeded rows carry no launchpad.
  launchpad: null,
};
/** The plain `symbol` fields for devnet USDC: ours (was `tokens`). */
const USDC_SHORT = "USDC";

type Detail = { ours: { data: Record<string, unknown> } };

describe("GET /api/drops/:address names the token", () => {
  it("a token drop: the token object, and while created the same funding as the create answer", async () => {
    const w = await world();
    const created = await w.post(PUMP_MINT);
    const detail = (await w.get(`/api/drops/${created.drop.address}`)) as unknown as Detail;
    expect(detail.ours.data["token"]).toEqual(PUMP_TOKEN);
    expect(detail.ours.data["asset"]).toBe(PUMP_MINT);
    // A reload never builds the funding card from the token total: both parts, from the api.
    expect(detail.ours.data["funding"]).toEqual(created.funding);
  });

  it("devnet USDC, no ticker on chain: our ticker, name and logo", async () => {
    const w = await world();
    const created = await w.post(DEVNET_USDC);
    const detail = (await w.get(`/api/drops/${created.drop.address}`)) as unknown as Detail;
    expect(detail.ours.data["token"]).toEqual(USDC_TOKEN);
  });

  it("a SOL drop: token null, and the same funding shape as its create answer", async () => {
    const w = await world();
    const created = await w.post("native", 2, "10000000");
    const detail = (await w.get(`/api/drops/${created.drop.address}`)) as unknown as Detail;
    expect(detail.ours.data["token"]).toBeNull();
    expect(detail.ours.data["asset"]).toBe("11111111111111111111111111111111");
    expect(detail.ours.data["funding"]).toEqual(created.funding);
  });

  it("no funding once the drop is past created", async () => {
    const w = await world();
    const created = await w.post(PUMP_MINT);
    await w.setState(created.drop.address, "active");
    const detail = (await w.get(`/api/drops/${created.drop.address}`)) as unknown as Detail;
    expect(detail.ours.data["funding"]).toBeNull();
    expect(detail.ours.data["token"]).toEqual(PUMP_TOKEN);
  });
});

describe("GET /api/drops, the rows", () => {
  it("each row carries its token, null on a SOL drop", async () => {
    const w = await world();
    const token = await w.post(PUMP_MINT);
    const sol = await w.post("native", 2, "10000000");
    const body = (await w.get("/api/drops?chain=all")) as {
      drops: { dropchad: { address: string; token: unknown } | null }[];
    };
    const tokenOf = (address: string) =>
      body.drops.find((d) => d.dropchad?.address === address)?.dropchad?.token;
    expect(tokenOf(token.drop.address)).toEqual(PUMP_TOKEN);
    expect(tokenOf(sol.drop.address)).toBeNull();
  });
});

describe("GET /api/drops/:address/share, the card", () => {
  it("the token's ticker and decimals, and the token object", async () => {
    const w = await world();
    const created = await w.post(PUMP_MINT);
    await w.setState(created.drop.address, "active");
    const card = await w.get(`/api/drops/${created.drop.address}/share`);
    expect(card).toMatchObject({ symbol: "DOOROC", decimals: 6, amount: "3000000" });
    expect(card["token"]).toEqual(PUMP_TOKEN);
  });

  it("devnet USDC on the share card: USDC, never tokens", async () => {
    const w = await world();
    const created = await w.post(DEVNET_USDC);
    await w.setState(created.drop.address, "active");
    const card = await w.get(`/api/drops/${created.drop.address}/share`);
    expect(card).toMatchObject({ symbol: USDC_SHORT, decimals: 6 });
    expect(card["token"]).toEqual(USDC_TOKEN);
  });

  it("a SOL drop: SOL, 9, token null", async () => {
    const w = await world();
    const created = await w.post("native", 2, "10000000");
    await w.setState(created.drop.address, "active");
    const card = await w.get(`/api/drops/${created.drop.address}/share`);
    expect(card).toMatchObject({ symbol: "SOL", decimals: 9 });
    expect(card["token"]).toBeNull();
  });
});

describe("GET /api/claims, the receiver's list", () => {
  it("a token leaf: the token's ticker, decimals and the token object; a SOL leaf unchanged", async () => {
    const w = await world();
    const token = await w.post(DEVNET_USDC);
    const sol = await w.post("native", 2, "10000000");
    const cookie = await w.receiver(0);
    const body = (await w.get("/api/claims", cookie)) as {
      claims: { drop: string; amount: string; symbol: string; decimals: number; token: unknown }[];
    };
    const of = (address: string) => body.claims.find((c) => c.drop === address);
    expect(of(token.drop.address)).toMatchObject({
      amount: "1500000",
      symbol: USDC_SHORT,
      decimals: 6,
      token: USDC_TOKEN,
    });
    expect(of(sol.drop.address)).toMatchObject({ symbol: "SOL", decimals: 9, token: null });
  });
});
