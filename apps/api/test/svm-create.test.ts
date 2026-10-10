/**
 * `POST /api/drops` with `chain: "solana-devnet"`: the same route, the same body shape, a
 * different adapter. And the boot side: `buildSolanaWriteSide` from a config with a secret.
 */
import { getChain } from "@dropchad/chains";
import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it } from "vitest";

import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import { loadConfig } from "../src/config.js";
import { dropJobs, drops } from "../src/db/schema.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { buildSolanaWriteSide, createDropRent } from "../src/chain/svm/write-side.js";
import { openAndMigrate } from "../src/db/client.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const A = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const B = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";
const C = "EnTJCS15dqbDTU2XywYSMaScoPv4Py4GzExrtY9DQxoD";
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const LEAF = "10000000"; // 0.01 SOL

function solanaAdapter(
  svm: FakeSvm,
  signer = randomSigner(),
  known = new Set<string>(),
): ChainAdapter {
  const rpc = createFakeSvmRpc(svm);
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: (address) => Promise.resolve(known.has(address)),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  return createSvmAdapter({ rpc, relayer, chain: CHAIN });
}

async function signedIn(
  options: { solana?: ChainAdapter; solanaStatus?: "config_missing" } = {},
): Promise<{ harness: Harness; headers: Record<string, string> }> {
  const signer = randomSigner();
  // Devnet runs at 100 bps; at zero no fee covers the relayer.
  const svm = new FakeSvm({ relayer: signer.publicKey, defaultFeeBps: 100 });
  const svmAdapter = options.solana ?? solanaAdapter(svm, signer);
  const evm = evmAdapterFor(createFakeChain());
  const missing = options.solanaStatus === "config_missing";
  const harness = await createHarness({
    writeSides: missing
      ? adaptersFrom([evm], evm.chainKey)
      : adaptersFrom([evm, svmAdapter], evm.chainKey),
    ...(missing
      ? {
          solana: {
            kind: "config_missing" as const,
            chainKey: "solana-devnet",
            detail: "run the init script",
          },
        }
      : {}),
  });
  const { jar } = await login(harness);
  return { harness, headers: headersFor(jar) };
}

function headersFor(jar: Record<string, string>): Record<string, string> {
  return {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    mode: "address",
    chain: "solana-devnet",
    receivers: [
      { address: A, amount: LEAF },
      { address: B, amount: LEAF },
      { address: C, amount: LEAF },
    ],
    refundRecipient: REFUND,
    ...overrides,
  });
}

