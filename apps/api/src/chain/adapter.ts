/**
 * One chain, one interface. Everything the create flow and the worker need, and nothing else.
 *
 * `evm/adapter.ts` wraps the existing `ChainGateway` and relayer with no change in behaviour.
 * `svm/adapter.ts` is the Solana implementation. The create flow, the worker and the routes only
 * ever see this interface, so they cannot tell the two apart — which is the whole point: one
 * product, two chains, chosen by the chain switch.
 *
 * Addresses are strings in the form their chain writes them: a checksummed `0x` address or a
 * base58 public key. `canonicalAddress` in `address.ts` is how they are stored. Amounts are
 * `bigint` base units: wei on an EVM chain, lamports on Solana. Transaction ids are strings: a
 * `0x` hash or a base58 signature.
 *
 * Refund, cancel and close are **capabilities**, not promises. The EVM relayer can refund since
 * cancel since, never close, so its adapter
 * reports `close: false` and the worker never asks. The Solana relayer reports all three.
 */
import type { Hex } from "viem";

import type { Receiver } from "@dropchad/shared";
import type { NativeFeeConfig } from "../drops/native-fee.js";

export type ChainFamily = "evm" | "svm";

export interface AdapterCapabilities {
  /** `refund` after the claim deadline. */
  readonly refund: boolean;
  /** `cancel_unfunded` after the funding deadline. The EVM since. */
  readonly cancelUnfunded: boolean;
  /** `close_drop`, Solana only. Returns the rent to the relayer. */
  readonly close: boolean;
  /** `claimHandle` / `claim_handle`. Solana waits for 16b. */
  readonly handleClaims: boolean;
}

/** What the chain must be told to make a drop. Family neutral: no asset, native only in v1. */
export interface RelayerCostShape {
  readonly addressLeaves: number;
  readonly handleLeaves: number;
  /** All leaves, for the Solana fit table, which depends on the proof depth. */
  readonly leafCount: number;
  /** A token drop: the EVM uses its token gas numbers. Solana ignores it. */
  readonly token?: boolean;
}

export interface RelayerCostEstimate {
  /** Base units of the native coin. */
  readonly cost: bigint;
  readonly unitPrice: bigint;
}

export interface AdapterCreateParams {
  readonly merkleRoot: Hex;
  readonly manifestHash: Hex;
  readonly totalEntitlements: bigint;
  readonly leafCount: number;
  readonly refundRecipient: string;
  readonly creatorCommitment: Hex;
  readonly nonce: bigint;
  readonly fundingPeriod: number;
  readonly claimPeriod: number;
  /**
   * A token drop, Solana only. Absent: a native drop. The mint and its
   * token program as the token check read them, and the SOL fee of.
   */
  readonly token?: {
    readonly mint: string;
    readonly tokenProgram: string;
    readonly solFeeLamports: bigint;
  };
}

/** The token half of a token drop's funding card . */
export interface TokenFunding {
  readonly mint: string;
  /** The drop's associated token account. Shown, since some wallets warn about a PDA. */
  readonly vault: string;
  readonly tokenProgram: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number;
  readonly amountBaseUnits: string;
  readonly amountDisplay: string;
  /** Solana Pay with `spl-token`, to the drop address. */
  readonly paymentUri: string;
}

/**
 * What the chain says it made, read back after the transaction.
 *
 * On the EVM this is the `DropCreated` event. On Solana it is the `Drop` account.
 * `create.ts` compares every field against what it sent, and only writes a row when they agree.
 */
