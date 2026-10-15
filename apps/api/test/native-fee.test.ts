/**
 * the api side of the fee.
 * - one fee function, `nativeDropFee`, the same math as `sol_drop_fee` in the Solana program and
 *   `createDrop` in `DropFactoryV4`: `min(max(bps fee, flat minimum, per receiver x leaves), cap)`,
 *   zero is off, a zero cap is no cap. The table below is the one `fee_model.rs` and
 *   `DropFactoryV4.t.sol` pin, input for input
 * - Solana reads the two new `Config` fields, zero on the live bytes from before the upgrade
 * - Robinhood reads `minFeePerReceiver` and `maxFeeAmount` from `DropFactoryV4` only: version 3
 *   and older answer zero without a call
 * - the gas check, `GET /api/chains` and the read back of a native drop's `feeAmount` all
 *   use the same function
 */
import { getChain } from "@dropchad/chains";
import { dropchadIdl } from "@dropchad/shared";
import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { createChainGateway } from "../src/chain/gateway.js";
import type { Relayer } from "../src/chain/relayer.js";
import { decodeConfig } from "../src/chain/svm/accounts.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { DROPCHAD_PROGRAM_ID } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { drops } from "../src/db/schema.js";
import { nativeDropFee, type NativeFeeConfig } from "../src/drops/native-fee.js";
import type { PriceService } from "../src/prices/service.js";
import { FAKE_CHAIN_ID, FAKE_RELAYER, createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor, type FakeDrop } from "./fake-svm.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";

const SOL = 1_000_000_000n;
const ETH = 1_000_000_000_000_000_000n;
const MIN_SOL_LEAF = 890_880n;

function fee(
  bps: number,
  minFee: bigint,
  minFeePerReceiver: bigint,
  maxFee: bigint,
): NativeFeeConfig {
  return { bps, minFee, minFeePerReceiver, maxFee };
}

// ---------------------------------------------------------------------------------------------
// 1. the pinned table: the same inputs and answers as the program and the contract tests
// ---------------------------------------------------------------------------------------------

/** `[name, config, receivers, each, fee]`. Solana rows from `fee_model.rs`, lamports. */
const SOLANA_ROWS: [string, NativeFeeConfig, number, bigint, bigint][] = [
  [
    "per receiver wins on many small receivers",
    fee(100, 300_000n, 300_000n, 500_000_000n),
    10,
    MIN_SOL_LEAF,
    3_000_000n,
  ],
  [
    "the bps fee wins on a big drop",
    fee(100, 300_000n, 300_000n, 500_000_000n),
    3,
    SOL,
    30_000_000n,
  ],
  [
    "the flat minimum wins when it is the biggest",
    fee(100, 2_500_000n, 300_000n, 500_000_000n),
    2,
    MIN_SOL_LEAF,
    2_500_000n,
  ],
  [
    "the cap wins over the bps fee",
    fee(100, 300_000n, 300_000n, 500_000_000n),
    3,
    100n * SOL,
    500_000_000n,
  ],
  [
    "the cap wins over the per receiver minimum",
    fee(100, 300_000n, 300_000n, 1_000_000n),
    10,
    MIN_SOL_LEAF,
    1_000_000n,
  ],
  [
    "the cap wins over the flat minimum",
    fee(100, 300_000n, 0n, 100_000n),
    1,
    MIN_SOL_LEAF,
    100_000n,
  ],
  ["a zero cap is no cap", fee(100, 300_000n, 300_000n, 0n), 3, 100n * SOL, 3n * SOL],
  ["a zero per receiver minimum is off", fee(100, 0n, 0n, 500_000_000n), 10, MIN_SOL_LEAF, 89_088n],
  ["the per receiver minimum alone at zero bps", fee(0, 0n, 300_000n, 0n), 7, SOL, 2_100_000n],
  ["every part zero is no fee", fee(0, 0n, 0n, 0n), 3, SOL, 0n],
  [
    "every ceiling at once is capped at 1 SOL",
    fee(500, 25_000_000n, 3_000_000n, SOL),
    400,
    MIN_SOL_LEAF,
    SOL,
  ],
  [
    "both new fields zero: today's fee, the flat minimum",
    fee(100, 300_000n, 0n, 0n),
    3,
    MIN_SOL_LEAF,
    300_000n,
  ],
  ["both new fields zero: today's fee, 1 percent", fee(100, 300_000n, 0n, 0n), 3, SOL, 30_000_000n],
];

