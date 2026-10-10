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
  /** the factory's `NativeFeeSet`, on a V3 token drop only; `null` otherwise. */
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
   * for `DropFactoryV4`, V3 plus the fee. Robinhood token drops exist on 3 and 4,
   */
  readonly version: 1 | 2 | 3 | 4;
  readonly factory: Address;
  readonly implementation: Address;
  /** The relayer's address. It is `msg.sender` at creation, so it is part of the salt. */
  readonly relayerAddress: Address;

  /** A used salt means that address is taken and the nonce has to move on. */
  saltUsed(salt: Hex): Promise<boolean>;
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
  /** the fifth relayer call. */
  claimHandle(drop: Address, item: HandleClaimItem): Promise<RelayerResult>;
  /** a binder that is set and not revoked. False without a registry, so on V1. */
  binderLive(): Promise<boolean>;
  /** The binder in the registry when it is set and not revoked, else `null`. */
  liveBinder(): Promise<Address | null>;
  /** the sixth relayer call. */
  refund(drop: Address): Promise<RelayerResult>;
  /** the seventh relayer call. */
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
 * the ETH fee `DropFactoryV3` emitted for a token drop, `NativeFeeSet`, or `null` when the
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
   * 1 for `DropFactoryV1` and `DropV1`, 2 for `DropFactoryV2` and `DropV2`  for
   * `DropFactoryV3` and `DropV3`.
   */
  readonly version: 1 | 2 | 3 | 4;
  readonly factory: Address;
  readonly implementation: Address;
  /** with V2 only. */
  readonly binderRegistry?: Address | undefined;
}

export function createChainGateway(options: ChainGatewayOptions): ChainGateway {
  const { publicClient, relayer } = options;
  const factory = getAddress(options.factory);

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
      if (options.version !== 4) return 0n;
      return publicClient.readContract({
        address: factory,
        abi: dropFactoryV4Abi,
        functionName: "minFeePerReceiver",
      });
    },

    async maxFeeAmount() {
      if (options.version !== 4) return 0n;
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

    async binderLive() {
      if (options.binderRegistry === undefined) return false;
      const [binder, revoked] = await publicClient.readContract({
        address: options.binderRegistry,
        abi: binderRegistryAbi,
        functionName: "binderState",
      });
      return binder !== "0x0000000000000000000000000000000000000000" && !revoked;
    },

    async liveBinder() {
      if (options.binderRegistry === undefined) return null;
      const [binder, revoked] = await publicClient.readContract({
        address: options.binderRegistry,
        abi: binderRegistryAbi,
        functionName: "binderState",
      });
      if (binder === "0x0000000000000000000000000000000000000000" || revoked) return null;
      return getAddress(binder);
    },
  };
}
