/**
 * The api picks `DropFactoryV7` once it is recorded:
 * - `isServedEvmChain`: a chain with the V7 set alone and `binderRegistryV2` (the mainnet shape)
 *   is served, a V7 only chain counts as deployed
 * - `evmFactoryFor`: V7 creates every new drop once `hasV7Contracts`, on `DropV7`, with
 *   `BinderRegistryV2`, on top of V6 or alone
 * - the token check reads `allowedToken` on V7
 * - the gateway reads `paused` and the fee from V7
 * - the relayer sends the V3 `createDrop` selector to V7, the list of calls unchanged
 * - alert 3 reads V7 as the live factory, with its pause guardian, and V6 as the old one
 * The live robinhood testnet entry carries the deployed V7 set since; the shapes below use
 * made up V7 addresses.
 */
import { getChain, getDeployedChain, type Chain } from "@dropchad/chains";
import type { Address, Hex, PublicClient } from "viem";
import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { createChainGateway } from "../src/chain/gateway.js";
import {
  CREATE_DROP_V3_SELECTOR,
  createRelayer,
  type ReceiptLike,
  type Relayer,
} from "../src/chain/relayer.js";
import {
  evmBinderRegistries,
  evmFactoryFor,
  evmTokenCheckFactory,
  isServedEvmChain,
  type ServedEvmChain,
} from "../src/chain/write-side.js";
import { evmAdminTargets } from "../src/telegram/owner-alerts.js";

const F7 = getAddress("0x00000000000000000000000000000000000000f7");
const DROP_V7 = getAddress("0x00000000000000000000000000000000000000d7");
const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
const v7 = { factoryV7: F7, implementationV7: DROP_V7, deployBlockV7: 150_000_000 };

const LIVE_V7 = getAddress("0x61147e60e8F264c760b88Dd38C002B5bdF47254f");
const LIVE_DROP_V7 = getAddress("0x9274c88d7431Ef7533309cCC77bB9c1AdEB16720");
const LIVE_V6 = getAddress("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba");
const LIVE_REGISTRY_V2 = getAddress("0x3AFad174a45B82B3A0418D2f39c640C86d76Ea20");
const REGISTRY = getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");
const RELAYER = "0x000000000000000000000000000000000000be11";

const TESTNET = getDeployedChain("robinhood-testnet");
/** Robinhood testnet with made up V7 on top of its V6: the testnet shape. */
const ON_TOP: ServedEvmChain = { ...TESTNET, contracts: { ...TESTNET.contracts, ...v7 } };
const MAINNET = getChain("robinhood");
/** Robinhood mainnet with the V7 set alone and `binderRegistryV2`: the mainnet shape. */
const ALONE_RAW: Chain = {
  ...MAINNET,
  contracts: { ...MAINNET.contracts, ...v7, binderRegistryV2: REGISTRY_V2 },
};
/** Inside each test, so a chain that is not served fails that test and not the file. */
function alone(): ServedEvmChain {
  if (!isServedEvmChain(ALONE_RAW)) throw new Error("the V7 only chain should be served");
  return ALONE_RAW;
}

describe("isServedEvmChain, a V7 only chain", () => {
  it("the live testnet entry, V1 to V7: served", () => {
    expect(isServedEvmChain(TESTNET)).toBe(true);
  });

  it("the V7 set alone with binderRegistryV2, every V1 to V6 field null: served", () => {
    expect(isServedEvmChain(ALONE_RAW)).toBe(true);
  });

  it("mainnet as recorded today, nothing deployed: not served", () => {
    expect(isServedEvmChain(MAINNET)).toBe(false);
  });
});

describe("evmFactoryFor with DropFactoryV7", () => {
  it("today: V7 on robinhood testnet, recorded since", () => {
    expect(evmFactoryFor(TESTNET)).toEqual({
      version: 7,
      factory: LIVE_V7,
      implementation: LIVE_DROP_V7,
      binderRegistry: LIVE_REGISTRY_V2,
    });
  });

  it("V7 on top of V6: V7 creates every new drop, on DropV7, with BinderRegistryV2", () => {
    expect(evmFactoryFor(ON_TOP)).toEqual({
      version: 7,
      factory: F7,
      implementation: DROP_V7,
      binderRegistry: LIVE_REGISTRY_V2,
    });
  });

  it("the V7 set alone: the same pick", () => {
    expect(evmFactoryFor(alone())).toEqual({
      version: 7,
      factory: F7,
      implementation: DROP_V7,
      binderRegistry: REGISTRY_V2,
    });
  });
});

describe("evmTokenCheckFactory with DropFactoryV7", () => {
  it("today, V7 on top of V6 and V7 alone: DropFactoryV7", () => {
    expect(evmTokenCheckFactory(TESTNET)).toBe(LIVE_V7);
    expect(evmTokenCheckFactory(ON_TOP)).toBe(F7);
    expect(evmTokenCheckFactory(alone())).toBe(F7);
  });
});

