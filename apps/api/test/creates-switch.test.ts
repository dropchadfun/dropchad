/**
 * One api switch per chain, `SOLANA_CREATES`
 * and `EVM_CREATES`, `on` by default. Off answers `503 creates_off` on `POST /api/drops` for that
 * chain only, before anything is read or written. `GET /api/chains` says `createsOn` and `offBy`
 * per chain, from the switch or from the program and factory pause; the switch wins.
 */
import { getChain } from "@dropchad/chains";
import { afterEach, describe, expect, it } from "vitest";

import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import { loadConfig, redactedConfig } from "../src/config.js";
import { dropJobs, drops } from "../src/db/schema.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { FAKE_CHAIN_KEY, createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";

const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
const SOL_A = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const SOL_REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const EVM_A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const EVM_REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Solana over the fake cluster and Robinhood over the fake factory, both with a write side. */
async function setup(env: Record<string, string> = {}) {
  const signer = randomSigner();
  const svm = new FakeSvm({ relayer: signer.publicKey, defaultFeeBps: 100 });
  const rpc = createFakeSvmRpc(svm);
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(false),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  const solana: ChainAdapter = createSvmAdapter({ rpc, relayer, chain: CHAIN });
  const fake: FakeChain = createFakeChain();
  const evm = evmAdapterFor(fake);
  harness = await createHarness({
    writeSides: adaptersFrom([evm, solana], evm.chainKey),
    env,
  });
  return { harness, svm, fake };
}

async function headersFor(h: Harness): Promise<Record<string, string>> {
  const { jar } = await login(h);
  return {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

const solanaBody = JSON.stringify({
  mode: "address",
  chain: "solana-devnet",
  receivers: [{ address: SOL_A, amount: "10000000" }],
  refundRecipient: SOL_REFUND,
});

const evmBody = JSON.stringify({
  mode: "address",
  chain: FAKE_CHAIN_KEY,
  receivers: [{ address: EVM_A, amount: "100000000000000" }],
  refundRecipient: EVM_REFUND,
});

interface ChainRow {
  readonly key: string;
  readonly family: string;
  readonly createsOn?: boolean | null;
  readonly offBy?: string | null;
}

async function chainsOf(h: Harness) {
  const response = await h.app.request("/api/chains");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { chains: ChainRow[] };
  const find = (family: string) => body.chains.find((chain) => chain.family === family);
  return { solana: find("svm"), robinhood: find("evm") };
}

describe("the switches, config", () => {
  it("are on by default", () => {
    const config = loadConfig({ ...TEST_ENV });
    expect(config.SOLANA_CREATES).toBe("on");
    expect(config.EVM_CREATES).toBe("on");
  });

  it("take off, one per chain", () => {
    const config = loadConfig({ ...TEST_ENV, SOLANA_CREATES: "off" });
    expect(config.SOLANA_CREATES).toBe("off");
    expect(config.EVM_CREATES).toBe("on");
  });

  it("a value other than on or off stops the start, naming the variable", () => {
    expect(() => loadConfig({ ...TEST_ENV, SOLANA_CREATES: "no" })).toThrow(/SOLANA_CREATES/);
    expect(() => loadConfig({ ...TEST_ENV, EVM_CREATES: "false" })).toThrow(/EVM_CREATES/);
  });

  it("the printed config shows both", () => {
    const printed = redactedConfig(loadConfig({ ...TEST_ENV, EVM_CREATES: "off" }));
    expect(printed["SOLANA_CREATES"]).toBe("on");
    expect(printed["EVM_CREATES"]).toBe("off");
  });
});

describe("POST /api/drops with a switch off", () => {
  it("SOLANA_CREATES=off answers 503 creates_off for Solana, and writes and sends nothing", async () => {
    const { harness: h, svm } = await setup({ SOLANA_CREATES: "off" });
    const sentBefore = svm.sent.length;
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: solanaBody,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "creates_off", chain: "solana-devnet" });
    expect(await h.deps.db.select().from(drops)).toHaveLength(0);
    expect(await h.deps.db.select().from(dropJobs)).toHaveLength(0);
    expect(svm.sent.length).toBe(sentBefore);
  });

  it("EVM_CREATES=off answers 503 creates_off for Robinhood, and sends nothing", async () => {
    const { harness: h, fake } = await setup({ EVM_CREATES: "off" });
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: evmBody,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "creates_off", chain: FAKE_CHAIN_KEY });
    expect(fake.creates).toHaveLength(0);
    expect(await h.deps.db.select().from(drops)).toHaveLength(0);
  });

  it("one chain off never stops the other", async () => {
    const { harness: h, fake } = await setup({ SOLANA_CREATES: "off" });
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: evmBody,
    });
    expect(response.status).toBe(201);
    expect(fake.creates).toHaveLength(1);
  });

  it("is the first check: a body that would fail later still gets creates_off", async () => {
    const { harness: h } = await setup({ SOLANA_CREATES: "off" });
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: JSON.stringify({ mode: "address", chain: "solana-devnet", receivers: [] }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "creates_off" });
  });
});

