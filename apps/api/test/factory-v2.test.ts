/**
 * - once `hasHandleContracts(chain)` is true, every EVM drop, both modes, is created on
 *   `DropFactoryV2` with `DropV2` clones; before that everything stays on V1
 * - the relayer's one factory, the gateway's factory and the CREATE2 prediction follow that pick
 * - `DropCreated` is read only from the factory in use, never from the other one
 * - `createDrop` and `DropCreated` are the same on both ABIs, so the relayer's call list is unchanged
 * - `minFee` for `GET /api/chains`: `minFeeAmount` on V2, zero on V1, `min_fee_lamports` on Solana
 */
import { getChain, getDeployedChain, type DeployedChain } from "@dropchad/chains";
import { dropFactoryV1Abi, dropFactoryV2Abi } from "@dropchad/shared";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  toEventSelector,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  DropCreatedMissingError,
  createChainGateway,
  decodeDropCreated,
} from "../src/chain/gateway.js";
import { computeSalt, predictDropAddress, unblindedCommitment } from "../src/chain/predict.js";
import { createRelayer, type ReceiptLike, type Relayer } from "../src/chain/relayer.js";
import { accountDiscriminator } from "../src/chain/svm/accounts.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { DROPCHAD_PROGRAM_ID } from "../src/chain/svm/pubkey.js";
import type { SvmRelayer } from "../src/chain/svm/relayer.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { evmFactoryFor } from "../src/chain/write-side.js";
import { FAKE_CHAIN_ID, FAKE_RELAYER, createFakeChain, evmAdapterFor } from "./fake-chain.js";

const FACTORY_V2 = getAddress("0x00000000000000000000000000000000000fac72");
const IMPLEMENTATION_V2 = getAddress("0x000000000000000000000000000000000000c102");
const REGISTRY = getAddress("0x00000000000000000000000000000000000b1d00");

const liveChain = getDeployedChain("robinhood-testnet");
/** The live entry with the V2 and V3 fields taken out: a chain before its handle mode deploy. */
const v1Chain: DeployedChain = {
  ...liveChain,
  contracts: {
    ...liveChain.contracts,
    factoryV2: null,
    implementationV2: null,
    binderRegistry: null,
    deployBlockV2: null,
    factoryV3: null,
    implementationV3: null,
    deployBlockV3: null,
    factoryV4: null,
    implementationV4: null,
    deployBlockV4: null,
  },
};
const v2Chain: DeployedChain = {
  ...v1Chain,
  contracts: {
    ...v1Chain.contracts,
    factoryV2: FACTORY_V2,
    implementationV2: IMPLEMENTATION_V2,
    binderRegistry: REGISTRY,
    deployBlockV2: 1,
  },
};

describe("which factory the EVM write side uses", () => {
  it("V1 while the V2 set is not recorded", () => {
    expect(evmFactoryFor(v1Chain)).toEqual({
      version: 1,
      factory: getAddress(v1Chain.contracts.factory),
      implementation: getAddress(v1Chain.contracts.implementation),
    });
  });

  it("the live robinhood testnet entry picks DropFactoryV4 and the same DropV3 since", () => {
    expect(evmFactoryFor(liveChain)).toEqual({
      version: 4,
      factory: getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4"),
      implementation: getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6"),
      binderRegistry: getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735"),
    });
  });

  it("V2 for both modes once hasHandleContracts is true", () => {
    expect(evmFactoryFor(v2Chain)).toEqual({
      version: 2,
      factory: FACTORY_V2,
      implementation: IMPLEMENTATION_V2,
      binderRegistry: REGISTRY,
    });
  });

  it("the relayer built on that pick sends createDrop to DropFactoryV2 and nowhere else", async () => {
    const sent: Address[] = [];
    const relayer = createRelayer({
      transport: {
        address: FAKE_RELAYER,
        pendingNonce: () => Promise.resolve(0),
        estimateGas: () => Promise.resolve(100_000n),
        maxFeePerGas: () => Promise.resolve(1n),
        send(tx) {
          sent.push(tx.to);
          const hash: Hex = `0x${"01".repeat(32)}`;
          return Promise.resolve(hash);
        },
        waitForReceipt: (hash) =>
          Promise.resolve({
            status: "success",
            transactionHash: hash,
            blockNumber: 1n,
            gasUsed: 1n,
            effectiveGasPrice: 1n,
            logs: [],
          }),
      },
      factory: evmFactoryFor(v2Chain).factory,
      isKnownDrop: () => Promise.resolve(false),
      gasBudget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      gasCaps: { createDrop: 2_000_000n, claimBatch: 3_000_000n, claimHandle: 300_000n },
    });
    await relayer.createDrop({
      asset: zeroAddress,
      merkleRoot: `0x${"11".repeat(32)}`,
      manifestHash: `0x${"22".repeat(32)}`,
      totalEntitlements: 1000n,
      leafCount: 1,
      refundRecipient: FAKE_RELAYER,
      creatorCommitment: `0x${"33".repeat(32)}`,
      nonce: 0n,
      fundingPeriod: 0,
      claimPeriod: 0,
      tokenFactory: zeroAddress,
    });
    expect(sent).toEqual([FACTORY_V2]);
  });
});

