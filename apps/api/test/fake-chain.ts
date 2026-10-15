/**
 * A fake chain: an in-memory `DropFactoryV1` that is right about the things the api depends on.
 *
 * It is deliberately **not** a mock that returns whatever the test wants. It recomputes the salt
 * and the CREATE2 address the same way the real factory does, and it builds a real `DropCreated`
 * event with `encodeEventTopics` and `encodeAbiParameters`, so the api's decoding, its address
 * prediction and its event checks are all exercised for real. A fake that just echoed the request
 * back would prove nothing about any of them.
 *
 * What it does not simulate: gas, reverts by rule, and the claim bitmap beyond a simple set.
 * Those belong to the anvil test and to the contract suite, which already has 222 of them.
 */
import {
  dropFactoryV1Abi,
  dropFactoryV3Abi,
  dropV1Abi,
  dropV2Abi,
  evmBindingDigest,
} from "@dropchad/shared";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import { getChain } from "@dropchad/chains";

import { singleAdapter, type ChainAdapter, type ChainAdapters } from "../src/chain/adapter.js";
import { createEvmAdapter } from "../src/chain/evm/adapter.js";
import { computeSalt, predictDropAddress } from "../src/chain/predict.js";
import type { ChainGateway, CreateDropOutcome } from "../src/chain/gateway.js";
import { TEST_EVM_BINDER_ADDRESS } from "./test-binders.js";
import type {
  ClaimItem,
  CreateDropParams,
  HandleClaimItem,
  ReceiptLike,
  RelayerResult,
} from "../src/chain/relayer.js";

export const FAKE_FACTORY = getAddress("0x00000000000000000000000000000000000fac70");
export const FAKE_IMPLEMENTATION = getAddress("0x000000000000000000000000000000000000c10e");
export const FAKE_RELAYER = getAddress("0x000000000000000000000000000000000000be11");
export const FAKE_CHAIN_ID = 46630;
export const FAKE_CHAIN_KEY = "robinhood-testnet";

/** The fake gateway behind the real EVM adapter, so the adapter code is what the tests run. */
export function evmAdapterFor(gateway: ChainGateway): ChainAdapter {
  return createEvmAdapter({ gateway, chain: getChain(FAKE_CHAIN_KEY) });
}

/**
 * The same, on the registry entry with the V2 fields taken out: a chain before its handle mode
 * deploy. the live robinhood testnet entry has them.
 */
export function evmAdapterV1OnlyFor(gateway: ChainGateway): ChainAdapter {
  const live = getChain(FAKE_CHAIN_KEY);
  return createEvmAdapter({
    gateway,
    chain: {
      ...live,
      contracts: {
        ...live.contracts,
        factoryV2: null,
        implementationV2: null,
        binderRegistry: null,
        deployBlockV2: null,
      },
    },
  });
}

/** One chain, the way `createWorker` and the harness take it. */
export function adaptersFor(gateway: ChainGateway): ChainAdapters {
  return singleAdapter(evmAdapterFor(gateway));
}

export interface FakeChainOptions {
  /** Salts the chain already knows about, so the api has to move its nonce along. */
  readonly usedSalts?: readonly Hex[];
  /** Basis points. v1 runs at zero, but the api must read it rather than assume it. */
  readonly defaultFeeBps?: number;
  /** Rewrite the event before it is emitted, to prove the api refuses a chain that disagrees. */
  readonly tamperEvent?: (event: Record<string, unknown>) => Record<string, unknown>;
  /** Make `createDrop` throw, for the error mapping tests. */
  readonly failCreate?: () => never;
  /** The factory and clone implementation, `DropFactoryV2` and `DropV2` in the tests. */
  readonly factory?: Address;
  readonly implementation?: Address;
  /** `minFeeAmount` in wei. Zero, like V1 and like V2 before `setMinFeeAmount`. */
  readonly minFeeAmount?: bigint;
  /**
   * `DropFactoryV4` only: `minFeePerReceiver` and `maxFeeAmount` in wei. A fake factory
   * of an older version ignores them, as the real one has no such fields.
   */
  readonly minFeePerReceiver?: bigint;
  readonly maxFeeAmount?: bigint;
  /** `eth_gasPrice` in wei for the estimate. Zero, so the older tests pay no gas. */
  readonly gasPrice?: bigint;
  /** Make `DropV2.bindingDigest` answer something else, to prove the api refuses to sign. */
  readonly tamperBindingDigest?: boolean;
  /**
   * The factory generation, 1 by default. 3 is `DropFactoryV3`: a token drop takes no
   * token fee and the factory emits `NativeFeeSet` after `DropCreated`. 4 is `DropFactoryV4`,
   * V3 plus the fee on native drops.
   */
  readonly version?: 1 | 2 | 3 | 4;
  /** Rewrite the ETH fee `NativeFeeSet` reports, to prove the api refuses a chain that disagrees. */
  readonly tamperNativeFee?: (nativeFee: bigint) => bigint;
}