/** Robinhood rows from `DropFactoryV4.t.sol`, wei. */
const ROBINHOOD_ROWS: [string, NativeFeeConfig, number, bigint, bigint][] = [
  [
    "per receiver wins on many small receivers",
    fee(100, 10n ** 13n, 10n ** 13n, 2n * 10n ** 16n),
    10,
    10n ** 14n,
    10n ** 14n,
  ],
  [
    "the bps fee wins on a big drop",
    fee(100, 10n ** 13n, 10n ** 13n, 2n * 10n ** 16n),
    3,
    10n ** 17n,
    3n * 10n ** 15n,
  ],
  [
    "the flat minimum wins when it is the biggest",
    fee(100, 10n ** 15n, 10n ** 13n, 2n * 10n ** 16n),
    2,
    10n ** 15n,
    10n ** 15n,
  ],
  [
    "the cap wins over the bps fee",
    fee(100, 10n ** 13n, 10n ** 13n, 2n * 10n ** 16n),
    3,
    ETH,
    2n * 10n ** 16n,
  ],
  [
    "the cap wins over the per receiver minimum",
    fee(100, 10n ** 13n, 10n ** 13n, 5n * 10n ** 13n),
    10,
    10n ** 14n,
    5n * 10n ** 13n,
  ],
  [
    "the cap wins over the flat minimum",
    fee(100, 10n ** 14n, 0n, 5n * 10n ** 13n),
    1,
    10n ** 15n,
    5n * 10n ** 13n,
  ],
  ["a zero cap is no cap", fee(100, 10n ** 13n, 10n ** 13n, 0n), 3, ETH, 3n * 10n ** 16n],
  [
    "a zero per receiver minimum is off",
    fee(100, 0n, 0n, 2n * 10n ** 16n),
    10,
    10n ** 14n,
    10n ** 13n,
  ],
  [
    "the per receiver minimum alone at zero bps",
    fee(0, 0n, 10n ** 13n, 0n),
    7,
    ETH,
    7n * 10n ** 13n,
  ],
  ["every part zero is no fee", fee(0, 0n, 0n, 0n), 3, ETH, 0n],
  [
    "both new fields zero: the V3 fee, the flat minimum",
    fee(100, 10n ** 13n, 0n, 0n),
    3,
    10n ** 14n,
    10n ** 13n,
  ],
  [
    "both new fields zero: the V3 fee, 1 percent",
    fee(100, 10n ** 13n, 0n, 0n),
    3,
    ETH,
    3n * 10n ** 16n,
  ],
];