describe("POST /api/drops on solana-devnet", () => {
  it("creates the drop, hands back a Solana Pay uri, and writes one row and one job", async () => {
    const { harness, headers } = await signedIn();
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ title: "gm" }),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      drop: Record<string, unknown>;
      funding: Record<string, unknown>;
      warnings: string[];
    };
    const address = payload.drop["address"] as string;
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(payload.drop["chainKey"]).toBe("solana-devnet");
    expect(payload.drop["chainId"]).toBe(103);
    expect(payload.drop["family"]).toBe("svm");
    expect(payload.drop["leafCount"]).toBe(3);
    expect(payload.drop["grossRequiredWei"]).toBe("30300000");
    expect(payload.drop["asset"]).toBe("11111111111111111111111111111111");

    expect(payload.funding["paymentUri"]).toBe(`solana:${address}?amount=0.0303`);
    expect(payload.funding["amountDisplay"]).toBe("0.0303");
    expect(payload.funding["symbol"]).toBe("SOL");
    expect(payload.funding["family"]).toBe("svm");
    expect(payload.warnings.join(" ")).toContain("0.0303 SOL on Solana Devnet");
    expect(payload.warnings.join(" ")).toContain(REFUND);

    const rows = await harness.deps.db.select().from(drops);
    expect(rows).toHaveLength(1);
    // Base58 is case sensitive: stored exactly as written, never lowercased.
    expect(rows[0]?.address).toBe(address);
    expect(rows[0]?.chainKey).toBe("solana-devnet");
    expect(rows[0]?.salt).toBeNull();
    expect(rows[0]?.state).toBe("created");
    const jobs = await harness.deps.db.select().from(dropJobs);
    expect(jobs.map((j) => [j.kind, j.dropAddress])).toEqual([["watch_funding", address]]);

    // The read routes answer for a base58 address.
    const detail = await harness.app.request(`/api/drops/${address}`);
    expect(detail.status).toBe(200);
    const json = (await detail.json()) as { ours: { data: { chainKey: string } } };
    expect(json.ours.data.chainKey).toBe("solana-devnet");
    const manifest = await harness.app.request(`/api/drops/${address}/manifest`);
    expect(manifest.status).toBe(200);
    expect((await manifest.json()) as { chainId: number }).toMatchObject({
      chainId: 103,
      drop: address,
    });
    // This drop is a multisend, and a multisend has no share card.
    const share = await harness.app.request(`/api/drops/${address}/share`);
    expect(share.status).toBe(404);
    expect(await share.json()).toEqual({ error: "no_share_card" });

    await harness.close();
  });

  it("refuses 0x addresses on a solana chain, and base58 on the evm chain, as a 400 naming the field", async () => {
    const { harness, headers } = await signedIn();
    const wrong = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ refundRecipient: "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD" }),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({
      error: "invalid_body",
      issues: [{ path: "refundRecipient", message: expect.stringContaining("base58") as string }],
    });

    const onEvm = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ chain: "robinhood-testnet" }),
    });
    expect(onEvm.status).toBe(400);
    const issues = ((await onEvm.json()) as { issues: { path: string }[] }).issues.map(
      (i) => i.path,
    );
    expect(issues).toEqual([
      "receivers.0.address",
      "receivers.1.address",
      "receivers.2.address",
      "refundRecipient",
    ]);
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
    await harness.close();
  });

  it("refuses a leaf under the rent floor as invalid_receivers", async () => {
    const { harness, headers } = await signedIn();
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ receivers: [{ address: A, amount: "890879" }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_receivers" });
    await harness.close();
  });

  it("says so when the config is not initialised", async () => {
    const { harness, headers } = await signedIn({ solanaStatus: "config_missing" });
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "solana_config_missing",
      message: expect.stringContaining("init script") as string,
    });
    // The EVM chain still works in the same process.
    const evm = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "address",
        receivers: [
          { address: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa", amount: "100000000000000" },
        ],
        refundRecipient: "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD",
      }),
    });
    expect(evm.status).toBe(201);
    await harness.close();
  });

  it("answers chain_not_configured for a key with no relayer", async () => {
    const { harness, headers } = await signedIn();
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ chain: "bnb" }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "chain_not_configured" });
    await harness.close();
  });
});

describe("the Solana adapter reads the fee off the config", () => {
  it("returns config.default_fee_bps, and follows a change", async () => {
    const signer = randomSigner();
    const zero = new FakeSvm({ relayer: signer.publicKey });
    expect(await solanaAdapter(zero, signer).defaultFeeBps()).toBe(0);

    const onePercent = new FakeSvm({ relayer: signer.publicKey, defaultFeeBps: 100 });
    expect(await solanaAdapter(onePercent, signer).defaultFeeBps()).toBe(100);
  });

  it("throws when the config is missing instead of guessing zero", async () => {
    const signer = randomSigner();
    const none = new FakeSvm({ relayer: signer.publicKey, withConfig: false });
    await expect(solanaAdapter(none, signer).defaultFeeBps()).rejects.toThrow();
  });
});

