/**
 * after the live devnet token test
 * -: each fee tier on `GET /api/chains` carries `lamports`, the api's SOL estimate at its
 *   SOL price, rounded up the same way as at create; `null` with no price;
 * -: the SOL part of a token drop's funding is rounded up to 0.001 SOL, in the amount, the
 *   display and the link; a SOL drop's amount stays exact;
 * -: with no ticker the plain `symbol` is the word `tokens`, not the short mint.
 */
import { getChain } from "@dropchad/chains";
import { afterEach, describe, expect, it } from "vitest";

import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { unitOfDrop } from "../src/drops/token-info.js";
import type { PriceService } from "../src/prices/service.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { createHarness, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";

const SOL = 1_000_000_000n;
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const VAULT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function solanaAdapter(): ChainAdapter {
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
  return createSvmAdapter({
    rpc,
    relayer,
    chain: getChain("solana-devnet") as ReturnType<typeof getChain> & { chainId: number },
    feeModel: caps,
  });
}

interface Tier {
  readonly upTo: number;
  readonly usd: string;
  readonly lamports?: string | null;
}

async function tiersAt(prices: PriceService): Promise<{ solana: Tier[]; robinhood: unknown }> {
  const solana = solanaAdapter();
  harness = await createHarness({
    writeSides: adaptersFrom([solana, evmAdapterFor(createFakeChain())], solana.chainKey),
    // The tier mechanics at the prices on purpose; the defaults are in config.test.ts.
    env: { ...TEST_BINDER_ENV, TOKEN_FEE_TIERS_USD: "5:3,20:8,50:15,100:25,500:40" },
    prices,
  });
  const body = (await (await harness.app.request("/api/chains")).json()) as {
    chains: { family: string; tokenFeeTiers: Tier[] | null }[];
  };
  return {
    solana: body.chains.find((c) => c.family === "svm")?.tokenFeeTiers ?? [],
    robinhood: body.chains.find((c) => c.family === "evm")?.tokenFeeTiers,
  };
}

const priceOf = (sol: number | null): PriceService => ({
  usdPrice: (symbol) => Promise.resolve(symbol === "SOL" ? sol : null),
});

describe("each tier carries the api's SOL estimate", () => {
  it("at 150 usd a SOL, the tiers: $3 is 0.02 SOL, $15 is 0.1 SOL, $8 rounded up", async () => {
    const { solana, robinhood } = await tiersAt(priceOf(150));
    expect(solana).toEqual([
      { upTo: 5, usd: "3", lamports: "20000000" },
      { upTo: 20, usd: "8", lamports: "53333334" },
      { upTo: 50, usd: "15", lamports: "100000000" },
      { upTo: 100, usd: "25", lamports: "166666667" },
      { upTo: 500, usd: "40", lamports: "266666667" },
    ]);
    expect(robinhood).toBeNull();
  });

  it("no SOL price: the tiers stay, the estimate is null", async () => {
    const { solana } = await tiersAt(priceOf(null));
    expect(solana[0]).toEqual({ upTo: 5, usd: "3", lamports: null });
  });

  it("a price feed that fails: the estimate is null, the route still answers", async () => {
    const { solana } = await tiersAt({ usdPrice: () => Promise.reject(new Error("down")) });
    expect(solana[0]).toEqual({ upTo: 5, usd: "3", lamports: null });
  });
});

describe("the SOL part of a token drop is rounded up to 0.001 SOL", () => {
  const token = {
    mint: MINT,
    vault: VAULT,
    tokenProgram: TOKEN_PROGRAM,
    name: "Bonk",
    symbol: "BONK",
    decimals: 5,
    amount: 100_000_000n,
  };

  it("0.12654 SOL becomes 0.127 in the amount, the display and the link", () => {
    const f = solanaAdapter().fundingInstructions({
      drop: DROP,
      amount: 126_540_000n,
      fundingDeadline: 1n,
      token,
    });
    expect(f.amountBaseUnits).toBe("127000000");
    expect(f.amountWei).toBe("127000000");
    expect(f.amountDisplay).toBe("0.127");
    expect(f.amountEth).toBe("0.127");
    expect(f.paymentUri).toBe(`solana:${DROP}?amount=0.127`);
    // The tokens stay exact.
    expect(f.token?.amountBaseUnits).toBe("100000000");
  });

  it("an amount already on 0.001 stays as it is", () => {
    const f = solanaAdapter().fundingInstructions({
      drop: DROP,
      amount: 127_000_000n,
      fundingDeadline: 1n,
      token,
    });
    expect(f.amountBaseUnits).toBe("127000000");
  });

  it("a SOL drop stays exact: its amount is what people get", () => {
    const f = solanaAdapter().fundingInstructions({
      drop: DROP,
      amount: 126_540_001n,
      fundingDeadline: 1n,
    });
    expect(f.amountBaseUnits).toBe("126540001");
    expect(f.paymentUri).toBe(`solana:${DROP}?amount=0.126540001`);
  });
});

describe("no ticker, the word tokens", () => {
  it("the plain symbol is tokens, never the short mint", () => {
    expect(
      unitOfDrop(
        {
          asset: MINT,
          tokenProgram: TOKEN_PROGRAM,
          tokenDecimals: 6,
          tokenName: null,
          tokenSymbol: null,
          tokenLaunchpad: null,
        },
        { symbol: "SOL", decimals: 9 },
      ),
    ).toEqual({ symbol: "tokens", decimals: 6 });
  });
});
