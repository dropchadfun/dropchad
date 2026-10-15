/**
 * The Solana relayer. The second thing in dropchad that holds a key and signs.
 *
 * **It can send exactly seven instructions: `create_drop`, `activate`, `claim`, `refund`,
 * `cancel_unfunded`, `close_drop`, and since `claim_handle`**
 * 6. `claim_handle` pays the recipient the binder signed for, never the caller. Of the others, the
 * on Solana `refund` and `cancel_unfunded` are what make
 * `close_drop` possible, and `close_drop` is what returns the 0.0099 SOL of bitmap rent the
 * relayer paid. None of the six can move drop funds anywhere but where the drop account
 * says. There is no admin instruction here and no `sweep`.
 *
 * Guards, all inside the one private `send`, the same shape as the EVM relayer:
 *
 * 1. **Every instruction is addressed to the dropchad program.** The only other program in a
 *    transaction is the compute budget program, and those two instructions are added here, not
 *    by the caller. The System program is never a destination, so a plain transfer cannot be
 *    built: the relayer's own lamports leave only as fees and rent. **One exception:** a
 *    `claim_handle` transaction is exactly one Ed25519 instruction, byte for byte the strict
 *    layout, directly followed by one `claim_handle`, and the signed message must be the
 *    message for that very claim. An Ed25519 instruction anywhere else is refused, so the relayer
 *    cannot carry any other signature check.
 * 2. **The discriminator must be one of the six**, recomputed from the encoded bytes and matched
 *    against the IDL, never trusted from the caller. Every instruction in a transaction must be
 *    the kind the caller named, so a `claim` batch cannot smuggle a `close_drop`.
 * 3. **The destination must be known.** `create_drop` must name the config PDA. The other six
 *    must name a drop in our own `drops` table, at account 1, or account 2 for `claim_handle`, which means one whose account we read back
 *    field by field after creation.
 * 4. **Simulate, cap, budget.** The transaction is simulated first; a failing simulation is
 *    refused with the program error name and never sent. The compute unit limit is set from the
 *    simulation with headroom, under a hard cap. The worst case cost — base fee, priority fee and,
 *    for `create_drop`, the rent — is charged to the day's lamport budget **before** the send and
 *    corrected from the confirmed transaction afterwards.
 *
 * Solana has no nonce. Sends are still serialised, because the budget check and the blockhash
 * read are cheaper to reason about one at a time, and a transaction is confirmed before the next
 * is built.
 *
 * **Nothing in this file logs, returns or stores the key.** It holds a `Signer`, which can sign
 * and name its public key and nothing else.
 */
import { BINDING_TAG, type dropchadIdl } from "@dropchad/shared";
import { hexToBytes } from "viem";

import { GasBudgetExceededError, RelayerRefusedError, type GasBudget } from "../relayer.js";
import { programErrorName } from "./accounts.js";
import {
  activateInstruction,
  cancelUnfundedInstruction,
  claimHandleInstruction,
  claimInstruction,
  closeDropInstruction,
  createDropInstruction,
  ed25519Instruction,
  instructionNameOf,
  isDropchadInstruction,
  isEd25519Instruction,
  refundInstruction,
  setComputeUnitLimit,
  setComputeUnitPrice,
  type CreateParams,
  type DropToken,
} from "./instructions.js";
import type { Signer } from "./keypair.js";
import { configPda, tokenAccountBytes } from "./pda.js";
import { pubkeyEquals, pubkeyToBase58, type Pubkey } from "./pubkey.js";
import type { Commitment, SvmRpc, TransactionMeta } from "./rpc.js";
import {
  compileMessage,
  signTransaction,
  TransactionTooLargeError,
  type Instruction,
} from "./transaction.js";

/** The seven instructions, and nothing else, ever. the design is the list. */
export const ALLOWED_INSTRUCTIONS = [
  "create_drop",
  "activate",
  "claim",
  "refund",
  "cancel_unfunded",
  "close_drop",
  "claim_handle",
] as const;
export type SvmRelayerKind = (typeof ALLOWED_INSTRUCTIONS)[number];

