/**
 * The relayer. The only thing in dropchad that holds a key and signs.
 *
 * **It can send exactly seven calls: `createDrop`, `activate`, `claim`, `claimBatch`, since
 * handle mode `claimHandle` (16a) and `refund` (16c), and since `cancelUnfunded`**,
 * `refund` pays only the refund address fixed at creation, after the claim
 * deadline; `cancelUnfunded` pays the same address, after the funding deadline, while the drop is
 * `Created`. There is no eighth method on this
 * interface and there is no generic `sendTransaction` exported from this
 * file, so there is no code path that could send a raw value transfer. and
 * section 6: the relayer holds gas money only and can never move drop funds.
 *
 * Four guards, all inside the one private `send`, so nothing can go around them:
 *
 * 1. **`value` is always `0n`.** It is not a parameter of anything here. A relayer that cannot
 *    attach value cannot move its own balance anywhere except into gas.
 * 2. **The selector must be one of the seven.** It is recomputed from the encoded calldata after
 *    encoding, not trusted from the caller, and checked against the selector for that kind.
 *    `createDrop` has the selector of the factory generation the registry names: the V1 and V2
 *    one, or since `DropFactoryV3` the V3 one with `nativeFee`.
 * 3. **The destination must be known.** `createDrop` may only go to the factory in the chain
 *    registry. The other six may only go to a drop address that exists in our own database,
 *    which means one we created and confirmed against a `DropCreated` event.
 * 4. **Gas cap and daily budget.** The estimate is refused above the per call cap, and the worst
 *    case cost is charged to the day's budget *before* the send, then corrected from the receipt.
 *
 * On top of that, one **nonce manager**: every send goes through a single serial queue, so two
 * concurrent requests can never take the same nonce. The nonce is read from the pending count
 * once and then tracked locally; any send failure drops it back to unknown so the next call
 * re-reads it from the chain.
 *
 * The transport is an interface, not a viem client, so the whole of this file is tested against a
 * fake chain. `src/chain/client.ts` holds the real implementation.
 *
 * **Nothing in this file logs, returns or stores a private key.** It never sees one: the key lives
 * in the transport, which is built from `RELAYER_PRIVATE_KEY` and exposes only an address.
 */