export interface AdapterCreated {
  readonly txId: string;
  readonly drop: string;
  /** The family's native sentinel: `address(0)` or `Pubkey::default()`. */
  readonly asset: string;
  readonly merkleRoot: Hex;
  readonly manifestHash: Hex;
  readonly totalEntitlements: bigint;
  readonly leafCount: number;
  readonly refundRecipient: string;
  readonly feeAmount: bigint;
  readonly grossRequired: bigint;
  /** Unix seconds, absolute. */
  readonly fundingDeadline: bigint;
  readonly claimPeriod: number;
  /** Solana, 5.2: the vault, `Pubkey::default()` on a SOL drop. Absent on the EVM. */
  readonly vault?: string;
  /** Solana, 5.2 fields 20 and 21. Zero on a SOL drop, absent on the EVM. */
  readonly solFeeLamports?: bigint;
  readonly accountBudgetLamports?: bigint;
  /** The CREATE2 salt on an EVM chain, `null` on Solana where the PDA seeds are the commitment and nonce. */
  readonly salt: Hex | null;
}

export interface AdapterPrediction {
  readonly address: string;
  /** True when a drop already exists there, so the nonce must move on. */
  readonly taken: boolean;
}

/** `fundingStatus`. */
export interface FundingStatus {
  readonly funded: boolean;
  /** The drop's lamports above its rent minimum; on the EVM its ETH. On a token drop, that part. */
  readonly lamports: bigint;
  /** The vault's balance in the token's smallest unit; `null` on a SOL drop. */
  readonly tokenAmount: bigint | null;
}

/** The chain's own view of one drop. The numbers the worker acts on. */
export interface DropOnChain {
  /** / section 4: 0 Created, 1 Active, 2 Finalized, 3 Cancelled. */
  readonly status: number;
  /** Unix seconds, `0n` before activation. */
  readonly claimDeadline: bigint;
  readonly fundingDeadline: bigint;
  readonly totalClaimed: bigint;
  readonly claimedCount: number;
  /** Solana only. Always `false` on the EVM. */
  readonly closed: boolean;
}

/** `claimedSnapshot`, both halves from one `finalized` read. */
export interface ClaimedSnapshot {
  /** `claimed_count` on the `Drop` account. */
  readonly claimedCount: number;
  /** The leaf indexes the bitmap says are claimed, ascending. */
  readonly indexes: readonly number[];
  /** `Clock::unix_timestamp` in the same read: the chain's time, never the server's. */
  readonly unixTimestamp: bigint;
}

export interface AdapterClaimItem {
  readonly index: number;
  readonly recipient: string;
  readonly amount: bigint;
  readonly proof: readonly Hex[];
}

/** One leaf paid, as the chain reported it. The rain draws one bag per entry. */
export interface PaidClaim {
  readonly index: number;
  readonly recipient: string;
  readonly amount: bigint;
}

/** One handle claim to send. `signature` is the binding, stored at bind time. */
export interface AdapterHandleClaimItem {
  readonly index: number;
  readonly xId: bigint;
  readonly amount: bigint;
  readonly recipient: string;
  readonly proof: readonly Hex[];
  readonly signature: Hex;
}

export interface HandleClaimResult extends TxResult {
  /** From the `HandleClaimed` log, never from the request. `null` when the log is not there. */
  readonly paid: PaidClaim | null;
}

export interface TxResult {
  readonly txId: string;
  /** What the transaction cost the relayer, in base units. Fees, and on Solana rent too. */
  readonly cost: bigint;
}

export interface ClaimBatchResult extends TxResult {
  readonly paid: readonly PaidClaim[];
}

/** The funding card. The sender reads this and sends a plain transfer. */
export interface FundingInstructions {
  readonly family: ChainFamily;
  readonly address: string;
  readonly chainId: number;
  readonly asset: "native";
  readonly symbol: string;
  readonly decimals: number;
  readonly amountBaseUnits: string;
  /** The same number for a human, in whole coins. Display only, never used for a comparison. */
  readonly amountDisplay: string;
  /** EIP 681 on an EVM chain, Solana Pay on Solana. */
  readonly paymentUri: string;
  /** Unix seconds. After this the drop can only be cancelled and refunded. */
  readonly fundingDeadline: string;
  /**
   * Kept for the EVM shape the frontend already reads. On Solana they carry lamports and SOL,
   * the names are historical. Prefer `amountBaseUnits` and `amountDisplay`.
   */
  readonly amountWei: string;
  readonly amountEth: string;
  /**
   * A token drop only: the tokens to send. The fields above are then the SOL part, the
   * fee and the account budget, to the same address.
   */
  readonly token?: TokenFunding;
}