/** Compile time proof that every allowed name is an instruction the IDL knows. */
type IdlInstructionName = (typeof dropchadIdl.instructions)[number]["name"];
export type AllowedNamesExistInIdl = SvmRelayerKind extends IdlInstructionName ? true : never;

/** Base fee per signature, lamports. A cluster constant today; the budget uses it as a floor. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

export class ComputeCapExceededError extends Error {
  constructor(
    readonly kind: SvmRelayerKind,
    readonly units: number,
    readonly cap: number,
  ) {
    super(`${kind} needs ${String(units)} compute units, over the cap of ${String(cap)}`);
    this.name = "ComputeCapExceededError";
  }
}

export class SimulationFailedError extends Error {
  constructor(
    readonly kind: SvmRelayerKind,
    readonly programError: string | null,
    readonly logs: readonly string[],
  ) {
    super(
      `${kind} would fail: ${programError ?? "unknown error"}. ` +
        `Last log: ${logs.at(-1) ?? "(none)"}`,
    );
    this.name = "SimulationFailedError";
  }
}

export class TransactionExpiredError extends Error {
  constructor(
    readonly kind: SvmRelayerKind,
    readonly signature: string,
  ) {
    super(`${kind} ${signature} was not confirmed before its blockhash expired`);
    this.name = "TransactionExpiredError";
  }
}

export class TransactionFailedError extends Error {
  constructor(
    readonly kind: SvmRelayerKind,
    readonly signature: string,
    readonly programError: string | null,
  ) {
    super(`${kind} ${signature} failed on chain: ${programError ?? "unknown error"}`);
    this.name = "TransactionFailedError";
  }
}

export interface SvmRelayerResult {
  readonly signature: string;
  readonly slot: number;
  readonly blockTime: number | null;
  /** The transaction fee, lamports. */
  readonly fee: bigint;
  /** Everything the relayer account lost in this transaction: fee plus any rent it paid. */
  readonly relayerSpent: bigint;
  readonly computeUnits: number | null;
  readonly logs: readonly string[];
}

export interface SvmRelayerRecorder {
  onSent(tx: {
    signature: string;
    kind: SvmRelayerKind;
    dropAddress: string | null;
    computeUnitLimit: number;
    lastValidBlockHeight: number;
  }): Promise<void>;
  onConfirmed(tx: { signature: string; result: SvmRelayerResult }): Promise<void>;
  onFailed(tx: { signature: string; error: string }): Promise<void>;
}

