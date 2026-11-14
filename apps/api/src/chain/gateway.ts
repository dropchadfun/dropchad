/**
 * Everything the api needs from the chain, behind one interface.
 *
 * Two reasons it exists rather than passing a viem client around:
 *
 * - **the routes and the worker can be tested against a fake chain**, without a node and without
 *   a key. `test/fake-chain.ts` implements this interface and nothing else.
 * - **there is one place that reads and one place that writes.** The write half is the relayer,
 *   which can only send its seven calls, and this file has no way to widen that.
 *
 * Reads are `eth_call` and `eth_getBalance` only. Nothing here signs.
 */
import {
  binderRegistryAbi,
  dropFactoryV1Abi,
  dropFactoryV2Abi,
  dropFactoryV3Abi,
  dropFactoryV4Abi,
  dropV1Abi,
  dropV2Abi,
  dropV7Abi,
  dropV3Abi,
} from "@dropchad/shared";
import {
  decodeEventLog,
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type {
  ClaimItem,
  CreateDropParams,
  HandleClaimItem,
  ReceiptLike,
  Relayer,
  RelayerResult,
} from "./relayer.js";

/** Sixteen fields, emitted with `log4`. */
export interface DropCreatedEvent {
  readonly drop: Address;
  readonly creatorCommitment: Hex;
  readonly asset: Address;
  readonly merkleRoot: Hex;
  readonly manifestHash: Hex;
  readonly totalEntitlements: bigint;
  readonly feeAmount: bigint;
  readonly grossRequired: bigint;
  readonly feeRecipient: Address;
  readonly refundRecipient: Address;
  readonly fundingDeadline: bigint;
  readonly claimPeriod: number;
  readonly leafCount: number;
  readonly implementation: Address;
  readonly salt: Hex;
  readonly configHash: Hex;
}

export interface CreateDropOutcome {
  readonly result: RelayerResult;
  readonly event: DropCreatedEvent;
  /** The factory's `NativeFeeSet`, on a V3 token drop only; `null` otherwise. */
  readonly nativeFee: bigint | null;
}

/** One `Claimed` log. The funds went to `recipient`, never to the caller. */
export interface ClaimedEvent {
  readonly index: number;
  readonly recipient: Address;
  readonly amount: bigint;
}

/**
 * The on chain state machine. The numbers are the `uint8` in storage.
 * `Finalized` and `Cancelled` are terminal.
 */
export const DROP_STATUS_CREATED = 0;
export const DROP_STATUS_ACTIVE = 1;
export const DROP_STATUS_FINALIZED = 2;
export const DROP_STATUS_CANCELLED = 3;

export interface ChainGateway {
  readonly chainId: number;
  /**
   * The factory generation new drops go to, `evmFactoryFor`: 1, 2, 3 for `DropFactoryV3`, or 4
   * for `DropFactoryV4`, V3 plus the fee, or 5 for `DropFactoryV5`, V4 plus the
   * refund check on chain, or 6 for `DropFactoryV6`, V5 plus the pause guardian
   * 7 for `DropFactoryV7`. Robinhood token drops exist on 3 to 7,
   */
  readonly version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly factory: Address;
  readonly implementation: Address;
  /** The relayer's address. It is `msg.sender` at creation, so it is part of the salt. */
  readonly relayerAddress: Address;

  /** A used salt means that address is taken and the nonce has to move on. */
  saltUsed(salt: Hex): Promise<boolean>;
  /** The factory's `paused`: new drops refused. For `GET /api/chains`. */
  factoryPaused(): Promise<boolean>;
  /** Read, never assumed: the fee is snapshotted into the drop at creation. */
  defaultFeeBps(): Promise<number>;
  /** `DropFactoryV2` only. Zero on `DropFactoryV1`, which has no minimum. */
  minFeeAmount(): Promise<bigint>;
  /** `DropFactoryV4` only. Zero, without a call, on every older factory. */
  minFeePerReceiver(): Promise<bigint>;
  /** `DropFactoryV4` only, zero is no cap. Zero, without a call, before V4. */
  maxFeeAmount(): Promise<bigint>;
  /** `eth_gasPrice`, for the estimate. */
  gasPrice(): Promise<bigint>;
  /** `DropV2.bindingDigest`: what the drop will check the binder's signature against. */
  bindingDigest(drop: Address, index: number, xId: bigint, recipient: Address): Promise<Hex>;
  /** `DropV7.bindingDigest` with `validUntil`.3. */
  bindingDigestV2?(
    drop: Address,
    index: number,
    xId: bigint,
    recipient: Address,
    validUntil: bigint,
  ): Promise<Hex>;
  /** The drop's own `implementation`, write-once.0. */
  implementationOf?(drop: Address): Promise<Address>;
  /** The latest block's `timestamp`, the chain's time of.4. */
  latestBlockTime?(): Promise<bigint>;
  /** The factory's own prediction, for cross checking ours. */
  predictDrop(creatorCommitment: Hex, nonce: bigint): Promise<Address>;
  getBalance(address: Address): Promise<bigint>;
  isClaimed(drop: Address, index: bigint): Promise<boolean>;
  /** as the `uint8` in storage. The constants above name the four values. */
  dropStatus(drop: Address): Promise<number>;
  /** Unix seconds, derived once at activation. `0` before that. */
  claimDeadline(drop: Address): Promise<bigint>;
  /** Unix seconds, set at creation. The worker's auto cancel waits for it. */
  fundingDeadline(drop: Address): Promise<bigint>;
  /** The drop's asset: `address(0)` for ETH, else the token. */
  dropAsset(drop: Address): Promise<Address>;
  /** what `activate` compares the token or ETH balance against. */
  grossRequired(drop: Address): Promise<bigint>;
  /** `DropV3.nativeFee`: the ETH fee of a token drop. Read on a `DropV3` only. */
  nativeFee(drop: Address): Promise<bigint>;
  /** ERC20 `balanceOf(holder)` on `token`. */
  tokenBalance(token: Address, holder: Address): Promise<bigint>;

  createDrop(params: CreateDropParams): Promise<CreateDropOutcome>;
  activate(drop: Address): Promise<RelayerResult>;
  claim(drop: Address, item: ClaimItem): Promise<RelayerResult>;
  claimBatch(drop: Address, items: readonly ClaimItem[]): Promise<RelayerResult>;
  /** The fifth relayer call. */
  claimHandle(drop: Address, item: HandleClaimItem): Promise<RelayerResult>;
  /**
   * A binder that is set and not revoked. False without a registry, so on V1. With a
   * drop, the registry that drop reads; without, the picked factory's.
   */
  binderLive(drop?: Address): Promise<boolean>;
  /** The binder in the registry when it is set and not revoked, else `null`. */
  liveBinder(drop?: Address): Promise<Address | null>;
  /** The sixth relayer call. */
  refund(drop: Address): Promise<RelayerResult>;
  /** The seventh relayer call. */
  cancelUnfunded(drop: Address): Promise<RelayerResult>;
}

export class DropCreatedMissingError extends Error {
  constructor(hash: Hex) {
    super(`createDrop tx ${hash} produced no DropCreated event from the factory`);
    this.name = "DropCreatedMissingError";
  }
}

/**
 * Pull `DropCreated` out of a receipt.
 *
 * Only logs from the factory address are considered. A `DropCreated` from anywhere else is some
 * other contract's event and is ignored — the same rule the indexer follows.
 */
export function decodeDropCreated(
  receipt: ReceiptLike,
  factory: Address,
  hash: Hex,
): DropCreatedEvent {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      // `DropCreated` is the same event on both factories, so the V2 ABI reads either.
      const decoded = decodeEventLog({
        abi: dropFactoryV2Abi,
        data: log.data,
        // viem wants the topic tuple shape. A log always has topic0 first when it has any topic
        // at all, and `decodeEventLog` throws on anything it cannot read, which the catch handles.
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "DropCreated") continue;
      return decoded.args;
    } catch {
      // Another event from the same contract. Not an error, just not this one.
      continue;
    }
  }
  throw new DropCreatedMissingError(hash);
}

