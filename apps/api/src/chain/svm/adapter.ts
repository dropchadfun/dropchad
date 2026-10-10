/**
 * Solana behind the `ChainAdapter` interface. the design is the rule book; the section numbers
 * are next to each method.
 *
 * What is different from the EVM adapter, and why:
 *
 * - **Prediction is a PDA, and "taken" is "the account exists."** There is no salt and no factory
 *   to agree with: the address is `find_program_address(["drop", commitment, nonce])`, and only
 *   our program can create an account there. The EVM's `saltUsed` becomes one
 *   `getAccountInfo`.
 * - **The read back is the account, not an event.** After `create_drop` confirms, the `Drop`
 *   account is fetched and decoded with the owner and discriminator checks, and the
 *   create flow compares every field the way it compares `DropCreated`.
 * - **The spendable balance is lamports minus the rent minimum**. The rent floor is
 *   never spendable and `activate` compares against the difference.
 * - **A batch is N `claim` instructions in one transaction**, sized by the 6.5 fit table, and the
 *   bitmap is read first so an already claimed leaf is never sent.
 * - **Refund, cancel and close exist here.**. The rent comes back to the
 *   relayer, which is why the admin added the two settle instructions to the allowlist.
 *
 * Token drops since: `create_drop` takes the mint, the
 * vault, the token program and the ATA program, and the read back carries the vault, the SOL fee
 * and the account budget. Activation and claims of token drops are.
 */
import { explorerTxUrl, type Chain } from "@dropchad/chains";
import {
  MIN_SOL_LEAF_LAMPORTS,
  base58Encode,
  ed25519InstructionData,
  normalizeSvmReceivers,
  svmBindingMessage,
  type Receiver,
} from "@dropchad/shared";
import { bytesToHex, hexToBytes } from "viem";