export interface ChainAdapter {
  readonly family: ChainFamily;
  /** The `packages/chains` key, `robinhood-testnet` or `solana-devnet`. Stored on every row. */
  readonly chainKey: string;
  /** The EVM chain id, or the leaf constant on Solana. The same number `buildDropTree` takes. */
  readonly chainId: number;
  readonly chainName: string;
  readonly nativeSymbol: string;
  readonly decimals: number;
  readonly relayerAddress: string;
  readonly nativeAsset: string;
  readonly capabilities: AdapterCapabilities;

  /** Throws when the text is not an address of this family. Returns the display form. */
  parseAddress(text: string): string;
  /** Dedupe, drop zeros, sort, and the family's own minimums. */
  normalizeReceivers(receivers: readonly Receiver<string>[]): Receiver<string>[];

  /**
   * The fee new drops get, in basis points, read from the chain now. For the
   * create page only; the drop's own `feeAmount` is what counts once it exists.
   */
  defaultFeeBps(): Promise<number>;
  /**
   * The flat minimum fee new native drops get, in base units, read from the chain now. The fee
   * is `max(minFee, total * bps / 10_000)`. Zero on `DropFactoryV1` and on a
   * `Config` that predates handle mode. For the create page only, like `defaultFeeBps`.
   */
  minFee(): Promise<bigint>;
  /**
   * Everything the fee of a new native drop is worked out from, read from the chain
   * now in one go, for `nativeDropFee`: the gas check, `GET /api/chains` and the read back.
   * The two fields are zero where the chain has none yet: `DropFactoryV3` and older, a
   * Solana `Config` from before the upgrade. A missing config is an error, never a zero.
   */
  feeConfig(): Promise<NativeFeeConfig>;
  /**
   * What the relayer will pay for a drop of this shape, now: `createDrop`,
   * `activate` and every claim, address leaves batched, handle leaves one per transaction.
   * `unitPrice` is the gas price in wei, or the lamports per transaction on Solana.
   */
  estimateRelayerCost(shape: RelayerCostShape): Promise<RelayerCostEstimate>;
  /**
   * EVM only: the drop's own `bindingDigest`, so the api checks what its binder signs
   * against the chain before signing. Solana has no view; the program rebuilds the message.
   */
  bindingDigest?: (drop: string, index: number, xId: bigint, recipient: string) => Promise<Hex>;
  /**
   * Whether a handle drop can be made on this chain now. EVM: `DropFactoryV2` is recorded in the
   * registry, `hasHandleContracts`. Solana: `Config` is migrated and holds a live binder. Handle
   * until true, a handle drop is refused with `503 handle_mode_not_ready`.
   */
  handleModeReady(): Promise<boolean>;
  predictDrop(creatorCommitment: Hex, nonce: bigint): Promise<AdapterPrediction>;
  createDrop(params: AdapterCreateParams): Promise<AdapterCreated>;
  /**
   * Solana only, token drops: the vault a drop must have, the associated token account
   * of the drop and the mint under the token program, and the rent of one receiver token
   * account of that program, read from the cluster.
   */
  tokenVault?: (drop: string, mint: string, tokenProgram: string) => string;
  tokenAccountRent?: (tokenProgram: string) => Promise<bigint>;