/**
 * The ETH fee `DropFactoryV3` emitted for a token drop, `NativeFeeSet`, or `null` when the
 * receipt has none. Only logs from the factory address count, as for `DropCreated`.
 */
export function decodeNativeFeeSet(
  receipt: Pick<ReceiptLike, "logs">,
  factory: Address,
): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: dropFactoryV3Abi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "NativeFeeSet") return decoded.args.nativeFee;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Every `Claimed` log in a receipt, in order.
 *
 * This is where the live rain gets its data: the receipt already holds exactly which leaves were
 * paid, to whom and how much, so no extra call is needed. Only logs from the drop itself count.
 *
 * `claimBatch` silently skips an index somebody else already claimed, so the events are
 * the truth about what this transaction paid, and the batch we sent is not.
 */
export function decodeClaimed(receipt: ReceiptLike, drop: Address): ClaimedEvent[] {
  const claimed: ClaimedEvent[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== drop.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: dropV1Abi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Claimed") continue;
      const args = decoded.args;
      claimed.push({
        index: Number(args.index),
        recipient: args.recipient,
        amount: args.amount,
      });
    } catch {
      // Another event from the same drop, or one this ABI does not know. Not an error.
      continue;
    }
  }
  return claimed;
}

/** One `HandleClaimed` log. Paid to `recipient`, the address the binder signed for. */
export interface HandleClaimedEvent {
  readonly index: number;
  readonly xId: bigint;
  readonly recipient: Address;
  readonly amount: bigint;
}