import { dropFactoryV1Abi, dropFactoryV3Abi, dropV1Abi, dropV2Abi } from "@dropchad/shared";
import {
  encodeFunctionData,
  getAbiItem,
  toFunctionSelector,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

/** The seven calls, and nothing else, ever. the design is the list; change it there first. */
export type RelayerCallKind =
  "createDrop" | "activate" | "claim" | "claimBatch" | "claimHandle" | "refund" | "cancelUnfunded";

/** `CreateParams`. */
export interface CreateDropParams {
  readonly asset: Address;
  readonly merkleRoot: Hex;
  readonly manifestHash: Hex;
  readonly totalEntitlements: bigint;
  readonly leafCount: number;
  readonly refundRecipient: Address;
  readonly creatorCommitment: Hex;
  readonly nonce: bigint;
  readonly fundingPeriod: number;
  readonly claimPeriod: number;
  readonly tokenFactory: Address;
  /**
   * `DropFactoryV3` only: the ETH fee of a token drop, in wei. A V1 or V2
   * factory has no such field, so a non zero fee there is refused, never dropped in silence.
   */
  readonly nativeFee?: bigint;
}

/** `ClaimItem`. */
export interface ClaimItem {
  readonly index: bigint;
  readonly recipient: Address;
  readonly amount: bigint;
  readonly proof: readonly Hex[];
}

/**
 * the arguments of `DropV2.claimHandle`. It pays `recipient`, the address
 * the binder signed for, never the caller: that is why it is safe to sponsor.
 */
export interface HandleClaimItem {
  readonly index: bigint;
  readonly xId: bigint;
  readonly amount: bigint;
  readonly recipient: Address;
  readonly proof: readonly Hex[];
  /** The binder's signature, 65 bytes. */
  readonly signature: Hex;
}

/** The three fields of a log that anything here reads. */
export interface ReceiptLogLike {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

/**
 * Only the parts of a receipt this code uses, so a fake chain does not have to invent the rest.
 *
 * A real viem `TransactionReceipt` satisfies it, which the assignment below pins at compile time.
 */
export interface ReceiptLike {
  readonly status: "success" | "reverted";
  readonly transactionHash: Hex;
  readonly blockNumber: bigint;
  readonly gasUsed: bigint;
  readonly effectiveGasPrice: bigint;
  readonly logs: readonly ReceiptLogLike[];
}

/** Compile time proof that the narrow shape above is a subset of viem's real receipt. */
export type ReceiptLikeCoversViem = TransactionReceipt extends ReceiptLike ? true : never;

export interface RelayerTransport {
  /** The relayer's own address. Public. */
  readonly address: Address;
  /** Transaction count at `pending`, so a queued transaction is counted. */
  pendingNonce(): Promise<number>;
  estimateGas(tx: { to: Address; data: Hex; value: bigint }): Promise<bigint>;
  /** The worst case price per gas this send could pay. Used for the budget reservation. */
  maxFeePerGas(): Promise<bigint>;
  send(tx: { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<ReceiptLike>;
}

/** The daily gas budget. `src/chain/gas-budget.ts` is the database backed implementation. */
export interface GasBudget {
  /** Charge the worst case cost. Throws `GasBudgetExceededError` when it would go over. */
  reserve(weiMax: bigint): Promise<void>;
  /** Correct the charge once the receipt gives the real cost. */
  settle(reservedWei: bigint, actualWei: bigint): Promise<void>;
}

export interface RelayerResult {
  readonly hash: Hex;
  readonly nonce: number;
  readonly gasLimit: bigint;
  readonly receipt: ReceiptLike;
  /** `gasUsed * effectiveGasPrice`. What this transaction really cost the relayer. */
  readonly costWei: bigint;
}

/** Called before and after every send, so every relayer transaction is on the record. */
export interface RelayerRecorder {
  onSent(tx: {
    hash: Hex;
    kind: RelayerCallKind;
    to: Address;
    dropAddress: Address | null;
    nonce: number;
    gasLimit: bigint;
  }): Promise<void>;
  onReceipt(tx: { hash: Hex; receipt: ReceiptLike; costWei: bigint }): Promise<void>;
}

export class RelayerRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayerRefusedError";
  }
}

export class GasCapExceededError extends Error {
  constructor(
    readonly kind: RelayerCallKind,
    readonly estimate: bigint,
    readonly cap: bigint,
  ) {
    super(`${kind} needs ${String(estimate)} gas, over the cap of ${String(cap)}`);
    this.name = "GasCapExceededError";
  }
}

export class GasBudgetExceededError extends Error {
  constructor(
    readonly wouldSpendWei: bigint,
    readonly limitWei: bigint,
    /** `wei` on an EVM chain, `lamports` on Solana. The message only. */
    unit = "wei",
  ) {
    super(
      `daily relayer gas budget exceeded: this send needs ${String(wouldSpendWei)} ${unit}, ` +
        `the limit for the day is ${String(limitWei)} ${unit}`,
    );
    this.name = "GasBudgetExceededError";
  }
}

export class TransactionRevertedError extends Error {
  constructor(
    readonly kind: RelayerCallKind,
    readonly hash: Hex,
  ) {
    super(`${kind} reverted on chain, tx ${hash}`);
    this.name = "TransactionRevertedError";
  }
}

/**
 * The seven selectors, computed from the ABIs at import time.
 *
 * Computed, never written by hand: a hand copied selector can drift away from the contract, and
 * this table is the allowlist that decides what the relayer is allowed to send.
 */
export const ALLOWED_SELECTORS: Readonly<Record<RelayerCallKind, Hex>> = {
  createDrop: toFunctionSelector(getAbiItem({ abi: dropFactoryV1Abi, name: "createDrop" })),
  activate: toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "activate" })),
  claim: toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "claim" })),
  claimBatch: toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "claimBatch" })),
  claimHandle: toFunctionSelector(getAbiItem({ abi: dropV2Abi, name: "claimHandle" })),
  // The same function on `DropV1` and `DropV2`; a test pins that.
  refund: toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "refund" })),
  // The same function on `DropV1`, `DropV2` and `DropV3`; a test pins V1 against V3.
  cancelUnfunded: toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "cancelUnfunded" })),
};

/** `createDrop` on `DropFactoryV3`: its `CreateParams` ends with `nativeFee`. */
export const CREATE_DROP_V3_SELECTOR: Hex = toFunctionSelector(
  getAbiItem({ abi: dropFactoryV3Abi, name: "createDrop" }),
);