import type {
  AdapterClaimItem,
  AdapterCreated,
  ChainAdapter,
  ClaimBatchResult,
  ClaimedSnapshot,
  DropOnChain,
  FundingInstructions,
  FundingStatus,
  TxResult,
} from "../adapter.js";
import {
  DROP_ACCOUNT_BYTES_HANDLE,
  decodeClaimBitmap,
  decodeClaimedEvents,
  decodeClockUnixTimestamp,
  decodeConfig,
  decodeDrop,
  decodeHandleClaimedEvents,
  isClaimedBit,
  type DropAccount,
} from "./accounts.js";
import { associatedTokenAddress, bitmapPda, configPda, dropPda, tokenAccountBytes } from "./pda.js";
import {
  CLOCK_SYSVAR_ID,
  DEFAULT_PUBKEY_BASE58,
  isPubkey,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "./pubkey.js";
import type { DropToken } from "./instructions.js";
import type { SvmRelayer } from "./relayer.js";
import type { AccountInfo, Commitment, SvmRpc } from "./rpc.js";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const SOL_DECIMALS = 9;

/** Whole SOL as a decimal string, no trailing zeros. Display only. */
export function formatLamports(lamports: bigint): string {
  return formatUnits(lamports, SOL_DECIMALS);
}

/** Base units as whole coins of `decimals`, no trailing zeros. Display only. */
export function formatUnits(amount: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = amount / unit;
  const frac =
    decimals === 0 ? "" : (amount % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
}

/**
 * the SOL column. How many `claim` instructions fit in one legacy transaction
 * for a tree of this depth. Measured, not derived; the table is the truth and the
 * transaction builder throws `TransactionTooLargeError` if it is ever wrong.
 */
export function solClaimsPerTx(leafCount: number): number {
  const depth = leafCount <= 1 ? 0 : Math.ceil(Math.log2(leafCount));
  if (depth <= 1) return 9;
  if (depth === 2) return 7;
  if (depth === 3) return 5;
  if (depth <= 5) return 4;
  if (depth <= 7) return 3;
  if (depth <= 12) return 2;
  return 1;
}

export class DropAccountMissingError extends Error {
  constructor(signature: string, drop: string) {
    super(`create_drop ${signature} confirmed but the drop account ${drop} could not be read back`);
    this.name = "DropAccountMissingError";
  }
}

export class DropAccountMissingOnChainError extends Error {
  constructor(drop: string) {
    super(`no drop account at ${drop}`);
    this.name = "DropAccountMissingOnChainError";
  }
}

export interface SvmAdapterOptions {
  readonly rpc: SvmRpc;
  readonly relayer: SvmRelayer;
  /** The `solana-devnet` or `solana` registry entry. `chainId` is the leaf constant. */
  readonly chain: Chain & { readonly chainId: number };
  readonly commitment?: Commitment;
  /** The relayer's own caps, so the estimate prices a transaction the way it sends one. */
  readonly feeModel?: {
    readonly priorityFeeMicroLamports: bigint;
    readonly maxComputeUnits: number;
  };
}

/** The base fee of a one signature transaction, measured. */
export const SOLANA_BASE_FEE_LAMPORTS = 5_000n;

/** 0.001 SOL, the step a token drop's SOL part is rounded up. */
const MILLI_SOL = 1_000_000n;

export function createSvmAdapter(options: SvmAdapterOptions): ChainAdapter {
  const { rpc, relayer, chain } = options;
  const commitment = options.commitment ?? "confirmed";
  let rentMinimum: bigint | null = null;

  // Every drop the program creates since handle mode is 424 bytes. The 360 byte drops
  // made before it are unreadable anyway, so one rent minimum fits every drop we serve.
  async function dropRentMinimum(): Promise<bigint> {
    if (rentMinimum === null)
      rentMinimum = await rpc.getMinimumBalanceForRentExemption(DROP_ACCOUNT_BYTES_HANDLE);
    return rentMinimum;
  }

  /**
   * from the drop's lamports and, on a token drop, its vault (`undefined` on a
   * SOL drop, `null` when the vault is not there yet).
   */
  function statusOf(
    account: DropAccount,
    dropLamports: bigint,
    minimum: bigint,
    vaultInfo: AccountInfo | null | undefined,
  ): FundingStatus {
    const lamports = dropLamports > minimum ? dropLamports - minimum : 0n;
    if (vaultInfo === undefined) {
      return { funded: lamports >= account.grossRequired, lamports, tokenAmount: null };
    }
    // The amount sits at byte 64 in both token programs' account layout.
    const tokenAmount =
      vaultInfo === null || vaultInfo.data.length < 72
        ? 0n
        : new DataView(vaultInfo.data.buffer, vaultInfo.data.byteOffset).getBigUint64(64, true);
    return {
      funded:
        tokenAmount >= account.totalEntitlements &&
        lamports >= account.solFeeLamports + account.accountBudgetLamports,
      lamports,
      tokenAmount,
    };
  }

  function onChainOf(account: DropAccount): DropOnChain {
    return {
      status: account.status,
      claimDeadline: account.claimDeadline,
      fundingDeadline: account.fundingDeadline,
      totalClaimed: account.totalClaimed,
      claimedCount: account.claimedCount,
      closed: account.closed,
    };
  }

  async function loadDrop(drop: Pubkey): Promise<DropAccount> {
    const info = await rpc.getAccountInfo(drop, commitment);
    if (info === null) throw new DropAccountMissingOnChainError(pubkeyToBase58(drop));
    return decodeDrop(info);
  }

  /**
   * a token drop's mint, vault and token program, `undefined` on a SOL drop. The token
   * program is the mint account's, read now; the program checks all three again.
   */
  async function tokenOf(account: DropAccount): Promise<DropToken | undefined> {
    if (account.asset.every((byte) => byte === 0)) return undefined;
    const mint = await rpc.getAccountInfo(account.asset, commitment);
    if (mint === null) throw new Error(`the mint ${pubkeyToBase58(account.asset)} is gone`);
    return { mint: account.asset, vault: account.vault, tokenProgram: mint.owner };
  }

  const withToken = (token: DropToken | undefined) => (token === undefined ? {} : { token });

  const parseAddress = (text: string): string => {
    if (!isPubkey(text)) throw new Error(`not a Solana public key: ${text}`);
    // Decode and re-encode: one set of 32 bytes has exactly one base58 spelling.
    return pubkeyToBase58(pubkeyFromBase58(text));
  };

  const toResult = (r: { signature: string; relayerSpent: bigint }): TxResult => ({
    txId: r.signature,
    cost: r.relayerSpent,
  });

  return {
    family: "svm",
    chainKey: chain.key,
    chainId: chain.chainId,
    chainName: chain.name,
    nativeSymbol: chain.nativeSymbol,
    decimals: SOL_DECIMALS,
    relayerAddress: relayer.address,
    nativeAsset: DEFAULT_PUBKEY_BASE58,
    capabilities: { refund: true, cancelUnfunded: true, close: true, handleClaims: true },

    parseAddress,

    /** plus the rent floor: a SOL leaf under 890,880 lamports would fail on chain. */
    normalizeReceivers(receivers): Receiver<string>[] {
      const normalized = normalizeSvmReceivers(
        receivers.map((r) => ({ recipient: parseAddress(r.recipient), amount: r.amount })),
      );
      for (const receiver of normalized) {
        if (receiver.amount < MIN_SOL_LEAF_LAMPORTS) {
          throw new Error(
            `${receiver.recipient} would receive ${receiver.amount.toString()} lamports, under the ` +
              `${MIN_SOL_LEAF_LAMPORTS.toString()} lamport minimum a fresh wallet can hold.`,
          );
        }
      }
      return normalized;
    },

    /** `config.default_fee_bps`. A missing config is an error, never a zero. */
    async defaultFeeBps() {
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) throw new Error("no Config account on this cluster");
      return decodeConfig(info).defaultFeeBps;
    },

    /** `config.min_fee_lamports`. Zero on a 116 byte `Config`; a missing one is an error. */
    async minFee() {
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) throw new Error("no Config account on this cluster");
      return decodeConfig(info).handle?.minFeeLamports ?? 0n;
    },

    /** One read of `Config`; a 116 byte one has none of the three, so all zero. */
    async feeConfig() {
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) throw new Error("no Config account on this cluster");
      const config = decodeConfig(info);
      return {
        bps: config.defaultFeeBps,
        minFee: config.handle?.minFeeLamports ?? 0n,
        minFeePerReceiver: config.handle?.minFeePerReceiverLamports ?? 0n,
        maxFee: config.handle?.maxFeeLamports ?? 0n,
      };
    },

    /**
     * `create_drop`, `activate`, address claims by the 6.5 fit table and one
     * `claim_handle` a handle leaf. Each at the base fee plus the priority fee for the
     * relayer's unit cap, the most it would attach. Rent is not counted, `close_drop` returns it.
     */
    estimateRelayerCost({ addressLeaves, handleLeaves, leafCount }) {
      const model = options.feeModel ?? { priorityFeeMicroLamports: 0n, maxComputeUnits: 400_000 };
      const priority =
        (BigInt(model.maxComputeUnits) * model.priorityFeeMicroLamports + 999_999n) / 1_000_000n;
      const perTx = SOLANA_BASE_FEE_LAMPORTS + priority;
      const perBatch = solClaimsPerTx(leafCount);
      const txs = 2n + BigInt(Math.ceil(addressLeaves / perBatch)) + BigInt(handleLeaves);
      return Promise.resolve({ cost: txs * perTx, unitPrice: perTx });
    },

    /** A migrated `Config` with a binder that is set and not revoked. */
    async handleModeReady() {
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) return false;
      const handle = decodeConfig(info).handle;
      return handle !== null && !handle.binderRevoked && handle.binder.some((byte) => byte !== 0);
    },

    /** The PDA, and whether the account already exists at it. */
    async predictDrop(creatorCommitment, nonce) {
      const pda = dropPda(hexToBytes(creatorCommitment), nonce);
      const existing = await rpc.getAccountInfo(pda.address, commitment);
      return { address: pubkeyToBase58(pda.address), taken: existing !== null };
    },

    /** 6.1, then: read the account back before anybody is shown the address. */
    async createDrop(params): Promise<AdapterCreated> {
      const commitmentBytes = hexToBytes(params.creatorCommitment);
      const drop = dropPda(commitmentBytes, params.nonce).address;
      const bitmap = bitmapPda(drop).address;

      const token =
        params.token === undefined
          ? undefined
          : (() => {
              const mint = pubkeyFromBase58(params.token.mint);
              const tokenProgram = pubkeyFromBase58(params.token.tokenProgram);
              return {
                mint,
                tokenProgram,
                vault: associatedTokenAddress(drop, mint, tokenProgram),
              };
            })();
      const sent = await relayer.createDrop({
        drop,
        bitmap,
        ...(token === undefined ? {} : { token }),
        params: {
          merkleRoot: hexToBytes(params.merkleRoot),
          manifestHash: hexToBytes(params.manifestHash),
          totalEntitlements: params.totalEntitlements,
          leafCount: params.leafCount,
          refundRecipient: pubkeyFromBase58(params.refundRecipient),
          creatorCommitment: commitmentBytes,
          nonce: params.nonce,
          fundingPeriod: params.fundingPeriod,
          claimPeriod: params.claimPeriod,
          // zero on a SOL drop, the fee on a token drop.
          solFeeLamports: params.token?.solFeeLamports ?? 0n,
        },
      });

      const info = await rpc.getAccountInfo(drop, commitment);
      if (info === null) throw new DropAccountMissingError(sent.signature, pubkeyToBase58(drop));
      const account = decodeDrop(info);

      return {
        txId: sent.signature,
        drop: pubkeyToBase58(drop),
        asset: pubkeyToBase58(account.asset),
        merkleRoot: bytesToHex(account.merkleRoot),
        manifestHash: bytesToHex(account.manifestHash),
        totalEntitlements: account.totalEntitlements,
        leafCount: account.leafCount,
        refundRecipient: pubkeyToBase58(account.refundRecipient),
        feeAmount: account.feeAmount,
        grossRequired: account.grossRequired,
        fundingDeadline: account.fundingDeadline,
        claimPeriod: account.claimPeriod,
        vault: pubkeyToBase58(account.vault),
        solFeeLamports: account.solFeeLamports,
        accountBudgetLamports: account.accountBudgetLamports,
        salt: null,
      };
    },

    tokenVault: (drop, mint, tokenProgram) =>
      pubkeyToBase58(
        associatedTokenAddress(
          pubkeyFromBase58(drop),
          pubkeyFromBase58(mint),
          pubkeyFromBase58(tokenProgram),
        ),
      ),

    tokenAccountRent: (tokenProgram) =>
      rpc.getMinimumBalanceForRentExemption(tokenAccountBytes(pubkeyFromBase58(tokenProgram))),

    /** `lamports - rent minimum`, never below zero. */
    async getSpendableBalance(drop) {
      const [lamports, minimum] = await Promise.all([
        rpc.getBalance(pubkeyFromBase58(drop), commitment),
        dropRentMinimum(),
      ]);
      return lamports > minimum ? lamports - minimum : 0n;
    },

    /**
     * The drop's fixed fields first, then its lamports and the vault's balance in one
     * `getMultipleAccounts`, so both parts come from the same slot.
     */
    async fundingStatus(drop): Promise<FundingStatus> {
      const dropKey = pubkeyFromBase58(drop);
      const account = await loadDrop(dropKey);
      const isToken = account.asset.some((byte) => byte !== 0);
      const [dropInfo, vaultInfo] = await rpc.getMultipleAccounts(
        isToken ? [dropKey, account.vault] : [dropKey],
        commitment,
      );
      if (dropInfo == null) throw new DropAccountMissingOnChainError(drop);
      const minimum = await dropRentMinimum();
      return statusOf(
        account,
        dropInfo.lamports,
        minimum,
        isToken ? (vaultInfo ?? null) : undefined,
      );
    },

    /**
     * every waiting drop in one funding poll. The `Drop` accounts in one
     * `getMultipleAccounts` per 100, then the vaults of the token drops in one more; the same
     * rule as `fundingStatus`.
     */
    async fundingStatuses(addresses): Promise<Map<string, FundingStatus | null>> {
      const out = new Map<string, FundingStatus | null>();
      const minimum = await dropRentMinimum();
      for (let i = 0; i < addresses.length; i += 100) {
        const chunk = addresses.slice(i, i + 100);
        const infos = await rpc.getMultipleAccounts(chunk.map(pubkeyFromBase58), commitment);
        const tokens: { address: string; account: DropAccount; lamports: bigint }[] = [];
        chunk.forEach((address, j) => {
          const info = infos[j] ?? null;
          if (info === null) {
            out.set(address, null);
            return;
          }
          const account = decodeDrop(info);
          if (account.asset.some((byte) => byte !== 0))
            tokens.push({ address, account, lamports: info.lamports });
          else out.set(address, statusOf(account, info.lamports, minimum, undefined));
        });
        if (tokens.length === 0) continue;
        const vaults = await rpc.getMultipleAccounts(
          tokens.map((t) => t.account.vault),
          commitment,
        );
        tokens.forEach((t, j) => {
          out.set(t.address, statusOf(t.account, t.lamports, minimum, vaults[j] ?? null));
        });
      }
      return out;
    },

    async readDrop(drop): Promise<DropOnChain> {
      return onChainOf(await loadDrop(pubkeyFromBase58(drop)));
    },

    /** every drop of the claim list in one `getMultipleAccounts` per 100. */
    async readDrops(addresses): Promise<Map<string, DropOnChain>> {
      const out = new Map<string, DropOnChain>();
      for (let i = 0; i < addresses.length; i += 100) {
        const chunk = addresses.slice(i, i + 100);
        const infos = await rpc.getMultipleAccounts(chunk.map(pubkeyFromBase58), commitment);
        chunk.forEach((address, j) => {
          const info = infos[j] ?? null;
          if (info === null) throw new DropAccountMissingOnChainError(address);
          out.set(address, onChainOf(decodeDrop(info)));
        });
      }
      return out;
    },

    /**
     * The `Drop`, the bitmap and the Clock sysvar in one
     * `getMultipleAccounts` at `finalized`, so all three come from the same slot, and a
     * finalized slot is never rolled back. The settle job compares `claimedCount` with
     * its own `confirmed` read and the deadline with the chain's `unix_timestamp`.
     */
    async claimedSnapshot(drop): Promise<ClaimedSnapshot | null> {
      const dropKey = pubkeyFromBase58(drop);
      const [dropInfo, bitmapInfo, clockInfo] = await rpc.getMultipleAccounts(
        [dropKey, bitmapPda(dropKey).address, CLOCK_SYSVAR_ID],
        "finalized",
      );
      // No clock is a broken RPC, not a closed drop: fail, and the job tries again.
      if (clockInfo == null) throw new Error("the cluster did not return the Clock sysvar");
      const unixTimestamp = decodeClockUnixTimestamp(clockInfo);
      if (dropInfo == null || bitmapInfo == null) return null;
      const account = decodeDrop(dropInfo);
      const bits = decodeClaimBitmap(bitmapInfo).bits;
      const indexes: number[] = [];
      for (let index = 0; index < account.leafCount; index += 1) {
        if (isClaimedBit(bits, index)) indexes.push(index);
      }
      return { claimedCount: account.claimedCount, indexes, unixTimestamp };
    },

    /** One 1,291 byte read answers for every index. */
    async readClaimed(drop, indexes) {
      const dropKey = pubkeyFromBase58(drop);
      const info = await rpc.getAccountInfo(bitmapPda(dropKey).address, commitment);
      const claimed = new Set<number>();
      // No bitmap means the drop was closed: nothing is claimable any more, so from the
      // payer's point of view every leaf is spoken for.
      if (info === null) {
        for (const index of indexes) claimed.add(index);
        return claimed;
      }
      const bitmap = decodeClaimBitmap(info);
      for (const index of indexes) if (isClaimedBit(bitmap.bits, index)) claimed.add(index);
      return claimed;
    },

    claimsPerTx: solClaimsPerTx,

    /** 6.2. The fee wallet is read from the drop, never taken from config. */
    async activate(drop) {
      const dropKey = pubkeyFromBase58(drop);
      const account = await loadDrop(dropKey);
      return toResult(
        await relayer.activate({
          drop: dropKey,
          feeWallet: account.feeWallet,
          ...withToken(await tokenOf(account)),
        }),
      );
    },

    /** 6.3 and 6.4. The `Claimed` events are read out of the log, one bag each. */
    async claimBatch(drop, items: readonly AdapterClaimItem[]): Promise<ClaimBatchResult> {
      const dropKey = pubkeyFromBase58(drop);
      const result = await relayer.claimBatch(
        dropKey,
        bitmapPda(dropKey).address,
        items.map((item) => ({
          index: item.index,
          recipient: pubkeyFromBase58(item.recipient),
          amount: item.amount,
          proof: item.proof.map((node) => hexToBytes(node)),
        })),
      );
      const events = decodeClaimedEvents(result.logs, dropKey);
      // A transaction is atomic and a failing claim fails it whole, so a confirmed
      // transaction paid every instruction in it. The events are still what is reported; the
      // items are the fallback only when a node truncated the log.
      const paid =
        events.length > 0
          ? events.map((e) => ({
              index: e.index,
              recipient: pubkeyToBase58(e.recipient),
              amount: e.amount,
            }))
          : items.map((item) => ({
              index: item.index,
              recipient: item.recipient,
              amount: item.amount,
            }));
      return { ...toResult(result), paid };
    },

    /** 6.7. */
    /**
     * one claim per transaction. The Ed25519 instruction carries the binder key read
     * from `Config` now, the message rebuilt here, and the signature stored at bind time. A
     * signature that is not the binder's fails the simulation and nothing is sent.
     */
    async claimHandle(drop, item) {
      const dropKey = pubkeyFromBase58(drop);
      const token = await tokenOf(await loadDrop(dropKey));
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) throw new Error("no Config account on this cluster");
      const handle = decodeConfig(info).handle;
      if (handle === null) throw new Error("Config is not migrated: no binder to check");
      const message = svmBindingMessage({
        drop,
        chainId: chain.chainId,
        index: item.index,
        xId: item.xId,
        recipient: item.recipient,
      });
      const result = await relayer.claimHandle({
        drop: dropKey,
        bitmap: bitmapPda(dropKey).address,
        recipient: pubkeyFromBase58(item.recipient),
        index: item.index,
        xId: item.xId,
        amount: item.amount,
        proof: item.proof.map((node) => hexToBytes(node)),
        ed25519Data: ed25519InstructionData(
          base58Encode(handle.binder),
          hexToBytes(item.signature),
          message,
        ),
        ...withToken(token),
      });
      const [event] = decodeHandleClaimedEvents(result.logs, dropKey);
      return {
        ...toResult(result),
        paid:
          event === undefined
            ? null
            : {
                index: event.index,
                recipient: pubkeyToBase58(event.recipient),
                amount: event.amount,
              },
      };
    },

    /** The binder in a migrated `Config` when it is set and not revoked, else `null`.  */
    async liveBinder() {
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) return null;
      const handle = decodeConfig(info).handle;
      if (handle === null || handle.binderRevoked || handle.binder.every((byte) => byte === 0)) {
        return null;
      }
      return pubkeyToBase58(handle.binder);
    },

    /** a migrated `Config` whose binder is set and not revoked. */
    async binderLive() {
      const info = await rpc.getAccountInfo(configPda().address, commitment);
      if (info === null) return false;
      const handle = decodeConfig(info).handle;
      return handle !== null && !handle.binderRevoked && handle.binder.some((byte) => byte !== 0);
    },

    async refund(drop) {
      const dropKey = pubkeyFromBase58(drop);
      const account = await loadDrop(dropKey);
      return toResult(
        await relayer.refund({
          drop: dropKey,
          refundRecipient: account.refundRecipient,
          ...withToken(await tokenOf(account)),
        }),
      );
    },

    /** 6.6. */
    async cancelUnfunded(drop) {
      const dropKey = pubkeyFromBase58(drop);
      const account = await loadDrop(dropKey);
      return toResult(
        await relayer.cancelUnfunded({
          drop: dropKey,
          refundRecipient: account.refundRecipient,
          ...withToken(await tokenOf(account)),
        }),
      );
    },

    /** 6.10. `rent_payer` and `refund_recipient` come from the account. */
    async closeDrop(drop) {
      const dropKey = pubkeyFromBase58(drop);
      const account = await loadDrop(dropKey);
      return toResult(
        await relayer.closeDrop({
          drop: dropKey,
          bitmap: bitmapPda(dropKey).address,
          rentPayer: account.rentPayer,
          refundRecipient: account.refundRecipient,
          ...withToken(await tokenOf(account)),
        }),
      );
    },

    /**
     * Solana Pay, `amount` in whole coins as the design of that URL scheme wants it. A token
     * drop adds the token part, `spl-token`, to the same drop address.
     */
    fundingInstructions({ drop, amount: exact, fundingDeadline, token }): FundingInstructions {
      // A token drop's SOL part is rounded up to 0.001 SOL: the program needs at
      // least the exact sum, and the extra goes back to the refund address. A
      // SOL drop stays exact: its amount is what people get.
      const amount =
        token === undefined ? exact : ((exact + MILLI_SOL - 1n) / MILLI_SOL) * MILLI_SOL;
      const display = formatLamports(amount);
      const tokenDisplay = token === undefined ? "" : formatUnits(token.amount, token.decimals);
      return {
        ...(token === undefined
          ? {}
          : {
              token: {
                mint: token.mint,
                vault: token.vault,
                tokenProgram: token.tokenProgram,
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                amountBaseUnits: token.amount.toString(),
                amountDisplay: tokenDisplay,
                paymentUri: `solana:${drop}?amount=${tokenDisplay}&spl-token=${token.mint}`,
              },
            }),
        family: "svm",
        address: drop,
        chainId: chain.chainId,
        asset: "native",
        symbol: chain.nativeSymbol,
        decimals: SOL_DECIMALS,
        amountBaseUnits: amount.toString(),
        amountDisplay: display,
        paymentUri: `solana:${drop}?amount=${display}`,
        fundingDeadline: fundingDeadline.toString(),
        amountWei: amount.toString(),
        amountEth: display,
      };
    },

    txUrl: (txId) => explorerTxUrl(chain, txId),
  };
}