describe("GET /api/chains, createsOn and offBy", () => {
  it("both on: createsOn true, offBy null", async () => {
    const { harness: h } = await setup();
    const { solana, robinhood } = await chainsOf(h);
    expect(solana).toMatchObject({ createsOn: true, offBy: null });
    expect(robinhood).toMatchObject({ createsOn: true, offBy: null });
  });

  it("the switch: that chain only, offBy api", async () => {
    const { harness: h } = await setup({ SOLANA_CREATES: "off" });
    const { solana, robinhood } = await chainsOf(h);
    expect(solana).toMatchObject({ createsOn: false, offBy: "api" });
    expect(robinhood).toMatchObject({ createsOn: true, offBy: null });
  });

  it("the Solana program pause: offBy program", async () => {
    const { harness: h, svm } = await setup();
    svm.setPaused(true);
    const { solana, robinhood } = await chainsOf(h);
    expect(solana).toMatchObject({ createsOn: false, offBy: "program" });
    expect(robinhood).toMatchObject({ createsOn: true, offBy: null });
  });

  it("the Robinhood factory pause: offBy program", async () => {
    const { harness: h, fake } = await setup();
    fake.setFactoryPaused(true);
    const { solana, robinhood } = await chainsOf(h);
    expect(robinhood).toMatchObject({ createsOn: false, offBy: "program" });
    expect(solana).toMatchObject({ createsOn: true, offBy: null });
  });

  it("switch and pause both: the switch wins, offBy api", async () => {
    const { harness: h, svm } = await setup({ SOLANA_CREATES: "off" });
    svm.setPaused(true);
    const { solana } = await chainsOf(h);
    expect(solana).toMatchObject({ createsOn: false, offBy: "api" });
  });

  it("a failed pause read: createsOn null, offBy null", async () => {
    const { harness: h, fake } = await setup();
    fake.failFactoryPausedRead();
    const { robinhood } = await chainsOf(h);
    expect(robinhood).toMatchObject({ createsOn: null, offBy: null });
  });

  it("a failed pause read with the switch off still says off by api", async () => {
    const { harness: h, fake } = await setup({ EVM_CREATES: "off" });
    fake.failFactoryPausedRead();
    const { robinhood } = await chainsOf(h);
    expect(robinhood).toMatchObject({ createsOn: false, offBy: "api" });
  });
});

describe("POST /api/drops while the program or factory is paused", () => {
  it("the Solana program pause answers 503 creates_off, and writes and sends nothing", async () => {
    const { harness: h, svm } = await setup();
    svm.setPaused(true);
    const sentBefore = svm.sent.length;
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: solanaBody,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "creates_off", chain: "solana-devnet" });
    expect(await h.deps.db.select().from(drops)).toHaveLength(0);
    expect(await h.deps.db.select().from(dropJobs)).toHaveLength(0);
    expect(svm.sent.length).toBe(sentBefore);
  });

  it("the Robinhood factory pause answers 503 creates_off, and sends nothing", async () => {
    const { harness: h, fake } = await setup();
    fake.setFactoryPaused(true);
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: evmBody,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "creates_off", chain: FAKE_CHAIN_KEY });
    expect(fake.creates).toHaveLength(0);
    expect(await h.deps.db.select().from(drops)).toHaveLength(0);
  });

  it("one chain paused never stops the other", async () => {
    const { harness: h, svm, fake } = await setup();
    svm.setPaused(true);
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: evmBody,
    });
    expect(response.status).toBe(201);
    expect(fake.creates).toHaveLength(1);
  });

  it("right after the switch: a body that would fail later still gets creates_off", async () => {
    const { harness: h, svm } = await setup();
    svm.setPaused(true);
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: JSON.stringify({ mode: "address", chain: "solana-devnet", receivers: [] }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "creates_off" });
  });

  it("a failed pause read goes on as before", async () => {
    const { harness: h, fake } = await setup();
    fake.failFactoryPausedRead();
    const response = await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: evmBody,
    });
    expect(response.status).toBe(201);
    expect(fake.creates).toHaveLength(1);
  });

  it("the same read and cache as GET /api/chains: one read for both", async () => {
    const { harness: h, fake } = await setup();
    const before = fake.factoryPausedReads();
    await h.app.request("/api/drops", {
      method: "POST",
      headers: await headersFor(h),
      body: evmBody,
    });
    expect(fake.factoryPausedReads()).toBe(before + 1);
    await chainsOf(h);
    expect(fake.factoryPausedReads()).toBe(before + 1);
  });
});
