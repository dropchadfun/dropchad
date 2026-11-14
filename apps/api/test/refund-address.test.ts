/**
 * The api refuses a refund address
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
import { createEvmAdapter } from "../src/chain/evm/adapter.js";
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

/**
 * The runtime's reserved account keys: `agave-reserved-account-keys`
 * 4.3.2, `RESERVED_ACCOUNTS`, every id as `solana-sdk-ids` 3.1.0 declares it. No transaction can
 * write one, so a drop with one as its refund address could never refund or close.
 */
const RESERVED: readonly (readonly [name: string, address: string])[] = [
  ["address lookup table program", "AddressLookupTab1e1111111111111111111111111"],
  ["BPF loader", "BPFLoader2111111111111111111111111111111111"],
  ["deprecated BPF loader", "BPFLoader1111111111111111111111111111111111"],
  ["upgradeable BPF loader", "BPFLoaderUpgradeab1e11111111111111111111111"],
  ["compute budget program", "ComputeBudget111111111111111111111111111111"],
  ["config program", "Config1111111111111111111111111111111111111"],
  ["ed25519 program", "Ed25519SigVerify111111111111111111111111111"],
  ["feature program", "Feature111111111111111111111111111111111111"],
  ["loader v4", "LoaderV411111111111111111111111111111111111"],
  ["secp256k1 program", "KeccakSecp256k11111111111111111111111111111"],
  ["secp256r1 program", "Secp256r1SigVerify1111111111111111111111111"],
  ["stake config", "StakeConfig11111111111111111111111111111111"],
  ["stake program", "Stake11111111111111111111111111111111111111"],
  ["system program", "11111111111111111111111111111111"],
  ["vote program", "Vote111111111111111111111111111111111111111"],
  ["zk elgamal proof program", "ZkE1Gama1Proof11111111111111111111111111111"],
  ["zk token proof program", "ZkTokenProof1111111111111111111111111111111"],
  ["clock sysvar", "SysvarC1ock11111111111111111111111111111111"],
  ["epoch rewards sysvar", "SysvarEpochRewards1111111111111111111111111"],
  ["epoch schedule sysvar", "SysvarEpochSchedu1e111111111111111111111111"],
  ["fees sysvar", "SysvarFees111111111111111111111111111111111"],
  ["instructions sysvar", "Sysvar1nstructions1111111111111111111111111"],
  ["last restart slot sysvar", "SysvarLastRestartS1ot1111111111111111111111"],
  ["recent blockhashes sysvar", "SysvarRecentB1ockHashes11111111111111111111"],
  ["rent sysvar", "SysvarRent111111111111111111111111111111111"],
  ["rewards sysvar", "SysvarRewards111111111111111111111111111111"],
  ["slot hashes sysvar", "SysvarS1otHashes111111111111111111111111111"],
  ["slot history sysvar", "SysvarS1otHistory11111111111111111111111111"],
  ["stake history sysvar", "SysvarStakeHistory1111111111111111111111111"],
  ["native loader", "NativeLoader1111111111111111111111111111111"],
  ["sysvar owner", "Sysvar1111111111111111111111111111111111111"],
];

describe("on Solana: the runtime's reserved account keys", () => {
  const CHAIN = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
  const adapter = () => {
    const signer = randomSigner();
    const rpc = createFakeSvmRpc(new FakeSvm({ relayer: signer.publicKey, defaultFeeBps: 100 }));
    const relayer = createSvmRelayer({
      rpc,
      signer,
      isKnownDrop: () => Promise.resolve(false),
      budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
      rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
      sleep: () => Promise.resolve(),
    });
    return createSvmAdapter({ rpc, relayer, chain: CHAIN });
  };
  const drop = pubkeyToBase58(randomSigner().publicKey);

  it("the pinned list is the 31 keys of agave 4.3.2, each once", () => {
    expect(RESERVED).toHaveLength(31);
    expect(new Set(RESERVED.map(([, address]) => address)).size).toBe(31);
  });

  it("every reserved key is refused, named a Solana system account", () => {
    const refused = adapter().refusedRefundAddresses({ drop });
    for (const [name, address] of RESERVED) {
      const entry = refused.find((r) => r.address === address);
      expect(entry, name).toBeDefined();
      expect(entry?.what, name).toMatch(/Solana system account/);
    }
  });

  it("on a token drop too, next to the mint and the vault", () => {
    const mint = pubkeyToBase58(randomSigner().publicKey);
    const refused = adapter().refusedRefundAddresses({
      drop,
      mint,
      tokenProgram: pubkeyToBase58(TOKEN_PROGRAM_ID),
    });
    for (const [name, address] of RESERVED) {
      expect(
        refused.some((r) => r.address === address),
        name,
      ).toBe(true);
    }
    expect(refused.some((r) => r.address === mint)).toBe(true);
  });

  it("POST /api/drops refuses a sysvar as the refund address, nothing is created", async () => {
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
    for (const address of [
      "SysvarC1ock11111111111111111111111111111111",
      "Ed25519SigVerify111111111111111111111111111",
      "BPFLoaderUpgradeab1e11111111111111111111111",
    ]) {
      const response = await harness.app.request("/api/drops", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "address",
          chain: "solana-devnet",
          receivers: [
            { address: "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB", amount: "10000000" },
          ],
          refundRecipient: address,
        }),
      });
      await expectRefused(harness, response, address);
    }
    expect(svm.executed.filter((name) => name === "create_drop")).toHaveLength(0);
    await harness.close();
  });
});

describe("Robinhood with V6", () => {
  // No chain has V6 recorded yet, so these addresses are made up.
  const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
  const v6 = {
    factoryV6: getAddress("0x00000000000000000000000000000000000000f6"),
    implementationV6: getAddress("0x00000000000000000000000000000000000000d6"),
    binderRegistryV2: REGISTRY_V2,
    deployBlockV6: 140_000_000,
  };
  const refusedOf = (chain: ReturnType<typeof getChain>) =>
    createEvmAdapter({ gateway: createFakeChain(), chain }).refusedRefundAddresses({
      drop: "0x0000000000000000000000000000000000d60001",
    });

  it("V6 on top of V5: BinderRegistryV2 refused, the BinderRegistry still refused", () => {
    const testnet = getChain("robinhood-testnet");
    const refused = refusedOf({ ...testnet, contracts: { ...testnet.contracts, ...v6 } });
    expect(refused).toContainEqual({ address: REGISTRY_V2, what: "the BinderRegistryV2" });
    expect(refused).toContainEqual({
      address: getAddress(testnet.contracts.binderRegistry as string),
      what: "the BinderRegistry",
    });
  });

  it("the V6 set alone: BinderRegistryV2 refused", () => {
    const mainnet = getChain("robinhood");
    const refused = refusedOf({ ...mainnet, contracts: { ...mainnet.contracts, ...v6 } });
    expect(refused).toContainEqual({ address: REGISTRY_V2, what: "the BinderRegistryV2" });
    expect(refused.map((r) => r.what)).not.toContain("the BinderRegistry");
  });
});