export interface RelayerOptions {
  readonly transport: RelayerTransport;
  /** The factory from `packages/chains`. The only address `createDrop` may be sent to. */
  readonly factory: Address;
  /**
   * Its generation, `evmFactoryFor`. 1 and 2 share `createDrop`; 3 is `DropFactoryV3`, and 4
   * `DropFactoryV4` takes the same `createDrop`.
   * Absent means 1, as before V3.
   */
  readonly factoryVersion?: 1 | 2 | 3 | 4;
  /**
   * True when this address is a drop we created. `activate`, `claim` and `claimBatch` may go
   * nowhere else. Backed by our own `drops` table, so it can only ever be an address that came
   * out of a verified `DropCreated` event.
   */
  isKnownDrop(address: Address): Promise<boolean>;
  readonly gasBudget: GasBudget;
  readonly gasCaps: {
    readonly createDrop: bigint;
    readonly claimBatch: bigint;
    /** One handle claim, measured locally at about 79,000. Far under a batch. */
    readonly claimHandle: bigint;
  };
  readonly recorder?: RelayerRecorder;
}

export interface Relayer {
  readonly address: Address;
  createDrop(params: CreateDropParams): Promise<RelayerResult>;
  activate(drop: Address): Promise<RelayerResult>;
  claim(drop: Address, item: ClaimItem): Promise<RelayerResult>;
  claimBatch(drop: Address, items: readonly ClaimItem[]): Promise<RelayerResult>;
  claimHandle(drop: Address, item: HandleClaimItem): Promise<RelayerResult>;
  /** Everything left to `refundRecipient`, after the claim deadline. The contract checks. */
  refund(drop: Address): Promise<RelayerResult>;
  /**
   * Everything to `refundRecipient`, after the funding deadline, while `Created`.
   * The contract checks both; the worker sends it only to a drop that still holds something.
   */
  cancelUnfunded(drop: Address): Promise<RelayerResult>;
}

