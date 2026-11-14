/**
 * The api picks `DropFactoryV6` once it is recorded.
 * and 5:
 * - `isServedEvmChain`: the api serves an EVM chain that is `isDeployed` or `hasV6Contracts`, so a
 *   chain with the V6 set alone (the mainnet shape) is served
 * - `evmFactoryFor`: V6 creates every new drop once `hasV6Contracts`, on `DropV6`, with
 *   `BinderRegistryV2`, on top of V5 or alone
 * - the token check reads `allowedToken` on V6
 * - the gateway reads `paused` and the fee from V6
 * - the relayer sends the V3 `createDrop` selector to V6, the list of calls unchanged
 * - `evmBinderRegistries`: the registries a drop on this chain may read
 * The live robinhood testnet entry carries the deployed V6 set and V7 on top since
 * so the testnet here is the live entry without its V7 fields; the shapes below use made
 * up V6 addresses. The V7 pick is in `factory-v7-pick.test.ts`.
 */
import { getChain, getDeployedChain, type Chain, type DeployedChain } from "@dropchad/chains";
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

const F6 = getAddress("0x00000000000000000000000000000000000000f6");
const DROP_V6 = getAddress("0x00000000000000000000000000000000000000d6");
const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
const REGISTRY = getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");
const v6 = {
  factoryV6: F6,
  implementationV6: DROP_V6,
  binderRegistryV2: REGISTRY_V2,
  deployBlockV6: 140_000_000,
};

const LIVE = getDeployedChain("robinhood-testnet");
/** The live testnet entry without V7: V1 to V6, as before V7. */
const TESTNET: DeployedChain = {
  ...LIVE,
  contracts: { ...LIVE.contracts, factoryV7: null, implementationV7: null, deployBlockV7: null },
};
/** Robinhood testnet with V6 recorded on top of its V5: the testnet shape. */
const ON_TOP: ServedEvmChain = { ...TESTNET, contracts: { ...TESTNET.contracts, ...v6 } };
const MAINNET = getChain("robinhood");
/** Robinhood mainnet with the V6 set alone, every V1 to V5 field null: the mainnet shape. */
const ALONE_RAW: Chain = { ...MAINNET, contracts: { ...MAINNET.contracts, ...v6 } };
const ALONE: ServedEvmChain = (() => {
  if (!isServedEvmChain(ALONE_RAW)) throw new Error("the V6 only chain should be served");
  return ALONE_RAW;
})();

describe("isServedEvmChain, a V6 only chain", () => {
  it("the live testnet entry without V7, V1 to V6: served", () => {
    expect(isServedEvmChain(TESTNET)).toBe(true);
  });

  it("the V6 set alone, every V1 to V5 field null: served", () => {
    expect(isServedEvmChain(ALONE_RAW)).toBe(true);
  });

  it("mainnet as recorded today, nothing deployed: not served", () => {
    expect(isServedEvmChain(MAINNET)).toBe(false);
  });

  it("a Solana chain: never", () => {
    expect(isServedEvmChain(getChain("solana-devnet"))).toBe(false);
  });
});

describe("evmFactoryFor with DropFactoryV6", () => {
  it("the live testnet entry without V7: V6, recorded since", () => {
    expect(evmFactoryFor(TESTNET)).toEqual({
      version: 6,
      factory: getAddress("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba"),
      implementation: getAddress("0x5fbe17722728C8A34bF4763B83Eb699774133D1F"),
      binderRegistry: getAddress("0x3AFad174a45B82B3A0418D2f39c640C86d76Ea20"),
    });
  });

  it("V6 on top of V5: V6 creates every new drop, on DropV6, with BinderRegistryV2", () => {
    expect(evmFactoryFor(ON_TOP)).toEqual({
      version: 6,
      factory: F6,
      implementation: DROP_V6,
      binderRegistry: REGISTRY_V2,
    });
  });

  it("the V6 set alone: the same pick", () => {
    expect(evmFactoryFor(ALONE)).toEqual({
      version: 6,
      factory: F6,
      implementation: DROP_V6,
      binderRegistry: REGISTRY_V2,
    });
  });
});

describe("evmTokenCheckFactory with DropFactoryV6", () => {
  it("V6 on top of V5 and V6 alone: DropFactoryV6", () => {
    expect(evmTokenCheckFactory(ON_TOP)).toBe(F6);
    expect(evmTokenCheckFactory(ALONE)).toBe(F6);
  });
});

describe("evmBinderRegistries", () => {
  it("the live testnet entry: the BinderRegistry and the live BinderRegistryV2", () => {
    expect(evmBinderRegistries(TESTNET)).toEqual([
      REGISTRY,
      getAddress("0x3AFad174a45B82B3A0418D2f39c640C86d76Ea20"),
    ]);
  });

  it("V6 on top of V5: the BinderRegistry and BinderRegistryV2", () => {
    expect(evmBinderRegistries(ON_TOP)).toEqual([REGISTRY, REGISTRY_V2]);
  });

  it("the V6 set alone: BinderRegistryV2 only", () => {
    expect(evmBinderRegistries(ALONE)).toEqual([REGISTRY_V2]);
  });
});

describe("the gateway on version 6 reads from DropFactoryV6", () => {
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
      relayer: { address: getAddress("0x000000000000000000000000000000000000be11") } as Relayer,
      chainId: 46_630,
      version: picked.version,
      factory: picked.factory,
      implementation: picked.implementation,
      binderRegistry: picked.binderRegistry,
      binderRegistries: evmBinderRegistries(ON_TOP),
    });
    return { gateway, reads };
  }

  it("paused for the pause banner is the V6 factory's", async () => {
    const { gateway, reads } = gatewayAt();
    expect(await gateway.factoryPaused()).toBe(true);
    expect(reads).toEqual([{ address: F6, functionName: "paused" }]);
  });

  it("minFeePerReceiver and maxFeeAmount from the V6 factory, not zero", async () => {
    const { gateway, reads } = gatewayAt();
    expect(await gateway.minFeePerReceiver()).toBe(10_000_000_000_000n);
    expect(await gateway.maxFeeAmount()).toBe(20_000_000_000_000_000n);
    expect(reads).toEqual([
      { address: F6, functionName: "minFeePerReceiver" },
      { address: F6, functionName: "maxFeeAmount" },
    ]);
  });
});

describe("the relayer on version 6: the V3 createDrop", () => {
  it("sends the V3 selector to the V6 factory", async () => {
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
        address: getAddress("0x000000000000000000000000000000000000be11"),
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
    expect(sent[0]?.to).toBe(F6);
    expect(sent[0]?.data.slice(0, 10)).toBe(CREATE_DROP_V3_SELECTOR);
  });
});