export interface FakeChain extends ChainGateway {
  /** Every `createDrop` the api sent, in order. */
  readonly creates: CreateDropParams[];
  readonly activations: Address[];
  readonly batches: { drop: Address; items: readonly ClaimItem[] }[];
  setBalance(address: Address, wei: bigint): void;
  setClaimed(drop: Address, index: bigint): void;
  /** 0 Created, 1 Active, 2 Finalized, 3 Cancelled. */
  setStatus(drop: Address, status: number): void;
  setClaimDeadline(drop: Address, deadline: bigint): void;
  /** Make the next `claimBatch` that contains this index fail, like a recipient rejecting ETH. */
  failIndex(index: number): void;
  /** Every `claimHandle` the api sent, in order. */
  readonly handleClaims: { drop: Address; item: HandleClaimItem }[];
  /** Make `claimHandle` for this index revert with this message. */
  failHandleClaim(index: number, message: string): void;
  /** The `BinderRegistry` state: a binder that is set and not revoked. */
  setBinderLive(live: boolean): void;
  /** The binder address in the `BinderRegistry`. The test binder until a test moves it. */
  setBinderAddress(address: Address): void;
  /** Every `refund` the api sent, in order. */
  readonly refunds: Address[];
  /** Where a refund paid out: the drop's `refundRecipient`. */
  refundedTo(drop: Address): Address | undefined;
  /** Every `cancelUnfunded` the api sent, in order. */
  readonly cancels: Address[];
  /** An ERC20 balance: `balanceOf(holder)` on `token`. */
  setTokenBalance(token: Address, holder: Address, amount: bigint): void;
  /**
   * The drop's own views, for a drop a test seeds without `createDrop`: `asset`,
   * `grossRequired`, `nativeFee` (`DropV3`) and `fundingDeadline`. A created drop has them from
   * its `createDrop`; an unknown one reads native, zero, zero and zero.
   */
  setDropFields(
    drop: Address,
    fields: {
      asset?: Address;
      grossRequired?: bigint;
      nativeFee?: bigint;
      fundingDeadline?: bigint;
    },
  ): void;
}

const dropCreatedAbi = getAbiItem({ abi: dropFactoryV1Abi, name: "DropCreated" });
const nativeFeeSetAbi = getAbiItem({ abi: dropFactoryV3Abi, name: "NativeFeeSet" });
const claimedAbi = getAbiItem({ abi: dropV1Abi, name: "Claimed" });
const handleClaimedAbi = getAbiItem({ abi: dropV2Abi, name: "HandleClaimed" });

/** A real `HandleClaimed` log: index, xId and recipient indexed, the amount in data. */
function handleClaimedLog(drop: Address, item: HandleClaimItem): ReceiptLike["logs"][number] {
  return {
    address: drop,
    topics: encodeEventTopics({
      abi: [handleClaimedAbi],
      eventName: "HandleClaimed",
      args: { index: item.index, xId: item.xId, recipient: item.recipient },
    }) as Hex[],
    data: encodeAbiParameters([{ name: "amount", type: "uint256" }], [item.amount]),
  };
}