export interface SvmRelayerOptions {
  readonly rpc: SvmRpc;
  readonly signer: Signer;
  /** True when this base58 address is a drop we created. Backed by the `drops` table. */
  isKnownDrop(address: string): Promise<boolean>;
  /** Lamports per UTC day. `src/chain/gas-budget.ts` with `unit: "lamports"`. */
  readonly budget: GasBudget;
  readonly caps: {
    /** Hard ceiling on the compute unit limit of one transaction. */
    readonly maxComputeUnits: number;
    /** Micro lamports per compute unit.: zero on devnet. */
    readonly priorityFeeMicroLamports: bigint;
  };
  /** Lamports the relayer pays in rent for a `create_drop`: the drop and the bitmap. */
  rentForCreate(): Promise<bigint>;
  readonly recorder?: SvmRelayerRecorder;
  /** `confirmed` for the live flow. Tests use `processed`. */
  readonly commitment?: Commitment;
  /** How long to wait between status polls. Tests inject a no-op. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number;
}

export interface SvmRelayer {
  readonly publicKey: Pubkey;
  readonly address: string;
  createDrop(args: {
    drop: Pubkey;
    bitmap: Pubkey;
    params: CreateParams;
    /** A token drop. The vault rent is charged to the budget too. */
    token?: { mint: Pubkey; vault: Pubkey; tokenProgram: Pubkey };
  }): Promise<SvmRelayerResult>;
  /** `token`: a token drop's mint, vault and token program. Absent on a SOL drop. */
  activate(args: { drop: Pubkey; feeWallet: Pubkey; token?: DropToken }): Promise<SvmRelayerResult>;
  /** Several `claim` instructions in one transaction. */
  claimBatch(
    drop: Pubkey,
    bitmap: Pubkey,
    items: readonly {
      readonly index: number;
      readonly recipient: Pubkey;
      readonly amount: bigint;
      readonly proof: readonly Uint8Array[];
    }[],
  ): Promise<SvmRelayerResult>;
  /** One Ed25519 instruction and one `claim_handle`, one claim per transaction. */
  claimHandle(args: {
    drop: Pubkey;
    bitmap: Pubkey;
    recipient: Pubkey;
    index: number;
    xId: bigint;
    amount: bigint;
    proof: readonly Uint8Array[];
    /** `ed25519InstructionData` from `packages/shared`, carrying the stored binding. */
    ed25519Data: Uint8Array;
    /**
     * A token drop. Its claim carries no compute budget instruction: at depth 9 it only
     * fits without one, so it runs on the default limit and pays no priority fee.
     */
    token?: DropToken;
  }): Promise<SvmRelayerResult>;
  refund(args: {
    drop: Pubkey;
    refundRecipient: Pubkey;
    token?: DropToken;
  }): Promise<SvmRelayerResult>;
  cancelUnfunded(args: {
    drop: Pubkey;
    refundRecipient: Pubkey;
    token?: DropToken;
  }): Promise<SvmRelayerResult>;
  closeDrop(args: {
    drop: Pubkey;
    bitmap: Pubkey;
    rentPayer: Pubkey;
    refundRecipient: Pubkey;
    token?: DropToken;
  }): Promise<SvmRelayerResult>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The runtime's compute limit per instruction when a transaction sets none. A token
 * `claim_handle` sends no compute budget instruction, so this is its ceiling.
 */
export const DEFAULT_INSTRUCTION_COMPUTE_UNITS = 200_000;

/** the one Ed25519 data layout: key at 16, signature at 48, the 192 byte message at 112. */
const ED25519_DATA_BYTES = 16 + 32 + 64 + 192;
const ED25519_OFFSETS = [48, 0xffff, 16, 0xffff, 112, 192, 0xffff];
const BINDING_TAG_BYTES = hexToBytes(BINDING_TAG);