/** Every `HandleClaimed` in a receipt, from the drop itself only. The twin of `decodeClaimed`. */
export function decodeHandleClaimed(receipt: ReceiptLike, drop: Address): HandleClaimedEvent[] {
  const claimed: HandleClaimedEvent[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== drop.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: dropV2Abi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "HandleClaimed") continue;
      claimed.push({
        index: Number(decoded.args.index),
        xId: decoded.args.xId,
        recipient: decoded.args.recipient,
        amount: decoded.args.amount,
      });
    } catch {
      continue;
    }
  }
  return claimed;
}

export interface ChainGatewayOptions {
  readonly publicClient: PublicClient;
  readonly relayer: Relayer;
  readonly chainId: number;
  /**
   * 1 for `DropFactoryV1` and `DropV1`, 2 for `DropFactoryV2` and `DropV2`, 3 for
   * `DropFactoryV3` and `DropV3`, 4 for `DropFactoryV4`, 5 for `DropFactoryV5` and
   * `DropV5`  for `DropFactoryV6` and `DropV6`  for `DropFactoryV7` and
   * `DropV7`.
   */
  readonly version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly factory: Address;
  readonly implementation: Address;
  /** From V2 on: the registry of the drops the picked factory makes. */
  readonly binderRegistry?: Address | undefined;
  /**
   * Every registry a drop on this chain may read, `evmBinderRegistries`. A
   * drop's own `BINDER_REGISTRY()` outside this list is `UnknownBinderRegistryError`.
   */
  readonly binderRegistries?: readonly Address[] | undefined;
}

/** A drop reads a registry that is not one of the chain's. Nothing is read from it. */
export class UnknownBinderRegistryError extends Error {
  constructor(drop: Address, registry: Address) {
    super(`drop ${drop} reads registry ${registry}, which is not one of this chain's`);
    this.name = "UnknownBinderRegistryError";
  }
}

