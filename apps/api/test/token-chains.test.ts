/**
 * `GET /api/chains` sends each chain's
 * `tokenFeeTiers`, the usd tiers of `TOKEN_FEE_TIERS_USD` in order, `upTo` the last number of
 * people in the tier and `usd` the decimal string as written in config; `null` on a chain
 * without token drops (Robinhood until). From config only: no price, no chain read.
 */
import { getChain } from "@dropchad/chains";
import { afterEach, describe, expect, it } from "vitest";

import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { createHarness, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";

const SOL = 1_000_000_000n;

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

interface ChainRow {
  readonly key: string;
  readonly family: string;
  readonly tokenFeeTiers?: readonly { readonly upTo: number; readonly usd: string }[] | null;
}

/** The tiers without `lamports`, the SOL estimate of, `test/token-live-fix.test.ts`. */
const tiersOf = (chain: ChainRow | undefined) =>
  chain?.tokenFeeTiers?.map(({ upTo, usd }) => ({ upTo, usd }));

/** Solana over the fake cluster and Robinhood over the fake factory, like `token-create`. */
async function chains(env: Record<string, string> = {}, prices?: PriceService) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    relayerLamports: 50n * SOL,
  });
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
  const evm = evmAdapterFor(createFakeChain());
  harness = await createHarness({
    writeSides: adaptersFrom([solana, evm], solana.chainKey),
    env: { ...TEST_BINDER_ENV, ...env },
    ...(prices === undefined ? {} : { prices }),
  });
  const response = await harness.app.request("/api/chains");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { chains: ChainRow[] };
  const find = (family: string) => body.chains.find((chain) => chain.family === family);
  return { solana: find("svm"), robinhood: find("evm") };
}

describe("GET /api/chains, the token fee tiers", () => {
  it("Solana sends the default tiers in order, usd as written in config", async () => {
    const { solana } = await chains();
    expect(tiersOf(solana)).toEqual([
      { upTo: 5, usd: "1" },
      { upTo: 20, usd: "3" },
      { upTo: 50, usd: "6" },
      { upTo: 100, usd: "10" },
      { upTo: 500, usd: "20" },
    ]);
  });

  it("Robinhood takes no token drops yet: null, never an empty list", async () => {
    const { robinhood } = await chains();
    expect(robinhood).toBeDefined();
    expect(robinhood?.tokenFeeTiers).toBeNull();
  });

  it("follows the config, never a number in code", async () => {
    const { solana } = await chains({ TOKEN_FEE_TIERS_USD: "3:10,9:22.5" });
    expect(tiersOf(solana)).toEqual([
      { upTo: 3, usd: "10" },
      { upTo: 9, usd: "22.5" },
    ]);
  });

  it("needs no price: the tiers are there with no SOL price at all", async () => {
    const { solana } = await chains({}, { usdPrice: () => Promise.resolve(null) });
    expect(tiersOf(solana)?.[0]).toEqual({ upTo: 5, usd: "1" });
  });
});