/**
 * A real `Claimed` log.
 *
 * The worker reads progress out of the receipt, not out of what it asked for, because
 * `claimBatch` silently skips an index somebody already claimed. So the fake has to emit
 * these properly or it would be testing nothing.
 */
function claimedLog(drop: Address, item: ClaimItem): ReceiptLike["logs"][number] {
  return {
    address: drop,
    topics: encodeEventTopics({
      abi: [claimedAbi],
      eventName: "Claimed",
      args: { index: item.index, recipient: item.recipient },
    }) as Hex[],
    data: encodeAbiParameters([{ name: "amount", type: "uint256" }], [item.amount]),
  };
}

let hashCounter = 0;
function nextHash(): Hex {
  hashCounter += 1;
  return `0x${hashCounter.toString(16).padStart(64, "0")}`;
}

function receipt(logs: ReceiptLike["logs"]): ReceiptLike {
  return {
    status: "success",
    transactionHash: nextHash(),
    blockNumber: 1n,
    gasUsed: 500_000n,
    effectiveGasPrice: 1_000_000n,
    logs,
  };
}

export function createFakeChain(options: FakeChainOptions = {}): FakeChain {
  const used = new Set((options.usedSalts ?? []).map((salt) => salt.toLowerCase()));
  const balances = new Map<string, bigint>();
  const claimed = new Set<string>();
  const statuses = new Map<string, number>();
  const deadlines = new Map<string, bigint>();
  const poison = new Set<number>();
  const feeBps = BigInt(options.defaultFeeBps ?? 0);
  const factory = options.factory ?? FAKE_FACTORY;
  const implementation = options.implementation ?? FAKE_IMPLEMENTATION;
  const version = options.version ?? 1;

  const creates: CreateDropParams[] = [];
  const activations: Address[] = [];
  const batches: { drop: Address; items: readonly ClaimItem[] }[] = [];
  const handleClaims: { drop: Address; item: HandleClaimItem }[] = [];
  const handleFailures = new Map<number, string>();
  let binderLive = true;
  let binderAddress: Address = getAddress(TEST_EVM_BINDER_ADDRESS);
  const refunds: Address[] = [];
  const cancels: Address[] = [];
  const refundedTo = new Map<string, Address>();
  const tokenBalances = new Map<string, bigint>();
  const tokenKey = (token: Address, holder: Address) =>
    `${token.toLowerCase()}:${holder.toLowerCase()}`;
  interface DropFields {
    asset: Address;
    grossRequired: bigint;
    nativeFee: bigint;
    fundingDeadline: bigint;
  }
  const dropFields = new Map<string, DropFields>();
  const fieldsOf = (drop: Address): DropFields =>
    dropFields.get(drop.toLowerCase()) ?? {
      asset: zeroAddress,
      grossRequired: 0n,
      nativeFee: 0n,
      fundingDeadline: 0n,
    };
  // cancel and refund send the token balance and then the whole ETH balance back.
  const emptyDrop = (drop: Address) => {
    balances.set(drop.toLowerCase(), 0n);
    const { asset } = fieldsOf(drop);
    if (asset !== zeroAddress) tokenBalances.set(tokenKey(asset, drop), 0n);
  };
  // pays the address fixed at creation. The fake keeps it from the `createDrop` it saw,
  // and falls back to the address every seeded test row uses.
  const refundRecipientOf = (drop: Address): Address =>
    getAddress(
      creates[createdAt.indexOf(drop.toLowerCase())]?.refundRecipient ??
        "0x000000000000000000000000000000000000dEaD",
    );
  const createdAt: string[] = [];

  function saltFor(commitment: Hex, nonce: bigint): Hex {
    return computeSalt({
      chainId: FAKE_CHAIN_ID,
      factory,
      creator: FAKE_RELAYER,
      creatorCommitment: commitment,
      nonce,
    });
  }

  return {
    chainId: FAKE_CHAIN_ID,
    version,
    factory,
    implementation,
    relayerAddress: FAKE_RELAYER,
    creates,
    activations,
    batches,
    handleClaims,
    refunds,
    refundedTo: (drop) => refundedTo.get(drop.toLowerCase()),

    // `DropV1.refund`: Active only, then Finalized, and the whole balance to the refund
    // address. The deadline is the worker's to check; the fake has no clock.
    refund(drop) {
      if ((statuses.get(drop.toLowerCase()) ?? 0) !== 1) {
        return Promise.reject(new Error("execution reverted: WrongStatus()"));
      }
      refunds.push(drop);
      refundedTo.set(drop.toLowerCase(), refundRecipientOf(drop));
      statuses.set(drop.toLowerCase(), 2);
      emptyDrop(drop);
      return Promise.resolve({
        hash: nextHash(),
        nonce: 0,
        gasLimit: 100_000n,
        receipt: receipt([]),
        costWei: 0n,
      });
    },
    cancels,
    // `DropV1.cancelUnfunded`: Created only, then Cancelled, everything to the
    // refund address. The funding deadline is the worker's to check; the fake has no clock.
    cancelUnfunded(drop) {
      if ((statuses.get(drop.toLowerCase()) ?? 0) !== 0) {
        return Promise.reject(new Error("execution reverted: WrongStatus()"));
      }
      cancels.push(drop);
      refundedTo.set(drop.toLowerCase(), refundRecipientOf(drop));
      statuses.set(drop.toLowerCase(), 3);
      emptyDrop(drop);
      return Promise.resolve({
        hash: nextHash(),
        nonce: 0,
        gasLimit: 100_000n,
        receipt: receipt([]),
        costWei: 0n,
      });
    },
    setTokenBalance(token, holder, amount) {
      tokenBalances.set(tokenKey(token, holder), amount);
    },
    setDropFields(drop, fields) {
      dropFields.set(drop.toLowerCase(), { ...fieldsOf(drop), ...fields });
    },
    tokenBalance: (token, holder) =>
      Promise.resolve(tokenBalances.get(tokenKey(token, holder)) ?? 0n),
    fundingDeadline: (drop) => Promise.resolve(fieldsOf(drop).fundingDeadline),
    dropAsset: (drop) => Promise.resolve(fieldsOf(drop).asset),
    grossRequired: (drop) => Promise.resolve(fieldsOf(drop).grossRequired),
    nativeFee: (drop) => Promise.resolve(fieldsOf(drop).nativeFee),

    failHandleClaim(index, message) {
      handleFailures.set(index, message);
    },
    setBinderLive(live) {
      binderLive = live;
    },
    setBinderAddress(address) {
      binderAddress = address;
    },
    binderLive: () => Promise.resolve(binderLive),
    liveBinder: () => Promise.resolve(binderLive ? binderAddress : null),

    // `DropV2.claimHandle`, as far as the api can tell from outside: the bit,
    // the binder, then the payout and its `HandleClaimed` log.
    claimHandle(drop, item) {
      const key = `${drop.toLowerCase()}:${item.index.toString()}`;
      if (claimed.has(key)) {
        return Promise.reject(new Error("execution reverted: AlreadyClaimed()"));
      }
      const failure = handleFailures.get(Number(item.index));
      if (failure !== undefined) return Promise.reject(new Error(failure));
      if (!binderLive) return Promise.reject(new Error("execution reverted: BinderIsRevoked()"));
      claimed.add(key);
      handleClaims.push({ drop, item });
      return Promise.resolve({
        hash: nextHash(),
        nonce: 0,
        gasLimit: 200_000n,
        receipt: receipt([handleClaimedLog(drop, item)]),
        costWei: 0n,
      });
    },

    setBalance(address, wei) {
      balances.set(address.toLowerCase(), wei);
    },
    setClaimed(drop, index) {
      claimed.add(`${drop.toLowerCase()}:${index.toString()}`);
    },
    setStatus(drop, status) {
      statuses.set(drop.toLowerCase(), status);
    },
    setClaimDeadline(drop, deadline) {
      deadlines.set(drop.toLowerCase(), deadline);
    },
    failIndex(index) {
      poison.add(index);
    },

    saltUsed: (salt) => Promise.resolve(used.has(salt.toLowerCase())),
    defaultFeeBps: () => Promise.resolve(Number(feeBps)),
    minFeeAmount: () => Promise.resolve(options.minFeeAmount ?? 0n),
    minFeePerReceiver: () =>
      Promise.resolve(version === 4 ? (options.minFeePerReceiver ?? 0n) : 0n),
    maxFeeAmount: () => Promise.resolve(version === 4 ? (options.maxFeeAmount ?? 0n) : 0n),
    gasPrice: () => Promise.resolve(options.gasPrice ?? 0n),
    // `DropV2.bindingDigest`: the same EIP 712 digest the shared code builds.
    bindingDigest: (drop, index, xId, recipient) =>
      Promise.resolve<Hex>(
        options.tamperBindingDigest === true
          ? `0x${"ee".repeat(32)}`
          : evmBindingDigest({ drop, chainId: FAKE_CHAIN_ID, index, xId, recipient }),
      ),
    predictDrop: (commitment, nonce) =>
      Promise.resolve(
        predictDropAddress({
          factory,
          implementation,
          salt: saltFor(commitment, nonce),
        }),
      ),
    getBalance: (address) => Promise.resolve(balances.get(address.toLowerCase()) ?? 0n),
    isClaimed: (drop, index) =>
      Promise.resolve(claimed.has(`${drop.toLowerCase()}:${index.toString()}`)),
    // A drop starts in `Created`, which is what a freshly created clone really is.
    dropStatus: (drop) => Promise.resolve(statuses.get(drop.toLowerCase()) ?? 0),
    claimDeadline: (drop) => Promise.resolve(deadlines.get(drop.toLowerCase()) ?? 0n),

    createDrop(params): Promise<CreateDropOutcome> {
      options.failCreate?.();
      creates.push(params);

      const salt = saltFor(params.creatorCommitment, params.nonce);
      used.add(salt.toLowerCase());
      const drop = predictDropAddress({
        factory,
        implementation,
        salt,
      });
      createdAt.push(drop.toLowerCase());

      // `max(minFeeAmount, total * bps / 10_000)`, the same sum `DropFactoryV2` does.
      // on `DropFactoryV3` a token drop never pays a percent of the token.
      // on `DropFactoryV4` also at least `minFeePerReceiver x leafCount`, at most
      // `maxFeeAmount`, zero being no cap. Written out here on its own, as the contract does it.
      const byBps = (params.totalEntitlements * feeBps) / 10_000n;
      const minFee = options.minFeeAmount ?? 0n;
      const tokenOnV3 = version >= 3 && params.asset !== zeroAddress;
      let feeAmount = tokenOnV3 ? 0n : byBps > minFee ? byBps : minFee;
      if (version === 4 && !tokenOnV3) {
        const perReceiver = (options.minFeePerReceiver ?? 0n) * BigInt(params.leafCount);
        if (feeAmount < perReceiver) feeAmount = perReceiver;
        const cap = options.maxFeeAmount ?? 0n;
        if (cap !== 0n && feeAmount > cap) feeAmount = cap;
      }
      const base: Record<string, unknown> = {
        drop,
        creatorCommitment: params.creatorCommitment,
        asset: params.asset,
        merkleRoot: params.merkleRoot,
        manifestHash: params.manifestHash,
        totalEntitlements: params.totalEntitlements,
        feeAmount,
        grossRequired: params.totalEntitlements + feeAmount,
        feeRecipient: zeroAddress,
        refundRecipient: params.refundRecipient,
        fundingDeadline: 1_800_000_000n,
        claimPeriod: params.claimPeriod,
        leafCount: params.leafCount,
        implementation,
        salt,
        configHash: `0x${"11".repeat(32)}`,
      };
      const fields = options.tamperEvent?.(base) ?? base;

      // A real log: three indexed topics plus the thirteen unindexed words, exactly as the
      // contract emits it with log4.
      // viem types `encodeEventTopics` for every indexed shape it could ever produce, including
      // the array form a dynamic indexed argument gets. `DropCreated` has three fixed size
      // indexed fields, so at runtime this is always four plain 32 byte topics.
      const topics = encodeEventTopics({
        abi: [dropCreatedAbi],
        eventName: "DropCreated",
        args: {
          drop: fields.drop as Address,
          creatorCommitment: fields.creatorCommitment as Hex,
          asset: fields.asset as Address,
        },
      }) as Hex[];
      const unindexed = dropCreatedAbi.inputs.filter((input) => input.indexed !== true);
      const data = encodeAbiParameters(
        unindexed,
        unindexed.map((input) => fields[input.name as string]),
      );

      dropFields.set(drop.toLowerCase(), {
        asset: getAddress(params.asset),
        grossRequired: params.totalEntitlements + feeAmount,
        nativeFee: tokenOnV3 ? (params.nativeFee ?? 0n) : 0n,
        fundingDeadline: 1_800_000_000n,
      });

      // `NativeFeeSet` right after `DropCreated`, on a V3 token drop only.
      const logs: ReceiptLike["logs"][number][] = [{ address: factory, topics, data }];
      let nativeFee: bigint | null = null;
      if (tokenOnV3) {
        nativeFee = options.tamperNativeFee?.(params.nativeFee ?? 0n) ?? params.nativeFee ?? 0n;
        logs.push({
          address: factory,
          topics: encodeEventTopics({
            abi: [nativeFeeSetAbi],
            eventName: "NativeFeeSet",
            args: { drop },
          }) as Hex[],
          data: encodeAbiParameters([{ name: "nativeFee", type: "uint256" }], [nativeFee]),
        });
      }

      const result: RelayerResult = {
        hash: nextHash(),
        nonce: creates.length - 1,
        gasLimit: 600_000n,
        receipt: receipt(logs),
        costWei: 500_000n * 1_000_000n,
      };
      return Promise.resolve({
        result,
        event: fields as unknown as CreateDropOutcome["event"],
        nativeFee,
      });
    },

    activate(drop) {
      activations.push(drop);
      statuses.set(drop.toLowerCase(), 1);
      return Promise.resolve({
        hash: nextHash(),
        nonce: 0,
        gasLimit: 200_000n,
        receipt: receipt([]),
        costWei: 0n,
      });
    },

    claim(drop, item) {
      if (poison.has(Number(item.index))) {
        return Promise.reject(
          new Error(`execution reverted: NativeTransferFailed on index ${item.index.toString()}`),
        );
      }
      const already = claimed.has(`${drop.toLowerCase()}:${item.index.toString()}`);
      claimed.add(`${drop.toLowerCase()}:${item.index.toString()}`);
      return Promise.resolve({
        hash: nextHash(),
        nonce: 0,
        gasLimit: 200_000n,
        receipt: receipt(already ? [] : [claimedLog(drop, item)]),
        costWei: 0n,
      });
    },

    claimBatch(drop, items) {
      batches.push({ drop, items });

      // one native send that fails reverts the whole batch. The real relayer sees this as
      // a failed gas estimate, before anything is signed.
      const bad = items.find((item) => poison.has(Number(item.index)));
      if (bad !== undefined) {
        return Promise.reject(
          new Error(`execution reverted: NativeTransferFailed on index ${bad.index.toString()}`),
        );
      }

      const paid = items.filter(
        (item) => !claimed.has(`${drop.toLowerCase()}:${item.index.toString()}`),
      );
      for (const item of paid) claimed.add(`${drop.toLowerCase()}:${item.index.toString()}`);

      return Promise.resolve({
        hash: nextHash(),
        nonce: 0,
        gasLimit: 800_000n,
        receipt: receipt(paid.map((item) => claimedLog(drop, item))),
        costWei: 0n,
      });
    },
  };
}