describe("buildSolanaWriteSide", () => {
  const seed = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(seed);
  const secret = JSON.stringify([...seed, ...pub]);

  it("is off without a secret", async () => {
    const handle = await openAndMigrate("memory://");
    const result = await buildSolanaWriteSide(loadConfig({ ...TEST_ENV }), handle.db);
    expect(result.kind).toBe("off");
    await handle.close();
  });

  it("refuses to start without an RPC url, naming the variable", async () => {
    const handle = await openAndMigrate("memory://");
    await expect(
      buildSolanaWriteSide(loadConfig({ ...TEST_ENV, SOLANA_RELAYER_SECRET: secret }), handle.db),
    ).rejects.toThrow(/SOLANA_DEVNET_RPC_URL/);
    await handle.close();
  });

  it("refuses to start when SOLANA_RELAYER_ADDRESS does not match the secret", async () => {
    const handle = await openAndMigrate("memory://");
    const config = loadConfig({
      ...TEST_ENV,
      SOLANA_RELAYER_SECRET: secret,
      SOLANA_DEVNET_RPC_URL: "http://fake.invalid",
      SOLANA_RELAYER_ADDRESS: "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP",
    });
    await expect(buildSolanaWriteSide(config, handle.db)).rejects.toThrow(/Refusing to start/);
    await handle.close();
  });

  it("reports config_missing on a fresh cluster and comes up once the config exists", async () => {
    const handle = await openAndMigrate("memory://");
    const config = loadConfig({
      ...TEST_ENV,
      SOLANA_RELAYER_SECRET: secret,
      SOLANA_DEVNET_RPC_URL: "http://fake.invalid",
      SOLANA_RELAYER_ADDRESS: pubkeyToBase58(pub),
    });

    const empty = new FakeSvm({ relayer: pub, withConfig: false });
    const emptyRpc = createFakeSvmRpc(empty);
    const missing = await buildSolanaWriteSide(config, handle.db, (_url, init) =>
      fakeFetch(emptyRpc, init),
    );
    expect(missing.kind).toBe("config_missing");
    if (missing.kind === "config_missing") expect(missing.hint).toContain("init-solana-config");

    const ready = new FakeSvm({ relayer: pub });
    const readyRpc = createFakeSvmRpc(ready);
    const on = await buildSolanaWriteSide(config, handle.db, (_url, init) =>
      fakeFetch(readyRpc, init),
    );
    expect(on.kind).toBe("on");
    if (on.kind === "on") {
      expect(on.relayerAddress).toBe(pubkeyToBase58(pub));
      expect(on.adapter.chainKey).toBe("solana-devnet");
      expect(on.adapter.relayerAddress).toBe(pubkeyToBase58(pub));
    }
    await handle.close();
  });
});

describe("createDropRent", () => {
  it("is the rent of a 424 byte drop and the bitmap, what create_drop really pays", async () => {
    // Every drop the program creates since handle mode is 424 bytes. 360 held back
    // 445,440 lamports too little from the day's budget on every create.
    const rpc = createFakeSvmRpc(new FakeSvm({ relayer: randomSigner().publicKey }));
    expect(await createDropRent(rpc)).toBe(rentFor(424) + rentFor(1291));
  });
});

/**
 * Route a JSON-RPC request from the real `createSvmRpc` into the fake. Only the read the config
 * gate makes is needed here; anything else is a test bug.
 */
async function fakeFetch(
  rpc: ReturnType<typeof createFakeSvmRpc>,
  init: RequestInit | undefined,
): Promise<Response> {
  const request = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
    id: number;
    method: string;
    params: unknown[];
  };
  if (request.method !== "getAccountInfo") throw new Error(`unexpected rpc ${request.method}`);
  const { pubkeyFromBase58 } = await import("../src/chain/svm/pubkey.js");
  const info = await rpc.getAccountInfo(pubkeyFromBase58(request.params[0] as string), "confirmed");
  const value =
    info === null
      ? null
      : {
          lamports: Number(info.lamports),
          owner: pubkeyToBase58(info.owner),
          data: [Buffer.from(info.data).toString("base64"), "base64"],
          executable: false,
        };
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 1 }, value } }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("the two windows on a new drop", () => {
  it("a new drop gets 24 hours to fund and 7 days to claim, read back from the chain", async () => {
    const { harness, headers } = await signedIn();
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      drop: Record<string, unknown>;
      funding: Record<string, unknown>;
    };
    // The fake cluster's clock is 1_800_000_000; the program writes created_at + funding_period.
    expect(payload.funding["fundingDeadline"]).toBe(String(1_800_000_000 + 24 * 60 * 60));
    expect(payload.drop["claimPeriodSeconds"]).toBe(7 * 24 * 60 * 60);
  });
});
