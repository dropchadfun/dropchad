/**
 * the api picks `DropFactoryV4` once it is recorded.
 * - `evmFactoryFor`: V4 creates every new drop once `hasFeeModelContracts`, both modes and both
 *   assets, with the live `BinderRegistry`; the clones are the same `DropV3`. The relayer, the
 *   gateway and the CREATE2 prediction all take this one pick
 * - the token check reads `allowedToken` on the factory new drops are created on: V3, V4 once
 *   recorded, `evmTokenCheckFactory`
 * - while V4 is not recorded, both stay on V3. Robinhood testnet has V4 recorded;
 *   the other tests here put a made up V4 factory on top of it
 */
import { getChain, type DeployedChain } from "@dropchad/chains";
import type { Address, Hex } from "viem";
import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { CREATE_DROP_V3_SELECTOR, createRelayer, type ReceiptLike } from "../src/chain/relayer.js";
import { evmFactoryFor, evmTokenCheckFactory } from "../src/chain/write-side.js";

const LIVE = getChain("robinhood-testnet") as DeployedChain;
const V3_FACTORY = getAddress("0xeCD5E1d71dbE6072bb595209E9a19E0A3bBFB384");
/** The live V4. */
const V4_FACTORY = getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4");
const DROP_V3 = getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6");
const REGISTRY = getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");

const V4 = {
  factoryV4: "0x00000000000000000000000000000000000000f4",
  implementationV4: DROP_V3,
  deployBlockV4: 150_000_000,
};
const WITH_V4: DeployedChain = { ...LIVE, contracts: { ...LIVE.contracts, ...V4 } };

describe("evmFactoryFor with DropFactoryV4", () => {
  it("today: V4 on robinhood testnet, recorded since", () => {
    expect(evmFactoryFor(LIVE)).toEqual({
      version: 4,
      factory: V4_FACTORY,
      implementation: DROP_V3,
      binderRegistry: REGISTRY,
    });
  });

  it("V4 once recorded: the V4 factory, the same DropV3, the live registry", () => {
    expect(evmFactoryFor(WITH_V4)).toEqual({
      version: 4,
      factory: getAddress(V4.factoryV4),
      implementation: DROP_V3,
      binderRegistry: REGISTRY,
    });
  });

  it("not with a V4 field missing: V3 stays", () => {
    const partial = {
      ...LIVE,
      contracts: { ...LIVE.contracts, ...V4, deployBlockV4: null },
    } as DeployedChain;
    expect(evmFactoryFor(partial).version).toBe(3);
    expect(evmFactoryFor(partial).factory).toBe(V3_FACTORY);
  });
});

describe("evmTokenCheckFactory, the factory whose allowedToken the token check reads", () => {
  it("today: DropFactoryV4", () => {
    expect(evmTokenCheckFactory(LIVE)).toBe(V4_FACTORY);
  });

  it("DropFactoryV4 once recorded: its own allowlist, set", () => {
    expect(evmTokenCheckFactory(WITH_V4)).toBe(getAddress(V4.factoryV4));
  });

  it("null before V3: no Robinhood token drops", () => {
    const v2Only = {
      ...LIVE,
      contracts: {
        ...LIVE.contracts,
        factoryV3: null,
        implementationV3: null,
        deployBlockV3: null,
      },
    } as DeployedChain;
    expect(evmTokenCheckFactory(v2Only)).toBeNull();
  });
});

describe("the relayer on version 4: the V3 createDrop", () => {
  it("sends the V3 selector to the V4 factory, ETH fee allowed", async () => {
    const sent: { to: Address; data: Hex }[] = [];
    const ok: ReceiptLike = {
      status: "success",
      transactionHash: `0x${"aa".repeat(32)}`,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [],
    };
    const factory = evmFactoryFor(WITH_V4);
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

    // A token drop: its ETH fee goes in the V3 `createDrop`, which V1 and V2 refuse.
    await relayer.createDrop({
      asset: getAddress("0x00000000000000000000000000000000000007e5"),
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
    expect(sent[0]?.to).toBe(getAddress(V4.factoryV4));
    expect(sent[0]?.data.slice(0, 10)).toBe(CREATE_DROP_V3_SELECTOR);
  });
});