describe("the V1 and V2 factory ABIs agree where the relayer and the decoder look", () => {
  it("createDrop has one selector, so the relayer's fixed call list does not change", () => {
    expect(toFunctionSelector(getAbiItem({ abi: dropFactoryV2Abi, name: "createDrop" }))).toBe(
      toFunctionSelector(getAbiItem({ abi: dropFactoryV1Abi, name: "createDrop" })),
    );
  });

  it("DropCreated has one signature", () => {
    expect(toEventSelector(getAbiItem({ abi: dropFactoryV2Abi, name: "DropCreated" }))).toBe(
      toEventSelector(getAbiItem({ abi: dropFactoryV1Abi, name: "DropCreated" })),
    );
  });
});

describe("the CREATE2 prediction on DropFactoryV2", () => {
  it("uses the DropV2 clone init code hash and agrees with the factory's own predictDrop", async () => {
    const adapter = evmAdapterFor(
      createFakeChain({ factory: FACTORY_V2, implementation: IMPLEMENTATION_V2 }),
    );
    const commitment = unblindedCommitment(1234567890n, 0n);
    const prediction = await adapter.predictDrop(commitment, 0n);

    const salt = computeSalt({
      chainId: FAKE_CHAIN_ID,
      factory: FACTORY_V2,
      creator: FAKE_RELAYER,
      creatorCommitment: commitment,
      nonce: 0n,
    });
    expect(prediction).toEqual({
      address: predictDropAddress({ factory: FACTORY_V2, implementation: IMPLEMENTATION_V2, salt }),
      taken: false,
    });
    // A V1 clone at the same salt is another address: the implementation is in the hash.
    expect(prediction.address).not.toBe(
      predictDropAddress({
        factory: FACTORY_V2,
        implementation: v1Chain.contracts.implementation as Address,
        salt,
      }),
    );
  });

  it("creates at that address and reads the event back from DropFactoryV2", async () => {
    const fake = createFakeChain({ factory: FACTORY_V2, implementation: IMPLEMENTATION_V2 });
    const adapter = evmAdapterFor(fake);
    const commitment = unblindedCommitment(1234567890n, 0n);
    const prediction = await adapter.predictDrop(commitment, 0n);
    const created = await adapter.createDrop({
      merkleRoot: `0x${"11".repeat(32)}`,
      manifestHash: `0x${"22".repeat(32)}`,
      totalEntitlements: 1000n,
      leafCount: 1,
      refundRecipient: FAKE_RELAYER,
      creatorCommitment: commitment,
      nonce: 0n,
      fundingPeriod: 0,
      claimPeriod: 0,
    });
    expect(created.drop).toBe(prediction.address);
  });
});