export function createChainGateway(options: ChainGatewayOptions): ChainGateway {
  const { publicClient, relayer } = options;
  const factory = getAddress(options.factory);
  const known = new Set((options.binderRegistries ?? []).map((registry) => getAddress(registry)));
  /** A drop's `BINDER_REGISTRY` is immutable, so one read per drop, kept. */
  const registryOfDrop = new Map<Address, Address>();

  /** The registry to read: the drop's own, checked against `known`, or the picked factory's. */
  async function registryFor(drop: Address | undefined): Promise<Address | undefined> {
    if (drop === undefined) return options.binderRegistry;
    const key = getAddress(drop);
    let registry = registryOfDrop.get(key);
    if (registry === undefined) {
      registry = getAddress(
        await publicClient.readContract({
          address: key,
          abi: dropV2Abi,
          functionName: "BINDER_REGISTRY",
        }),
      );
      registryOfDrop.set(key, registry);
    }
    if (!known.has(registry)) throw new UnknownBinderRegistryError(key, registry);
    return registry;
  }

  async function binderState(drop: Address | undefined) {
    const registry = await registryFor(drop);
    if (registry === undefined) return null;
    const [binder, revoked] = await publicClient.readContract({
      address: registry,
      abi: binderRegistryAbi,
      functionName: "binderState",
    });
    return { binder, revoked };
  }

  return {
    chainId: options.chainId,
    version: options.version,
    factory,
    implementation: getAddress(options.implementation),
    relayerAddress: relayer.address,

    saltUsed: (salt) =>
      publicClient.readContract({
        address: factory,
        abi: dropFactoryV1Abi,
        functionName: "saltUsed",
        args: [salt],
      }),

    factoryPaused: () =>
      publicClient.readContract({
        address: factory,
        abi: dropFactoryV1Abi,
        functionName: "paused",
      }),

    async defaultFeeBps() {
      return Number(
        await publicClient.readContract({
          address: factory,
          abi: dropFactoryV1Abi,
          functionName: "defaultFeeBps",
        }),
      );
    },

    async minFeeAmount() {
      if (options.version === 1) return 0n;
      return publicClient.readContract({
        address: factory,
        abi: dropFactoryV2Abi,
        functionName: "minFeeAmount",
      });
    },

    async minFeePerReceiver() {
      // `DropFactoryV4` and `DropFactoryV5` carry it.
      if (options.version < 4) return 0n;
      return publicClient.readContract({
        address: factory,
        abi: dropFactoryV4Abi,
        functionName: "minFeePerReceiver",
      });
    },

    async maxFeeAmount() {
      if (options.version < 4) return 0n;
      return publicClient.readContract({
        address: factory,
        abi: dropFactoryV4Abi,
        functionName: "maxFeeAmount",
      });
    },

    gasPrice: () => publicClient.getGasPrice(),

    bindingDigest: (drop, index, xId, recipient) =>
      publicClient.readContract({
        address: drop,
        abi: dropV2Abi,
        functionName: "bindingDigest",
        args: [BigInt(index), xId, recipient],
      }),

    bindingDigestV2: (drop, index, xId, recipient, validUntil) =>
      publicClient.readContract({
        address: drop,
        abi: dropV7Abi,
        functionName: "bindingDigest",
        args: [BigInt(index), xId, recipient, validUntil],
      }),

    implementationOf: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV1Abi, functionName: "implementation" }),

    latestBlockTime: async () => (await publicClient.getBlock({ blockTag: "latest" })).timestamp,

    predictDrop: (creatorCommitment, nonce) =>
      publicClient.readContract({
        address: factory,
        abi: dropFactoryV1Abi,
        functionName: "predictDrop",
        args: [relayer.address, creatorCommitment, nonce],
      }),

    getBalance: (address) => publicClient.getBalance({ address }),

    isClaimed: (drop, index) =>
      publicClient.readContract({
        address: drop,
        abi: dropV1Abi,
        functionName: "isClaimed",
        args: [index],
      }),

    dropStatus: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV1Abi, functionName: "status" }),

    claimDeadline: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV1Abi, functionName: "claimDeadline" }),

    fundingDeadline: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV1Abi, functionName: "fundingDeadline" }),

    dropAsset: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV1Abi, functionName: "asset" }),

    grossRequired: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV1Abi, functionName: "grossRequired" }),

    nativeFee: (drop) =>
      publicClient.readContract({ address: drop, abi: dropV3Abi, functionName: "nativeFee" }),

    tokenBalance: (token, holder) =>
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [holder],
      }),

    async createDrop(params) {
      const result = await relayer.createDrop(params);
      const event = decodeDropCreated(result.receipt, factory, result.hash);
      return { result, event, nativeFee: decodeNativeFeeSet(result.receipt, factory) };
    },

    activate: (drop) => relayer.activate(drop),
    claim: (drop, item) => relayer.claim(drop, item),
    claimBatch: (drop, items) => relayer.claimBatch(drop, items),
    claimHandle: (drop, item) => relayer.claimHandle(drop, item),
    refund: (drop) => relayer.refund(drop),
    cancelUnfunded: (drop) => relayer.cancelUnfunded(drop),

    async binderLive(drop) {
      const state = await binderState(drop);
      if (state === null) return false;
      return state.binder !== "0x0000000000000000000000000000000000000000" && !state.revoked;
    },

    async liveBinder(drop) {
      const state = await binderState(drop);
      if (state === null) return null;
      if (state.binder === "0x0000000000000000000000000000000000000000" || state.revoked) {
        return null;
      }
      return getAddress(state.binder);
    },
  };
}