describe("nativeDropFee, pinned to the program and the contract", () => {
  it.each(SOLANA_ROWS)("Solana: %s", (_name, config, n, each, expected) => {
    expect(nativeDropFee(config, BigInt(n) * each, n)).toBe(expected);
  });

  it.each(ROBINHOOD_ROWS)("Robinhood: %s", (_name, config, n, each, expected) => {
    expect(nativeDropFee(config, BigInt(n) * each, n)).toBe(expected);
  });

  it("rounds the bps fee down", () => {
    expect(nativeDropFee(fee(100, 0n, 0n, 0n), 999n, 1)).toBe(9n);
  });

  it("matches the formula written out, over a grid of every part", () => {
    const reference = (c: NativeFeeConfig, total: bigint, n: number): bigint => {
      let f = (total * BigInt(c.bps)) / 10_000n;
      if (c.minFee > f) f = c.minFee;
      if (c.minFeePerReceiver * BigInt(n) > f) f = c.minFeePerReceiver * BigInt(n);
      if (c.maxFee !== 0n && f > c.maxFee) f = c.maxFee;
      return f;
    };
    for (const bps of [0, 1, 100, 500])
      for (const minFee of [0n, 1n, 300_000n, 25_000_000n])
        for (const per of [0n, 1n, 300_000n, 3_000_000n])
          for (const cap of [0n, 1n, 1_000_000n, SOL])
            for (const n of [1, 7, 10_000])
              for (const total of [1n, 999n, 89_088_000n, 300n * SOL]) {
                const c = fee(bps, minFee, per, cap);
                expect(nativeDropFee(c, total, n)).toBe(reference(c, total, n));
              }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Solana: the two Config fields, before and after the upgrade
// ---------------------------------------------------------------------------------------------

/** The live devnet `Config` `bQjX…ZQD`, read only at slot 508327461. */
const LIVE_CONFIG_B64 =
  "mwyq4B76zILza9FppVIl6dLBTORYJP3Y6qgPO5kINrwe3M9icOALbOaIWz+twvy1skzWYR8YjlqDdlHH28sXJFplY3u3Zt9Q82vRaaVSJenSwUzkWCT92OqoDzuZCDa8HtzPYnDgC2xkAABnAAAAAAAAAP+8uknE4xdQR2pGj0p7GAZevyehCm2c9nEYmXGVSXfofgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOCTBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

function liveConfig(): Uint8Array {
  return Uint8Array.from(Buffer.from(LIVE_CONFIG_B64, "base64"));
}

function u64At(bytes: Uint8Array, offset: number, value: bigint): void {
  new DataView(bytes.buffer, bytes.byteOffset).setBigUint64(offset, value, true);
}

const configInfo = (data: Uint8Array) => ({
  lamports: 1_935_480n,
  owner: DROPCHAD_PROGRAM_ID,
  data,
  executable: false,
});

describe("the Solana Config fee fields", () => {
  it("the IDL copy carries the two instructions and the two Config fields of the new build", () => {
    const names = dropchadIdl.instructions.map((ix) => ix.name);
    expect(names).toContain("set_fee_per_receiver");
    expect(names).toContain("set_max_fee");
    const config = dropchadIdl.types.find((t) => t.name === "Config");
    const fields = (
      config?.type as { readonly fields?: readonly { readonly name: string }[] } | undefined
    )?.fields?.map((f) => f.name);
    expect(fields).toContain("min_fee_per_receiver_lamports");
    expect(fields).toContain("max_fee_lamports");
  });

  it("reads the live bytes from before the upgrade: both new fields zero, the flat minimum kept", () => {
    const c = decodeConfig(configInfo(liveConfig()));
    expect(c.defaultFeeBps).toBe(100);
    expect(c.handle?.minFeeLamports).toBe(300_000n);
    expect(c.handle?.minFeePerReceiverLamports).toBe(0n);
    expect(c.handle?.maxFeeLamports).toBe(0n);
  });

  it("reads the two fields at bytes 189 and 197 once the admin sets them", () => {
    const bytes = liveConfig();
    u64At(bytes, 189, 300_000n);
    u64At(bytes, 197, 500_000_000n);
    const c = decodeConfig(configInfo(bytes));
    expect(c.handle?.minFeePerReceiverLamports).toBe(300_000n);
    expect(c.handle?.maxFeeLamports).toBe(500_000_000n);
    expect(c.handle?.minFeeLamports).toBe(300_000n); // the field before them is not moved
  });

  it("the adapter's feeConfig: zeros on a 116 byte Config, today's fee on the live shape, all four after", async () => {
    const old = new FakeSvm({ relayer: randomSigner().publicKey, defaultFeeBps: 100 });
    expect(await svmAdapter(old).feeConfig()).toEqual(fee(100, 0n, 0n, 0n));

    const today = new FakeSvm({
      relayer: randomSigner().publicKey,
      defaultFeeBps: 100,
      binder: TEST_SOL_BINDER_PUBKEY,
      minFeeLamports: 300_000n,
    });
    expect(await svmAdapter(today).feeConfig()).toEqual(fee(100, 300_000n, 0n, 0n));

    const after = new FakeSvm({
      relayer: randomSigner().publicKey,
      defaultFeeBps: 100,
      binder: TEST_SOL_BINDER_PUBKEY,
      minFeePerReceiverLamports: 300_000n,
      maxFeeLamports: 500_000_000n,
    });
    expect(await svmAdapter(after).feeConfig()).toEqual(fee(100, 0n, 300_000n, 500_000_000n));
  });

  it("feeConfig throws when the Config is missing, never a guessed zero", async () => {
    const none = new FakeSvm({ relayer: randomSigner().publicKey, withConfig: false });
    await expect(svmAdapter(none).feeConfig()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Robinhood: the V4 fields only from DropFactoryV4
// ---------------------------------------------------------------------------------------------

const FACTORY = getAddress("0x00000000000000000000000000000000000f4c74");
const IMPLEMENTATION = getAddress("0x00000000000000000000000000000000000d7093");

function gatewayAt(version: 1 | 2 | 3 | 4, answers: Record<string, bigint | number>) {
  const calls: string[] = [];
  const publicClient = {
    readContract(args: { address: Address; functionName: string }) {
      calls.push(args.functionName);
      return Promise.resolve(answers[args.functionName] ?? 0n);
    },
  } as unknown as PublicClient;
  const gateway = createChainGateway({
    publicClient,
    relayer: { address: FAKE_RELAYER } as Relayer,
    chainId: FAKE_CHAIN_ID,
    version,
    factory: FACTORY,
    implementation: IMPLEMENTATION,
  });
  return { gateway, calls };
}

describe("DropFactoryV4 fields on the gateway", () => {
  it("reads minFeePerReceiver and maxFeeAmount from DropFactoryV4", async () => {
    const { gateway, calls } = gatewayAt(4, {
      minFeePerReceiver: 10n ** 13n,
      maxFeeAmount: 2n * 10n ** 16n,
    });
    expect(await gateway.minFeePerReceiver()).toBe(10n ** 13n);
    expect(await gateway.maxFeeAmount()).toBe(2n * 10n ** 16n);
    expect(calls).toEqual(["minFeePerReceiver", "maxFeeAmount"]);
  });

  it.each([1, 2, 3] as const)(
    "is zero on version %i without a call: the V3 fee stays",
    async (version) => {
      const { gateway, calls } = gatewayAt(version, { minFeePerReceiver: 5n, maxFeeAmount: 5n });
      expect(await gateway.minFeePerReceiver()).toBe(0n);
      expect(await gateway.maxFeeAmount()).toBe(0n);
      expect(calls).toEqual([]);
    },
  );

  it("the EVM adapter's feeConfig: V3 keeps the V3 fee, V4 passes all four through", async () => {
    const v3 = evmAdapterFor(
      createFakeChain({
        version: 3,
        defaultFeeBps: 100,
        minFeeAmount: 10n ** 13n,
        minFeePerReceiver: 5n,
        maxFeeAmount: 5n,
      }),
    );
    expect(await v3.feeConfig()).toEqual(fee(100, 10n ** 13n, 0n, 0n));

    const v4 = evmAdapterFor(
      createFakeChain({
        version: 4,
        defaultFeeBps: 100,
        minFeeAmount: 0n,
        minFeePerReceiver: 10n ** 13n,
        maxFeeAmount: 2n * 10n ** 16n,
      }),
    );
    expect(await v4.feeConfig()).toEqual(fee(100, 0n, 10n ** 13n, 2n * 10n ** 16n));
  });
});

// ---------------------------------------------------------------------------------------------
// 4. the create path: the gas check, the read back, /api/chains
// ---------------------------------------------------------------------------------------------

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const C = "0xCcCcCCCcCCCCcCCCCCcCcCccCcCCCcCcccccCCcC";
const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const SA = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const SB = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";
const SC = "EnTJCS15dqbDTU2XywYSMaScoPv4Py4GzExrtY9DQxoD";
const SOL_REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";

/** ETH at 2,000 usd, SOL at 100 usd: 0.01 usd is 5e12 wei or 100,000 lamports. */
const PRICES: PriceService = {
  usdPrice: (symbol) => Promise.resolve(symbol === "ETH" ? 2_000 : symbol === "SOL" ? 100 : null),
};

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function signedIn(adapter: ChainAdapter): Promise<Record<string, string>> {
  harness = await createHarness({
    writeSides: singleAdapter(adapter),
    prices: PRICES,
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV, MIN_RECEIVER_USD_TESTNET: "0.01" },
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

const evmDrop = (amount: string) => ({
  mode: "address",
  receivers: [A, B, C].map((address) => ({ address, amount })),
  refundRecipient: REFUND,
});

const solDrop = (amount: string) => ({
  mode: "address",
  chain: "solana-devnet",
  receivers: [SA, SB, SC].map((address) => ({ address, amount })),
  refundRecipient: SOL_REFUND,
});

function svmAdapter(svm: FakeSvm, signer = randomSigner()): ChainAdapter {
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
  return createSvmAdapter({
    rpc,
    relayer,
    chain: getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"],
  });
}

/** A Solana world whose `Config` carries the fields, the relayer the adapter signs with. */
function solanaWorld(fields: { minFeePerReceiverLamports?: bigint; maxFeeLamports?: bigint } = {}) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    defaultFeeBps: 100,
    binder: TEST_SOL_BINDER_PUBKEY,
    ...fields,
  });
  return { svm, adapter: svmAdapter(svm, signer) };
}

describe("the create path uses the one fee function", () => {
  it("Robinhood V4: the drop's fee is the fee and the row stores it", async () => {
    const chain = createFakeChain({
      version: 4,
      defaultFeeBps: 100,
      minFeePerReceiver: 10n ** 13n,
      maxFeeAmount: 2n * 10n ** 16n,
    });
    const headers = await signedIn(evmAdapterFor(chain));
    // 3 x 0.0001 ETH: 1 percent is 3e12, 3 x 1e13 is 3e13.
    const res = await post(headers, evmDrop("100000000000000"));
    expect(res.status).toBe(201);
    const rows = await (harness as Harness).deps.db.select().from(drops);
    expect(rows[0]?.feeAmount).toBe("30000000000000");
    expect(rows[0]?.grossRequired).toBe("330000000000000");
  });

  it("Robinhood: the read back refuses a feeAmount that is not the api's fee", async () => {
    const chain = createFakeChain({
      version: 4,
      defaultFeeBps: 100,
      minFeePerReceiver: 10n ** 13n,
      tamperEvent: (event) => ({ ...event, feeAmount: (event["feeAmount"] as bigint) + 1n }),
    });
    const headers = await signedIn(evmAdapterFor(chain));
    const res = await post(headers, evmDrop("100000000000000"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("chain_disagreed");
    expect(body.message).toContain("feeAmount");
    expect(await (harness as Harness).deps.db.select().from(drops)).toHaveLength(0);
  });

  it("Robinhood: the gas check uses the per receiver minimum, so a drop 1 percent cannot carry passes", async () => {
    // Gas: 360k + 90k + 86k + 3 x 50k = 686,000 at 0.01 gwei is 6.86e12 wei. 1 percent of
    // 3 x 0.0001 ETH is 3e12, refused on V3; 3 x 1e13 per receiver is 3e13, taken on V4.
    const v3 = createFakeChain({ version: 3, defaultFeeBps: 100, gasPrice: 10_000_000n });
    let headers = await signedIn(evmAdapterFor(v3));
    expect((await post(headers, evmDrop("100000000000000"))).status).toBe(400);
    await (harness as Harness).close();

    const v4 = createFakeChain({
      version: 4,
      defaultFeeBps: 100,
      gasPrice: 10_000_000n,
      minFeePerReceiver: 10n ** 13n,
    });
    headers = await signedIn(evmAdapterFor(v4));
    expect((await post(headers, evmDrop("100000000000000"))).status).toBe(201);
  });

  it("Solana before the upgrade fields are set: the fee is today's 1 percent, read back and stored", async () => {
    const { adapter } = solanaWorld();
    const headers = await signedIn(adapter);
    const res = await post(headers, solDrop("10000000")); // 3 x 0.01 SOL
    expect(res.status).toBe(201);
    const rows = await (harness as Harness).deps.db.select().from(drops);
    expect(rows[0]?.feeAmount).toBe("300000");
    expect(rows[0]?.grossRequired).toBe("30300000");
  });

  it("Solana after the admin sets them: the fee, read back and stored", async () => {
    const { adapter } = solanaWorld({
      minFeePerReceiverLamports: 300_000n,
      maxFeeLamports: 500_000_000n,
    });
    const headers = await signedIn(adapter);
    const res = await post(headers, solDrop("10000000"));
    expect(res.status).toBe(201);
    const rows = await (harness as Harness).deps.db.select().from(drops);
    expect(rows[0]?.feeAmount).toBe("900000"); // 3 x 0.0003 SOL, above 1 percent
    expect(rows[0]?.grossRequired).toBe("30900000");
  });

  it("Solana: the read back refuses a feeAmount that is not the api's fee", async () => {
    const { svm, adapter } = solanaWorld({ minFeePerReceiverLamports: 300_000n });
    const headers = await signedIn(adapter);
    svm.tamperCreate = (d: FakeDrop) => ({
      ...d,
      feeAmount: d.feeAmount - 1n,
      grossRequired: d.grossRequired - 1n,
    });
    const res = await post(headers, solDrop("10000000"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("chain_disagreed");
    expect(body.message).toContain("feeAmount");
    expect(await (harness as Harness).deps.db.select().from(drops)).toHaveLength(0);
  });

  it("GET /api/chains sends minFeePerReceiver and maxFee, as strings", async () => {
    const chain = createFakeChain({
      version: 4,
      defaultFeeBps: 100,
      minFeePerReceiver: 10n ** 13n,
      maxFeeAmount: 2n * 10n ** 16n,
    });
    await signedIn(evmAdapterFor(chain));
    const res = await (harness as Harness).app.request("/api/chains");
    const body = (await res.json()) as {
      chains: { minFee: string | null; minFeePerReceiver: string | null; maxFee: string | null }[];
    };
    expect(body.chains[0]).toMatchObject({
      minFee: "0",
      minFeePerReceiver: "10000000000000",
      maxFee: "20000000000000000",
    });
  });

  it("GET /api/chains sends zeros for both on a V3 factory", async () => {
    await signedIn(evmAdapterFor(createFakeChain({ version: 3, defaultFeeBps: 100 })));
    const res = await (harness as Harness).app.request("/api/chains");
    const body = (await res.json()) as {
      chains: { minFeePerReceiver: string | null; maxFee: string | null }[];
    };
    expect(body.chains[0]).toMatchObject({ minFeePerReceiver: "0", maxFee: "0" });
  });
});
