/**
 * the api refuses a refund address
 * that is one of the drop's own accounts or a program, before anything is sent. The answer is
 * the zero address one, `400 invalid_receivers`, with a message that names the reason. No row,
 * no create call, no fee. The token cases, the mint and the vault on Solana and the token on
 * Robinhood, are in `token-create.test.ts` and `evm-token-drops.test.ts`.
 */
import { getChain } from "@dropchad/chains";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import { computeSalt, creatorCommitment, predictDropAddress } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  bitmapPda,
  configPda,
  dropPda,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/chain/svm/pda.js";
import { DROPCHAD_PROGRAM_ID, pubkeyToBase58, SYSTEM_PROGRAM_ID } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { drops } from "../src/db/schema.js";
import {
  FAKE_CHAIN_ID,
  FAKE_FACTORY,
  FAKE_IMPLEMENTATION,
  FAKE_RELAYER,
  createFakeChain,
  evmAdapterFor,
  type FakeChain,
} from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

/** The stubbed X user in `harness.ts`. */
const X_USER_ID = 1234567890n;
/** Fixed, so the test knows the drop address the api will predict. */
const BLIND = `0x${"b1".repeat(32)}` as const;

async function headersOf(harness: Harness): Promise<Record<string, string>> {
  const { jar } = await login(harness);
  return {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

async function expectRefused(harness: Harness, response: Response, what: string): Promise<void> {
  expect(response.status, what).toBe(400);
  const body = (await response.json()) as { error: string; message: string };
  expect(body.error, what).toBe("invalid_receivers");
  expect(body.message, what).toMatch(/refund address/);
  expect(await harness.deps.db.select().from(drops), what).toHaveLength(0);
}

// --- Robinhood --------------------------------------------------------------------------------

describe("on Robinhood: the drop's own contracts as the refund address", () => {
  const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";

  async function evmWorld(): Promise<{
    harness: Harness;
    chain: FakeChain;
    post: (refundRecipient: string) => Promise<Response>;
  }> {
    const chain = createFakeChain();
    const harness = await createHarness({
      writeSide: { chain, chainName: "Robinhood Chain Testnet" },
      randomBlind: () => BLIND,
    });
    const headers = await headersOf(harness);
    const post = async (refundRecipient: string) =>
      harness.app.request("/api/drops", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "address",
          receivers: [{ address: A, amount: "100000000000000" }],
          refundRecipient,
        }),
      });
    return { harness, chain, post };
  }

  it("the factory the drop is made on, in any letter case", async () => {
    const w = await evmWorld();
    await expectRefused(w.harness, await w.post(FAKE_FACTORY.toLowerCase()), "factory");
    expect(w.chain.creates).toHaveLength(0);
    await w.harness.close();
  });

  it("the implementation the drop clones", async () => {
    const w = await evmWorld();
    await expectRefused(w.harness, await w.post(FAKE_IMPLEMENTATION), "implementation");
    expect(w.chain.creates).toHaveLength(0);
    await w.harness.close();
  });

  it("the BinderRegistry", async () => {
    const registry = getChain("robinhood-testnet").contracts.binderRegistry;
    expect(registry).not.toBeNull();
    const w = await evmWorld();
    await expectRefused(w.harness, await w.post(registry as string), "registry");
    expect(w.chain.creates).toHaveLength(0);
    await w.harness.close();
  });

  it("the predicted drop address itself", async () => {
    const predicted = predictDropAddress({
      factory: FAKE_FACTORY,
      implementation: FAKE_IMPLEMENTATION,
      salt: computeSalt({
        chainId: FAKE_CHAIN_ID,
        factory: FAKE_FACTORY,
        creator: FAKE_RELAYER,
        creatorCommitment: creatorCommitment(X_USER_ID, 0n, BLIND),
        nonce: 0n,
      }),
    });
    const w = await evmWorld();
    await expectRefused(w.harness, await w.post(getAddress(predicted)), "drop");
    expect(w.chain.creates).toHaveLength(0);
    await w.harness.close();
  });
});

// --- Solana -----------------------------------------------------------------------------------

describe("on Solana: the drop's own accounts and the program ids", () => {
  const A = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
  const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];

  async function svmWorld(): Promise<{
    harness: Harness;
    svm: FakeSvm;
    post: (refundRecipient: string) => Promise<Response>;
  }> {
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
    const evm = evmAdapterFor(createFakeChain());
    const harness = await createHarness({
      writeSides: adaptersFrom([evm, solana], evm.chainKey),
      randomBlind: () => BLIND,
    });
    const headers = await headersOf(harness);
    const post = async (refundRecipient: string) =>
      harness.app.request("/api/drops", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "address",
          chain: "solana-devnet",
          receivers: [{ address: A, amount: "10000000" }],
          refundRecipient,
        }),
      });
    return { harness, svm, post };
  }

  const creates = (svm: FakeSvm) => svm.executed.filter((name) => name === "create_drop").length;

  /** The drop the api will create: the X id, nonce 0 and the fixed blind. */
  const predictedDrop = () => {
    const commitment = creatorCommitment(X_USER_ID, 0n, BLIND);
    return dropPda(new Uint8Array(Buffer.from(commitment.slice(2), "hex")), 0n).address;
  };

  it("the Config account", async () => {
    const w = await svmWorld();
    await expectRefused(w.harness, await w.post(pubkeyToBase58(configPda().address)), "config");
    expect(creates(w.svm)).toBe(0);
    await w.harness.close();
  });

  it("the dropchad program and the token program ids", async () => {
    const w = await svmWorld();
    for (const [what, id] of [
      ["dropchad", DROPCHAD_PROGRAM_ID],
      ["token", TOKEN_PROGRAM_ID],
      ["token-2022", TOKEN_2022_PROGRAM_ID],
      ["associated token", ASSOCIATED_TOKEN_PROGRAM_ID],
    ] as const) {
      await expectRefused(w.harness, await w.post(pubkeyToBase58(id)), what);
    }
    expect(creates(w.svm)).toBe(0);
    await w.harness.close();
  });

  it("the System program is the zero key, refused as before", async () => {
    const w = await svmWorld();
    const res = await w.post(pubkeyToBase58(SYSTEM_PROGRAM_ID));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_receivers" });
    expect(creates(w.svm)).toBe(0);
    await w.harness.close();
  });

  it("the predicted drop address itself", async () => {
    const w = await svmWorld();
    await expectRefused(w.harness, await w.post(pubkeyToBase58(predictedDrop())), "drop");
    expect(creates(w.svm)).toBe(0);
    await w.harness.close();
  });

  it("the drop's bitmap", async () => {
    const w = await svmWorld();
    const bitmap = pubkeyToBase58(bitmapPda(predictedDrop()).address);
    await expectRefused(w.harness, await w.post(bitmap), "bitmap");
    expect(creates(w.svm)).toBe(0);
    await w.harness.close();
  });
});