  /** What `activate` compares against `grossRequired`: the balance the drop can actually spend. */
  getSpendableBalance(drop: string): Promise<bigint>;
  /**
   * The program's own `activate` check, read from the chain and on the
   * EVM. A token drop needs both parts; a native drop the native check.
   */
  fundingStatus?(drop: string): Promise<FundingStatus>;
  /**
   * EVM only: the drop holds any ETH or any of its token. Without `close` an empty drop
   * gets no refund and no cancel, so this decides whether the worker sends one.
   */
  holdsAnything?(drop: string): Promise<boolean>;
  readDrop(drop: string): Promise<DropOnChain>;
  /**
   * Many drops at once, for the claim list. Solana reads them in
   * one call per 100. Absent on the EVM, which reads one by one. Throws when any drop is missing.
   */
  readDrops?(drops: readonly string[]): Promise<Map<string, DropOnChain>>;
  /**
   * Many waiting drops at once, for the funding poll: the same answer as
   * `fundingStatus` for each, in batched reads. `null` for a drop whose account is not there.
   * Absent on the EVM, whose watch jobs still read one drop each.
   */
  fundingStatuses?(drops: readonly string[]): Promise<Map<string, FundingStatus | null>>;
  /** Which of these leaf indexes are already claimed. One bitmap read on Solana, N calls on the EVM. */
  readClaimed(drop: string, indexes: readonly number[]): Promise<Set<number>>;
  /**
   * Solana only: the `Drop`, its bitmap and the Clock sysvar in one read
   * at `finalized`, so the settle job can copy the claimed leaves before `close_drop` deletes
   * the bitmap. `null` when the drop or its bitmap is gone. The EVM never closes a drop and has
   * none.
   */
  claimedSnapshot?: (drop: string) => Promise<ClaimedSnapshot | null>;
  /** How many claims fit in one send for a tree of this size. `MAX_BATCH` or the 6.5 fit table. */
  claimsPerTx(leafCount: number): number;

  activate(drop: string): Promise<TxResult>;
  claimBatch(drop: string, items: readonly AdapterClaimItem[]): Promise<ClaimBatchResult>;
  /** Only when `capabilities.handleClaims`. Otherwise `UnsupportedOnChainError`. */
  claimHandle(drop: string, item: AdapterHandleClaimItem): Promise<HandleClaimResult>;
  /** A binder that is set and not revoked, read now. Tells a paused claim from a failed one. */
  binderLive(): Promise<boolean>;
  /**
   * That binder itself, a checksummed address or base58, or `null` when none is live. Handle
   * compares it with our key, `src/binder/handle-mode.ts`.
   */
  liveBinder(): Promise<string | null>;
  /** Only when `capabilities` says so. Otherwise `UnsupportedOnChainError`. */
  refund(drop: string): Promise<TxResult>;
  cancelUnfunded(drop: string): Promise<TxResult>;
  closeDrop(drop: string): Promise<TxResult>;

  fundingInstructions(args: {
    readonly drop: string;
    readonly amount: bigint;
    readonly fundingDeadline: bigint;
    /** A token drop, Solana only. `amount` above is then the SOL part. */
    readonly token?: {
      readonly mint: string;
      readonly vault: string;
      readonly tokenProgram: string;
      readonly name: string | null;
      readonly symbol: string | null;
      readonly decimals: number;
      readonly amount: bigint;
    };
  }): FundingInstructions;
  txUrl(txId: string): string | null;
}

export class UnsupportedOnChainError extends Error {
  constructor(chainKey: string, what: string) {
    super(`${what} is not something the relayer can send on ${chainKey}`);
    this.name = "UnsupportedOnChainError";
  }
}

/** The adapters this process runs, one per configured chain. */
export interface ChainAdapters {
  get(chainKey: string): ChainAdapter | undefined;
  all(): readonly ChainAdapter[];
  /** The chain a request means when it names none. The EVM chain, for every existing caller. */
  readonly defaultKey: string;
}

export function singleAdapter(adapter: ChainAdapter): ChainAdapters {
  return {
    get: (key) => (key === adapter.chainKey ? adapter : undefined),
    all: () => [adapter],
    defaultKey: adapter.chainKey,
  };
}

export function adaptersFrom(list: readonly ChainAdapter[], defaultKey: string): ChainAdapters {
  const byKey = new Map(list.map((adapter) => [adapter.chainKey, adapter] as const));
  if (list.length > 0 && !byKey.has(defaultKey)) {
    throw new Error(`default chain ${defaultKey} is not among the configured adapters`);
  }
  return { get: (key) => byKey.get(key), all: () => list, defaultKey };
}
