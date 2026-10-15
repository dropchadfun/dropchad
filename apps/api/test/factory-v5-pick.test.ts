/**
 * The api picks `DropFactoryV5` once it is recorded.
 * - `evmFactoryFor`: V5 creates every new Robinhood drop once `hasRefundSafeContracts`, both modes
 *   and both assets, with the new `DropV5` and the live `BinderRegistry`. The relayer, the
 *   gateway and the CREATE2 prediction all take this one pick
 * - the token check reads `allowedToken` on V5, `evmTokenCheckFactory`
 * - the gateway reads the fee from V5 as from V4: V5 keeps every V4 view
 * - the relayer sends the V3 `createDrop` selector to V5, the list of calls unchanged
 * - while V5 is not recorded, the api stays on V4 (`factory-v4-pick.test.ts`)
 */
import { getChain, type DeployedChain } from "@dropchad/chains";
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
import { evmFactoryFor, evmTokenCheckFactory } from "../src/chain/write-side.js";

const LIVE = getChain("robinhood-testnet") as DeployedChain;
const V4_FACTORY = getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4");
const V5_FACTORY = getAddress("0xF01FF6f70482955078AF1cF774bd500E9276AFdc");
const DROP_V5 = getAddress("0x39C2789dE00750a53987b140BE8b631965eBC933");
const DROP_V3 = getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6");
const REGISTRY = getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");

describe("evmFactoryFor with DropFactoryV5", () => {
  it("today: V5 on robinhood testnet, recorded", () => {
    expect(evmFactoryFor(LIVE)).toEqual({
      version: 5,
      factory: V5_FACTORY,
      implementation: DROP_V5,
      binderRegistry: REGISTRY,
    });
  });

  it("not with a V5 field missing: V4 and its DropV3 stay", () => {
    const partial = {
      ...LIVE,
      contracts: { ...LIVE.contracts, implementationV5: null },
    } as DeployedChain;
    expect(evmFactoryFor(partial)).toEqual({
      version: 4,
      factory: V4_FACTORY,
      implementation: DROP_V3,
      binderRegistry: REGISTRY,
    });
  });
});

describe("evmTokenCheckFactory with DropFactoryV5", () => {
  it("today: DropFactoryV5, its own allowlist", () => {
    expect(evmTokenCheckFactory(LIVE)).toBe(V5_FACTORY);
  });
});

describe("the gateway on version 5 reads the fee from V5", () => {
  function gatewayAt(version: number) {
    const reads: { address: Address; functionName: string }[] = [];
    const publicClient = {
      readContract: (args: { address: Address; functionName: string }) => {
        reads.push({ address: args.address, functionName: args.functionName });
        const values: Record<string, bigint> = {
          minFeePerReceiver: 10_000_000_000_000n,
          maxFeeAmount: 20_000_000_000_000_000n,
          minFeeAmount: 0n,
        };
        return Promise.resolve(values[args.functionName] ?? 0n);
      },
    } as unknown as PublicClient;
    const gateway = createChainGateway({
      publicClient,
      relayer: { address: getAddress("0x000000000000000000000000000000000000be11") } as Relayer,
      chainId: 46_630,
      version: version as 5,
      factory: V5_FACTORY,
      implementation: DROP_V5,
      binderRegistry: REGISTRY,
    });
    return { gateway, reads };
  }

  it("minFeePerReceiver and maxFeeAmount come from the V5 factory, not zero", async () => {
    const { gateway, reads } = gatewayAt(5);
    expect(await gateway.minFeePerReceiver()).toBe(10_000_000_000_000n);
    expect(await gateway.maxFeeAmount()).toBe(20_000_000_000_000_000n);
    expect(reads).toEqual([
      { address: V5_FACTORY, functionName: "minFeePerReceiver" },
      { address: V5_FACTORY, functionName: "maxFeeAmount" },
    ]);
  });

  it("minFeeAmount comes from the V5 factory too", async () => {
    const { gateway, reads } = gatewayAt(5);
    expect(await gateway.minFeeAmount()).toBe(0n);
    expect(reads).toEqual([{ address: V5_FACTORY, functionName: "minFeeAmount" }]);
  });
});

describe("the relayer on version 5: the V3 createDrop", () => {
  it("sends the V3 selector to the V5 factory, ETH fee allowed", async () => {
    const sent: { to: Address; data: Hex }[] = [];
    const ok: ReceiptLike = {
      status: "success",
      transactionHash: `0x${"aa".repeat(32)}`,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [],
    };
    const factory = evmFactoryFor(LIVE);
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
      asset: getAddress("0x077aC8FfC52458C6BF08d427c5eB038bE3f06F03"),
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
      nativeFee: 1_500_000_000_000_000n,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(V5_FACTORY);
    expect(sent[0]?.data.slice(0, 10)).toBe(CREATE_DROP_V3_SELECTOR);
  });
});