export function createRelayer(options: RelayerOptions): Relayer {
  const { transport, factory, gasBudget, gasCaps } = options;
  const factoryVersion = options.factoryVersion ?? 1;
  const createDropSelector =
    factoryVersion >= 3 ? CREATE_DROP_V3_SELECTOR : ALLOWED_SELECTORS.createDrop;

  /**
   * The nonce manager.
   *
   * `queue` serialises every send, so two HTTP requests cannot pick the same nonce. `next` is the
   * locally tracked nonce; `null` means "ask the chain". Any failure sets it back to `null`,
   * because a failed send may or may not have consumed the nonce and only the chain knows.
   */
  let queue: Promise<unknown> = Promise.resolve();
  let next: number | null = null;

  function serial<T>(task: () => Promise<T>): Promise<T> {
    // `then(task, task)` on purpose: one failed send must not wedge the queue for every later one.
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function takeNonce(): Promise<number> {
    if (next === null) next = await transport.pendingNonce();
    const nonce = next;
    next += 1;
    return nonce;
  }

  function capFor(kind: RelayerCallKind): bigint {
    // `activate` and a single `claim` are both far smaller than a full batch, so the batch cap is
    // a safe ceiling for them. `claimHandle` has its own, tighter one, and a `refund` or a
    // `cancelUnfunded`, about 60,000 gas each, shares it.
    if (kind === "createDrop") return gasCaps.createDrop;
    if (kind === "claimHandle" || kind === "refund" || kind === "cancelUnfunded") {
      return gasCaps.claimHandle;
    }
    return gasCaps.claimBatch;
  }

  async function send(call: {
    kind: RelayerCallKind;
    to: Address;
    data: Hex;
    dropAddress: Address | null;
  }): Promise<RelayerResult> {
    // --- guard 2: the selector must be the one for this kind ---------------------------------
    const selector = call.data.slice(0, 10).toLowerCase();
    const allowed = call.kind === "createDrop" ? createDropSelector : ALLOWED_SELECTORS[call.kind];
    if (selector !== allowed.toLowerCase()) {
      throw new RelayerRefusedError(
        `refusing to send: calldata selector ${selector} is not ${call.kind}`,
      );
    }

    // --- guard 3: the destination must be known ----------------------------------------------
    if (call.kind === "createDrop") {
      if (call.to.toLowerCase() !== factory.toLowerCase()) {
        throw new RelayerRefusedError(
          `refusing to send createDrop to ${call.to}, the factory is ${factory}`,
        );
      }
    } else if (!(await options.isKnownDrop(call.to))) {
      throw new RelayerRefusedError(
        `refusing to send ${call.kind} to ${call.to}: not a drop this api created`,
      );
    }

    // --- guard 1: value is always zero. It is not a parameter anywhere in this file. ----------
    const value = 0n;

    return serial(async () => {
      const estimate = await transport.estimateGas({ to: call.to, data: call.data, value });
      const cap = capFor(call.kind);
      if (estimate > cap) throw new GasCapExceededError(call.kind, estimate, cap);

      // 20% head room over the estimate, never above the cap. An estimate is a simulation against
      // the current state, and the state moves.
      const withHeadroom = estimate + estimate / 5n;
      const gas = withHeadroom > cap ? cap : withHeadroom;

      // --- guard 4: charge the worst case to the day's budget before sending ------------------
      const reserved = gas * (await transport.maxFeePerGas());
      await gasBudget.reserve(reserved);

      let hash: Hex;
      let nonce: number;
      try {
        nonce = await takeNonce();
        hash = await transport.send({ to: call.to, data: call.data, value, gas, nonce });
      } catch (error) {
        // The nonce may or may not have been consumed. Only the chain knows, so ask it next time.
        next = null;
        await gasBudget.settle(reserved, 0n);
        throw error;
      }

      await options.recorder?.onSent({
        hash,
        kind: call.kind,
        to: call.to,
        dropAddress: call.dropAddress,
        nonce,
        gasLimit: gas,
      });

      const receipt = await transport.waitForReceipt(hash);
      const costWei = receipt.gasUsed * receipt.effectiveGasPrice;
      await gasBudget.settle(reserved, costWei);
      await options.recorder?.onReceipt({ hash, receipt, costWei });

      // A reverted transaction still burned gas, so the budget is settled above before this throws.
      if (receipt.status !== "success") throw new TransactionRevertedError(call.kind, hash);

      return { hash, nonce, gasLimit: gas, receipt, costWei };
    });
  }

  return {
    address: transport.address,

    createDrop(params) {
      const fields = {
        asset: params.asset,
        merkleRoot: params.merkleRoot,
        manifestHash: params.manifestHash,
        totalEntitlements: params.totalEntitlements,
        leafCount: params.leafCount,
        refundRecipient: params.refundRecipient,
        creatorCommitment: params.creatorCommitment,
        nonce: params.nonce,
        fundingPeriod: params.fundingPeriod,
        claimPeriod: params.claimPeriod,
        tokenFactory: params.tokenFactory,
      };
      const nativeFee = params.nativeFee ?? 0n;
      if (factoryVersion < 3 && nativeFee !== 0n) {
        return Promise.reject(
          new RelayerRefusedError(
            `refusing to send createDrop with an ETH fee: factory ${factory} is V${String(factoryVersion)}, it has no nativeFee`,
          ),
        );
      }
      return send({
        kind: "createDrop",
        to: factory,
        dropAddress: null,
        data:
          factoryVersion >= 3
            ? encodeFunctionData({
                abi: dropFactoryV3Abi,
                functionName: "createDrop",
                args: [{ ...fields, nativeFee }],
              })
            : encodeFunctionData({
                abi: dropFactoryV1Abi,
                functionName: "createDrop",
                args: [fields],
              }),
      });
    },

    activate: (drop) =>
      send({
        kind: "activate",
        to: drop,
        dropAddress: drop,
        data: encodeFunctionData({ abi: dropV1Abi, functionName: "activate" }),
      }),

    claim: (drop, item) =>
      send({
        kind: "claim",
        to: drop,
        dropAddress: drop,
        data: encodeFunctionData({
          abi: dropV1Abi,
          functionName: "claim",
          args: [item.index, item.recipient, item.amount, [...item.proof]],
        }),
      }),

    claimBatch: (drop, items) =>
      send({
        kind: "claimBatch",
        to: drop,
        dropAddress: drop,
        data: encodeFunctionData({
          abi: dropV1Abi,
          functionName: "claimBatch",
          args: [
            items.map((item) => ({
              index: item.index,
              recipient: item.recipient,
              amount: item.amount,
              proof: [...item.proof],
            })),
          ],
        }),
      }),

    claimHandle: (drop, item) =>
      send({
        kind: "claimHandle",
        to: drop,
        dropAddress: drop,
        data: encodeFunctionData({
          abi: dropV2Abi,
          functionName: "claimHandle",
          args: [
            item.index,
            item.xId,
            item.amount,
            item.recipient,
            [...item.proof],
            item.signature,
          ],
        }),
      }),

    refund: (drop) =>
      send({
        kind: "refund",
        to: drop,
        dropAddress: drop,
        data: encodeFunctionData({ abi: dropV1Abi, functionName: "refund" }),
      }),

    cancelUnfunded: (drop) =>
      send({
        kind: "cancelUnfunded",
        to: drop,
        dropAddress: drop,
        data: encodeFunctionData({ abi: dropV1Abi, functionName: "cancelUnfunded" }),
      }),
  };
}