describe("evmBinderRegistries with V7", () => {
  it("the V7 set alone: BinderRegistryV2 only", () => {
    expect(evmBinderRegistries(alone())).toEqual([REGISTRY_V2]);
  });
});

describe("the gateway on version 7 reads from DropFactoryV7", () => {
  function gatewayAt() {
    const reads: { address: Address; functionName: string }[] = [];
    const publicClient = {
      readContract: (args: { address: Address; functionName: string }) => {
        reads.push({ address: args.address, functionName: args.functionName });
        const values: Record<string, bigint | boolean> = {
          paused: true,
          minFeePerReceiver: 10_000_000_000_000n,
          maxFeeAmount: 20_000_000_000_000_000n,
        };
        return Promise.resolve(values[args.functionName] ?? 0n);
      },
    } as unknown as PublicClient;
    const picked = evmFactoryFor(ON_TOP);
    const gateway = createChainGateway({
      publicClient,
      relayer: { address: getAddress(RELAYER) } as Relayer,
      chainId: 46_630,
      version: picked.version,
      factory: picked.factory,
      implementation: picked.implementation,
      binderRegistry: picked.binderRegistry,
      binderRegistries: evmBinderRegistries(ON_TOP),
    });
    return { gateway, reads };
  }

  it("paused for the pause banner is the V7 factory's", async () => {
    const { gateway, reads } = gatewayAt();
    expect(await gateway.factoryPaused()).toBe(true);
    expect(reads).toEqual([{ address: F7, functionName: "paused" }]);
  });

  it("minFeePerReceiver and maxFeeAmount from the V7 factory, not zero", async () => {
    const { gateway, reads } = gatewayAt();
    expect(await gateway.minFeePerReceiver()).toBe(10_000_000_000_000n);
    expect(await gateway.maxFeeAmount()).toBe(20_000_000_000_000_000n);
    expect(reads).toEqual([
      { address: F7, functionName: "minFeePerReceiver" },
      { address: F7, functionName: "maxFeeAmount" },
    ]);
  });
});

describe("the relayer on version 7: the V3 createDrop", () => {
  it("sends the V3 selector to the V7 factory", async () => {
    const sent: { to: Address; data: Hex }[] = [];
    const ok: ReceiptLike = {
      status: "success",
      transactionHash: `0x${"aa".repeat(32)}`,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [],
    };
    const factory = evmFactoryFor(ON_TOP);
    const relayer = createRelayer({
      transport: {
        address: getAddress(RELAYER),
        pendingNonce: () => Promise.resolve(0),
        estimateGas: () => Promise.resolve(400_000n),
        maxFeePerGas: () => Promise.resolve(1n),
        send: (tx) => {
          sent.push({ to: tx.to, data: tx.data });
          return Promise.resolve(ok.transactionHash);
        },
        waitForReceipt: () => Promise.resolve(ok),
      },
      factory: factory.factory,
      factoryVersion: factory.version,
      isKnownDrop: () => Promise.resolve(false),
      gasBudget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      gasCaps: { createDrop: 2_000_000n, claimBatch: 2_000_000n, claimHandle: 300_000n },
    });

    await relayer.createDrop({
      asset: zeroAddress,
      merkleRoot: `0x${"11".repeat(32)}`,
      manifestHash: `0x${"22".repeat(32)}`,
      totalEntitlements: 1_000n,
      leafCount: 1,
      refundRecipient: getAddress("0x00000000000000000000000000000000000000aa"),
      creatorCommitment: `0x${"33".repeat(32)}`,
      nonce: 0n,
      fundingPeriod: 3_600,
      claimPeriod: 86_400,
      tokenFactory: zeroAddress,
      nativeFee: 0n,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(F7);
    expect(sent[0]?.data.slice(0, 10)).toBe(CREATE_DROP_V3_SELECTOR);
  });
});

describe("evmAdminTargets with DropFactoryV7, alert 3", () => {
  it("today: V7 live with its guardian, V6 old, both registries", () => {
    expect(evmAdminTargets(TESTNET, RELAYER)).toEqual({
      factory: LIVE_V7,
      oldFactory: LIVE_V6,
      registry: REGISTRY,
      registryV2: LIVE_REGISTRY_V2,
      pauseGuardian: true,
      relayer: RELAYER,
    });
  });

  it("V7 on top of V6: V7 live, V6 old", () => {
    expect(evmAdminTargets(ON_TOP, RELAYER)).toEqual({
      factory: F7,
      oldFactory: LIVE_V6,
      registry: REGISTRY,
      registryV2: LIVE_REGISTRY_V2,
      pauseGuardian: true,
      relayer: RELAYER,
    });
  });

  it("the V7 set alone: no old factory and no old registry", () => {
    expect(evmAdminTargets(alone(), RELAYER)).toEqual({
      factory: F7,
      oldFactory: null,
      registry: null,
      registryV2: REGISTRY_V2,
      pauseGuardian: true,
      relayer: RELAYER,
    });
  });
});