describe("DropCreated is read only from the factory in use", () => {
  const dropCreated = getAbiItem({ abi: dropFactoryV2Abi, name: "DropCreated" });
  const drop = getAddress("0x00000000000000000000000000000000000d0001");
  const fields: Record<string, unknown> = {
    drop,
    creatorCommitment: `0x${"33".repeat(32)}`,
    asset: zeroAddress,
    merkleRoot: `0x${"11".repeat(32)}`,
    manifestHash: `0x${"22".repeat(32)}`,
    totalEntitlements: 1000n,
    feeAmount: 10n,
    grossRequired: 1010n,
    feeRecipient: zeroAddress,
    refundRecipient: FAKE_RELAYER,
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    leafCount: 1,
    implementation: IMPLEMENTATION_V2,
    salt: `0x${"44".repeat(32)}`,
    configHash: `0x${"55".repeat(32)}`,
  };
  const unindexed = dropCreated.inputs.filter((input) => input.indexed !== true);

  function receiptFrom(address: Address): ReceiptLike {
    const topics = encodeEventTopics({
      abi: [dropCreated],
      eventName: "DropCreated",
      args: {
        drop,
        creatorCommitment: fields.creatorCommitment as Hex,
        asset: zeroAddress,
      },
    }) as Hex[];
    const data = encodeAbiParameters(
      unindexed,
      unindexed.map((input) => fields[input.name as string]),
    );
    return {
      status: "success",
      transactionHash: `0x${"aa".repeat(32)}`,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [{ address, topics, data }],
    };
  }

  it("decodes a DropFactoryV2 log when the factory in use is V2", () => {
    const event = decodeDropCreated(receiptFrom(FACTORY_V2), FACTORY_V2, `0x${"aa".repeat(32)}`);
    expect(event.drop).toBe(drop);
    expect(event.implementation).toBe(IMPLEMENTATION_V2);
    expect(event.feeAmount).toBe(10n);
  });

  it("ignores the same event from the V1 factory address", () => {
    const v1Factory = getAddress(v1Chain.contracts.factory);
    expect(() =>
      decodeDropCreated(receiptFrom(v1Factory), FACTORY_V2, `0x${"aa".repeat(32)}`),
    ).toThrow(DropCreatedMissingError);
  });
});

describe("minFeeAmount on the gateway", () => {
  function gatewayWith(version: 1 | 2, answer: bigint) {
    const calls: { address: Address; functionName: string }[] = [];
    const publicClient = {
      readContract(args: { address: Address; functionName: string }) {
        calls.push({ address: args.address, functionName: args.functionName });
        return Promise.resolve(answer);
      },
    } as unknown as PublicClient;
    const gateway = createChainGateway({
      publicClient,
      relayer: { address: FAKE_RELAYER } as Relayer,
      chainId: FAKE_CHAIN_ID,
      version,
      factory: version === 2 ? FACTORY_V2 : getAddress(v1Chain.contracts.factory),
      implementation: IMPLEMENTATION_V2,
    });
    return { gateway, calls };
  }

  it("reads minFeeAmount from DropFactoryV2", async () => {
    const { gateway, calls } = gatewayWith(2, 100_000_000_000_000n);
    expect(await gateway.minFeeAmount()).toBe(100_000_000_000_000n);
    expect(calls).toEqual([{ address: FACTORY_V2, functionName: "minFeeAmount" }]);
  });

  it("is zero on DropFactoryV1 without a call: V1 has no minimum", async () => {
    const { gateway, calls } = gatewayWith(1, 5n);
    expect(await gateway.minFeeAmount()).toBe(0n);
    expect(calls).toEqual([]);
  });

  it("the EVM adapter passes it through as minFee", async () => {
    const adapter = evmAdapterFor(createFakeChain({ minFeeAmount: 7n }));
    expect(await adapter.minFee()).toBe(7n);
  });
});

describe("min_fee_lamports on Solana", () => {
  function adapterWithConfig(size: 116 | 253 | null, minFee = 0n) {
    let data: Uint8Array | null = null;
    if (size !== null) {
      data = new Uint8Array(size);
      data.set(accountDiscriminator("Config"), 0);
      data[104] = 100;
      if (size === 253) new DataView(data.buffer).setBigUint64(181, minFee, true);
    }
    const rpc = {
      getAccountInfo: () =>
        Promise.resolve(
          data === null
            ? null
            : { owner: DROPCHAD_PROGRAM_ID, lamports: 1n, data, executable: false },
        ),
    } as unknown as SvmRpc;
    return createSvmAdapter({
      rpc,
      relayer: {} as SvmRelayer,
      chain: getChain("solana-devnet") as ReturnType<typeof getChain> & { chainId: number },
    });
  }

  it("reads it from a migrated 253 byte Config", async () => {
    expect(await adapterWithConfig(253, 2_500_000n).minFee()).toBe(2_500_000n);
  });

  it("is zero on a 116 byte Config that predates handle mode", async () => {
    expect(await adapterWithConfig(116).minFee()).toBe(0n);
  });

  it("a missing Config is an error, never a zero", async () => {
    await expect(adapterWithConfig(null).minFee()).rejects.toThrow(/Config/);
  });
});