/** Big endian u256, as the binding message writes its numbers. */
function u256be(bytes: Uint8Array): bigint {
  return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Guards 1 and 2, and the account guard 3 reads: pure, so every bad shape is tested directly.
 * Returns the account every dropchad instruction targets: the config for `create_drop`, the drop
 * for the rest. Throws `RelayerRefusedError`.
 */
export function checkInstructionShape(
  kind: SvmRelayerKind,
  instructions: readonly Instruction[],
): Pubkey {
  if (instructions.length === 0) {
    throw new RelayerRefusedError("refusing to send an empty transaction");
  }
  if (!ALLOWED_INSTRUCTIONS.includes(kind)) {
    throw new RelayerRefusedError(`refusing to send: ${String(kind)} is not one of the seven`);
  }

  let program = instructions;
  if (kind === "claim_handle") {
    // --- the exception: exactly [Ed25519, claim_handle] ------------------------------
    const [ed, claim] = instructions;
    if (instructions.length !== 2 || ed === undefined || claim === undefined) {
      throw new RelayerRefusedError(
        "refusing to send: claim_handle goes alone, directly after one Ed25519 instruction",
      );
    }
    if (!isEd25519Instruction(ed) || ed.keys.length !== 0) {
      throw new RelayerRefusedError("refusing to send: no Ed25519 instruction before claim_handle");
    }
    checkEd25519Data(ed.data, claim);
    program = [claim];
  }

  let target: Pubkey | null = null;
  for (const ix of program) {
    // --- guard 1: our program only ----------------------------------------------------------
    if (!isDropchadInstruction(ix)) {
      throw new RelayerRefusedError(
        `refusing to send: instruction for program ${pubkeyToBase58(ix.programId)} is not dropchad`,
      );
    }
    // --- guard 2: the discriminator must be the kind the caller named ------------------------
    const name = instructionNameOf(ix.data);
    if (name !== kind) {
      throw new RelayerRefusedError(
        `refusing to send: instruction is ${name ?? "unknown"}, not ${kind}`,
      );
    }
    const at = kind === "claim_handle" ? ix.keys[2] : ix.keys[1];
    if (at === undefined) throw new RelayerRefusedError("refusing to send: no target account");
    if (target !== null && !pubkeyEquals(target, at.pubkey)) {
      throw new RelayerRefusedError("refusing to send: instructions name different targets");
    }
    target = at.pubkey;
  }
  if (target === null) throw new RelayerRefusedError("refusing to send: no target account");
  return target;
}

/**
 * The Ed25519 data must be the one fixed layout, and its message the binding message for this
 * claim: the tag, the drop, the index, the X id and the recipient the `claim_handle` names. The
 * chain id and the signature itself are the program's and the runtime's to check; a wrong one
 * fails the simulation, guard 4a, before anything is signed for real.
 */
function checkEd25519Data(data: Uint8Array, claim: Instruction): void {
  const refuse = (why: string) => {
    throw new RelayerRefusedError(`refusing to send: the Ed25519 instruction ${why}`);
  };
  if (data.length !== ED25519_DATA_BYTES) refuse("is not the size");
  if (data[0] !== 1 || data[1] !== 0) refuse("is not one signature with a zero padding byte");
  ED25519_OFFSETS.forEach((expected, i) => {
    const value = (data[2 + 2 * i] as number) | ((data[3 + 2 * i] as number) << 8);
    if (value !== expected) refuse("offsets are not the layout");
  });

  const message = data.slice(112);
  const drop = claim.keys[2]?.pubkey;
  const recipient = claim.keys[4]?.pubkey;
  if (drop === undefined || recipient === undefined) refuse("has no claim to match");
  const args = claim.data.slice(8);
  const index = new DataView(args.buffer, args.byteOffset).getUint32(0, true);
  const xId = new DataView(args.buffer, args.byteOffset).getBigUint64(4, true);
  if (
    !sameBytes(message.slice(0, 32), BINDING_TAG_BYTES) ||
    !sameBytes(message.slice(32, 64), drop as Pubkey) ||
    u256be(message.slice(96, 128)) !== BigInt(index) ||
    u256be(message.slice(128, 160)) !== xId ||
    !sameBytes(message.slice(160, 192), recipient as Pubkey)
  ) {
    refuse("signs another claim");
  }
}

export function createSvmRelayer(options: SvmRelayerOptions): SvmRelayer {
  const { rpc, signer, budget, caps } = options;
  const commitment = options.commitment ?? "confirmed";
  const sleep = options.sleep ?? defaultSleep;
  const pollMs = options.pollMs ?? 1_000;
  const config = configPda().address;

  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Guards 1 to 3. Throws `RelayerRefusedError`; nothing is signed after a refusal. */
  async function guard(
    kind: SvmRelayerKind,
    instructions: readonly Instruction[],
    drop: Pubkey | null,
  ) {
    const target = checkInstructionShape(kind, instructions);
    // --- guard 3: the destination must be known ---------------------------------------------
    if (kind === "create_drop") {
      if (!pubkeyEquals(target, config)) {
        throw new RelayerRefusedError(
          `refusing to send create_drop against ${pubkeyToBase58(target)}, the config is ${pubkeyToBase58(config)}`,
        );
      }
      return;
    }
    if (drop === null || !pubkeyEquals(target, drop)) {
      throw new RelayerRefusedError(`refusing to send ${kind}: instruction names another drop`);
    }
    if (!(await options.isKnownDrop(pubkeyToBase58(target)))) {
      throw new RelayerRefusedError(
        `refusing to send ${kind} to ${pubkeyToBase58(target)}: not a drop this api created`,
      );
    }
  }

  function relayerSpentIn(meta: TransactionMeta): bigint {
    // The fee payer is account 0 in every message we build.
    const before = meta.preBalances[0];
    const after = meta.postBalances[0];
    if (before === undefined || after === undefined) return meta.fee;
    return before - after;
  }

  async function send(
    kind: SvmRelayerKind,
    instructions: readonly Instruction[],
    drop: Pubkey | null,
    /** Rent on top of `rentForCreate`: a token drop's vault. */
    extraRent = 0n,
    /**
     * False for a token `claim_handle`: no compute budget instruction at all, so the
     * runtime default is the limit and there is no priority fee.
     */
    computeBudget = true,
  ): Promise<SvmRelayerResult> {
    await guard(kind, instructions, drop);

    return serial(async () => {
      // --- guard 4a: simulate. A transaction that would fail is never signed for real. ---------
      const blockhash = await rpc.getLatestBlockhash(commitment);
      const draft = signTransaction(
        compileMessage({
          feePayer: signer.publicKey,
          recentBlockhash: blockhash.blockhash,
          instructions: computeBudget
            ? [setComputeUnitLimit(caps.maxComputeUnits), ...instructions]
            : instructions,
        }),
        [signer],
      );
      const simulation = await rpc.simulateTransaction(draft.bytes, commitment);
      if (simulation.err !== null) {
        throw new SimulationFailedError(kind, programErrorName(simulation.err), simulation.logs);
      }

      // --- guard 4b: the compute cap. Simulation plus 20% head room, never above the cap. -----
      const cap = computeBudget
        ? caps.maxComputeUnits
        : Math.min(caps.maxComputeUnits, DEFAULT_INSTRUCTION_COMPUTE_UNITS);
      const used = simulation.unitsConsumed ?? cap;
      if (used > cap) throw new ComputeCapExceededError(kind, used, cap);
      const withHeadroom = Math.ceil(used * 1.2);
      const unitLimit = computeBudget
        ? Math.min(Math.max(withHeadroom, 1_000), caps.maxComputeUnits)
        : DEFAULT_INSTRUCTION_COMPUTE_UNITS;

      // --- guard 4c: charge the worst case to the day's budget before sending -----------------
      const priority = computeBudget
        ? (BigInt(unitLimit) * caps.priorityFeeMicroLamports + 999_999n) / 1_000_000n
        : 0n;
      const rent = kind === "create_drop" ? (await options.rentForCreate()) + extraRent : 0n;
      const reserved = LAMPORTS_PER_SIGNATURE + priority + rent;
      await budget.reserve(reserved);

      const budgetIxs = !computeBudget
        ? []
        : caps.priorityFeeMicroLamports > 0n
          ? [setComputeUnitLimit(unitLimit), setComputeUnitPrice(caps.priorityFeeMicroLamports)]
          : [setComputeUnitLimit(unitLimit)];

      let tx;
      let signature: string;
      try {
        tx = signTransaction(
          compileMessage({
            feePayer: signer.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: [...budgetIxs, ...instructions],
          }),
          [signer],
        );
        signature = await rpc.sendTransaction(tx.bytes, commitment);
      } catch (error) {
        await budget.settle(reserved, 0n);
        throw error;
      }
      if (signature !== tx.signature) {
        // The node echoes the first signature back. Anything else means the wire got confused.
        await budget.settle(reserved, 0n);
        throw new RelayerRefusedError(
          `node returned signature ${signature}, we signed ${tx.signature}`,
        );
      }

      await options.recorder?.onSent({
        signature,
        kind,
        dropAddress: drop === null ? null : pubkeyToBase58(drop),
        computeUnitLimit: unitLimit,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
      });

      // --- confirm: poll until confirmed, or until the blockhash can no longer be included -----
      let meta: TransactionMeta;
      for (;;) {
        const [status] = await rpc.getSignatureStatuses([signature]);
        const level = status?.confirmationStatus ?? null;
        const reached =
          level === "finalized" ||
          (level === "confirmed" && commitment !== "finalized") ||
          (level === "processed" && commitment === "processed");
        if (status !== null && status !== undefined && (reached || status.err !== null)) {
          const fetched = await rpc.getTransaction(signature, commitment);
          if (fetched !== null) {
            meta = fetched;
            break;
          }
        }
        const height = await rpc.getBlockHeight(commitment);
        if (height > blockhash.lastValidBlockHeight) {
          await budget.settle(reserved, 0n);
          const message = `expired before confirmation`;
          await options.recorder?.onFailed({ signature, error: message });
          throw new TransactionExpiredError(kind, signature);
        }
        await sleep(pollMs);
      }

      const result: SvmRelayerResult = {
        signature,
        slot: meta.slot,
        blockTime: meta.blockTime,
        fee: meta.fee,
        relayerSpent: relayerSpentIn(meta),
        computeUnits: meta.computeUnitsConsumed,
        logs: meta.logMessages,
      };
      // A failed transaction still paid its fee, so the budget is settled before this throws.
      await budget.settle(reserved, result.relayerSpent);

      if (meta.err !== null) {
        const named = programErrorName(meta.err);
        await options.recorder?.onFailed({ signature, error: named ?? "failed" });
        throw new TransactionFailedError(kind, signature, named);
      }
      await options.recorder?.onConfirmed({ signature, result });
      return result;
    });
  }

  const me = signer.publicKey;

  return {
    publicKey: me,
    address: pubkeyToBase58(me),

    createDrop: async ({ drop, bitmap, params, token }) => {
      const vaultRent =
        token === undefined
          ? 0n
          : await rpc.getMinimumBalanceForRentExemption(tokenAccountBytes(token.tokenProgram));
      return send(
        "create_drop",
        [
          createDropInstruction({
            relayer: me,
            drop,
            bitmap,
            params,
            ...(token === undefined ? {} : { token }),
          }),
        ],
        null,
        vaultRent,
      );
    },

    activate: ({ drop, feeWallet, token }) =>
      send(
        "activate",
        [
          activateInstruction({
            caller: me,
            drop,
            feeWallet,
            ...(token === undefined ? {} : { token }),
          }),
        ],
        drop,
      ),

    claimBatch: (drop, bitmap, items) =>
      send(
        "claim",
        items.map((item) =>
          claimInstruction({
            caller: me,
            drop,
            bitmap,
            recipient: item.recipient,
            index: item.index,
            amount: item.amount,
            proof: item.proof,
          }),
        ),
        drop,
      ),

    claimHandle: ({ drop, bitmap, recipient, index, xId, amount, proof, ed25519Data, token }) =>
      send(
        "claim_handle",
        [
          ed25519Instruction(ed25519Data),
          claimHandleInstruction({
            caller: me,
            drop,
            bitmap,
            recipient,
            index,
            xId,
            amount,
            proof,
            ...(token === undefined ? {} : { token }),
          }),
        ],
        drop,
        0n,
        token === undefined,
      ),

    refund: ({ drop, refundRecipient, token }) =>
      send(
        "refund",
        [
          refundInstruction({
            caller: me,
            drop,
            refundRecipient,
            ...(token === undefined ? {} : { token }),
          }),
        ],
        drop,
      ),

    cancelUnfunded: ({ drop, refundRecipient, token }) =>
      send(
        "cancel_unfunded",
        [
          cancelUnfundedInstruction({
            caller: me,
            drop,
            refundRecipient,
            ...(token === undefined ? {} : { token }),
          }),
        ],
        drop,
      ),

    closeDrop: ({ drop, bitmap, rentPayer, refundRecipient, token }) =>
      send(
        "close_drop",
        [
          closeDropInstruction({
            caller: me,
            drop,
            bitmap,
            rentPayer,
            refundRecipient,
            ...(token === undefined ? {} : { token }),
          }),
        ],
        drop,
      ),
  };
}

export { GasBudgetExceededError, RelayerRefusedError, TransactionTooLargeError };
