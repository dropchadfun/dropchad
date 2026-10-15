/**
 * The dropchad instructions the api can build, encoded from the IDL.
 *
 * An Anchor instruction is an 8 byte discriminator followed by the borsh encoded arguments, and
 * the accounts in the order the program declares them. Both come from `dropchadIdl`, generated
 * by `npm run sync:idl`, so a rebuilt program with a changed layout is caught by the check
 * script and never by a failing transaction.
 *
 * Every instruction that has SPL accounts takes them as optional, and an absent optional account
 * is passed as the program id, the Anchor convention the Rust tests follow. That is why a SOL
 * `claim` carries ten account slots. A token drop passes its `DropToken`, and
 * the slots carry the real accounts.
 *
 * Nothing here is sent. `relayer.ts` decides what may be sent, and its allowlist is a list of
 * the names below, checked against the discriminator bytes after encoding.
 */
import { dropchadIdl } from "@dropchad/shared";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  configPda,
  programDataPda,
} from "./pda.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  DROPCHAD_PROGRAM_ID,
  ED25519_PROGRAM_ID,
  INSTRUCTIONS_SYSVAR_ID,
  SYSTEM_PROGRAM_ID,
  pubkeyEquals,
  type Pubkey,
} from "./pubkey.js";
import type { AccountMeta, Instruction } from "./transaction.js";

export type InstructionName = (typeof dropchadIdl.instructions)[number]["name"];

/** The eight bytes Anchor puts first. Read from the IDL, keyed by instruction name. */
export function discriminatorOf(name: InstructionName): Uint8Array {
  const entry = dropchadIdl.instructions.find((ix) => ix.name === name);
  if (entry === undefined) throw new Error(`no instruction ${name} in the idl`);
  return new Uint8Array(entry.discriminator);
}

/** The instruction name for a discriminator, or `null`. The relayer's allowlist check uses it. */
export function instructionNameOf(data: Uint8Array): InstructionName | null {
  if (data.length < 8) return null;
  for (const ix of dropchadIdl.instructions) {
    if (ix.discriminator.every((byte, i) => data[i] === byte)) return ix.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// borsh, the four shapes the program uses
// ---------------------------------------------------------------------------

class Writer {
  private readonly parts: Uint8Array[] = [];

  bytes(value: Uint8Array): this {
    this.parts.push(value);
    return this;
  }
  u8(value: number): this {
    return this.bytes(new Uint8Array([value & 0xff]));
  }
  u16(value: number): this {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, true);
    return this.bytes(out);
  }
  u32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, true);
    return this.bytes(out);
  }
  u64(value: bigint): this {
    if (value < 0n || value > 0xffffffffffffffffn) throw new Error("u64 out of range");
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value, true);
    return this.bytes(out);
  }
  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }
  /** `[u8; 32]`, a public key or a hash. */
  array32(value: Uint8Array): this {
    if (value.length !== 32) throw new Error("expected 32 bytes");
    return this.bytes(value);
  }
  /** `Vec<[u8; 32]>`: a u32 length, then the items. */
  vec32(items: readonly Uint8Array[]): this {
    this.u32(items.length);
    for (const item of items) this.array32(item);
    return this;
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

const meta = (pubkey: Pubkey, isWritable: boolean, isSigner = false): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable,
});

/** An absent optional account is the program id, readonly, not a signer. */
const absent = (): AccountMeta => meta(DROPCHAD_PROGRAM_ID, false);

/** A token drop's own accounts: the mint, the vault and the mint's token program. */
export interface DropToken {
  readonly mint: Pubkey;
  readonly vault: Pubkey;
  readonly tokenProgram: Pubkey;
}

/** The five SPL slots `claim`, `claim_handle`, the settle pair and `close_drop` carry, all absent for a SOL drop. */
const noSplAccounts = (): AccountMeta[] => [
  absent(), // mint
  absent(), // vault
  absent(), // recipient_ata | refund_ata
  absent(), // token_program
  absent(), // associated_token_program
];

/**
 * The same five slots on a token drop. `owner` is whoever's associated token account goes in the
 * third slot: the receiver on a claim, `refund_recipient` on the settle pair and the close.
 */
const splAccounts = (token: DropToken | undefined, owner: Pubkey): AccountMeta[] =>
  token === undefined
    ? noSplAccounts()
    : [
        meta(token.mint, false),
        meta(token.vault, true),
        meta(associatedTokenAddress(owner, token.mint, token.tokenProgram), true),
        meta(token.tokenProgram, false),
        meta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      ];

const systemProgram = (): AccountMeta => meta(SYSTEM_PROGRAM_ID, false);

// ---------------------------------------------------------------------------
// the instructions
// ---------------------------------------------------------------------------

/** `CreateParams`. Same fields as the EVM struct minus `asset` and `tokenFactory`. */
export interface CreateParams {
  readonly merkleRoot: Uint8Array;
  readonly manifestHash: Uint8Array;
  readonly totalEntitlements: bigint;
  readonly leafCount: number;
  readonly refundRecipient: Pubkey;
  readonly creatorCommitment: Uint8Array;
  readonly nonce: bigint;
  readonly fundingPeriod: number;
  readonly claimPeriod: number;
  /** A token drop's fee in lamports, at most 1 SOL. Always zero on a SOL drop. */
  readonly solFeeLamports: bigint;
}

export function encodeCreateParams(params: CreateParams): Uint8Array {
  return new Writer()
    .array32(params.merkleRoot)
    .array32(params.manifestHash)
    .u64(params.totalEntitlements)
    .u32(params.leafCount)
    .array32(params.refundRecipient)
    .array32(params.creatorCommitment)
    .u64(params.nonce)
    .u32(params.fundingPeriod)
    .u32(params.claimPeriod)
    .u64(params.solFeeLamports)
    .finish();
}

/** 6.0. `authority` must be the upgrade authority; the script in `scripts/` is the only caller. */
export function initializeConfigInstruction(args: {
  readonly authority: Pubkey;
  readonly chainId: bigint;
  readonly relayer: Pubkey;
  readonly feeWallet: Pubkey;
  readonly defaultFeeBps: number;
  readonly programId?: Pubkey;
}): Instruction {
  const programId = args.programId ?? DROPCHAD_PROGRAM_ID;
  return {
    programId,
    keys: [
      meta(args.authority, true, true),
      meta(configPda(programId).address, true),
      meta(programId, false),
      meta(programDataPda(programId).address, false),
      systemProgram(),
    ],
    data: new Writer()
      .bytes(discriminatorOf("initialize_config"))
      .u64(args.chainId)
      .array32(args.relayer)
      .array32(args.feeWallet)
      .u16(args.defaultFeeBps)
      .finish(),
  };
}

/**
 * 6.11, `set_default_fee_bps`. `admin` must be `config.admin`, the program checks `has_one`.
 * New drops only. Built for `scripts/set-solana-fee.ts`; the relayer never sends it.
 */
export function setDefaultFeeBpsInstruction(args: {
  readonly admin: Pubkey;
  readonly bps: number;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, true, true), meta(configPda().address, true)],
    data: new Writer().bytes(discriminatorOf("set_default_fee_bps")).u16(args.bps).finish(),
  };
}

/**
 * `migrate_config`, once. The admin signs and pays the extra rent, so it is writable; the
 * program checks the 116 byte `Config` by hand. Built for `scripts/solana-admin.ts`, handle mode
 * the relayer never sends it.
 */
export function migrateConfigInstruction(args: { readonly admin: Pubkey }): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, true, true), meta(configPda().address, true), systemProgram()],
    data: discriminatorOf("migrate_config"),
  };
}

/** `set_binder`. Clears the revoke. `admin` must be `config.admin`, `has_one`. */
export function setBinderInstruction(args: {
  readonly admin: Pubkey;
  readonly binder: Pubkey;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, false, true), meta(configPda().address, true)],
    data: new Writer().bytes(discriminatorOf("set_binder")).array32(args.binder).finish(),
  };
}

/** `set_min_fee`. New SOL drops only; the program caps it at `MAX_MIN_FEE_LAMPORTS`. */
export function setMinFeeInstruction(args: {
  readonly admin: Pubkey;
  readonly lamports: bigint;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, false, true), meta(configPda().address, true)],
    data: new Writer().bytes(discriminatorOf("set_min_fee")).u64(args.lamports).finish(),
  };
}

/** `set_fee_per_receiver`. New SOL drops only; zero is off; capped by the program. */
export function setFeePerReceiverInstruction(args: {
  readonly admin: Pubkey;
  readonly lamports: bigint;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, false, true), meta(configPda().address, true)],
    data: new Writer().bytes(discriminatorOf("set_fee_per_receiver")).u64(args.lamports).finish(),
  };
}

/** `set_max_fee`. New SOL drops only; zero is no cap; at most `MAX_SOL_FEE_LAMPORTS`. */
export function setMaxFeeInstruction(args: {
  readonly admin: Pubkey;
  readonly lamports: bigint;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, false, true), meta(configPda().address, true)],
    data: new Writer().bytes(discriminatorOf("set_max_fee")).u64(args.lamports).finish(),
  };
}

/** `revoke_binder`. The admin or the guardian signs; every handle claim stops at once. */
export function revokeBinderInstruction(args: { readonly signer: Pubkey }): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.signer, false, true), meta(configPda().address, true)],
    data: discriminatorOf("revoke_binder"),
  };
}

/** 6.11, `set_paused`. Blocks new drops only; existing drops keep claiming. */
export function setPausedInstruction(args: {
  readonly admin: Pubkey;
  readonly paused: boolean;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [meta(args.admin, false, true), meta(configPda().address, true)],
    data: new Writer().bytes(discriminatorOf("set_paused")).bool(args.paused).finish(),
  };
}

/**
 * 6.1. The relayer signs and pays the rent. A token drop passes the mint, the vault
 * (the drop's associated token account, which the program creates), the mint's token program
 * and the ATA program; a SOL drop leaves the four slots absent.
 */
export function createDropInstruction(args: {
  readonly relayer: Pubkey;
  readonly drop: Pubkey;
  readonly bitmap: Pubkey;
  readonly params: CreateParams;
  readonly token?: { readonly mint: Pubkey; readonly vault: Pubkey; readonly tokenProgram: Pubkey };
}): Instruction {
  const token = args.token;
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [
      meta(args.relayer, true, true),
      meta(configPda().address, false),
      meta(args.drop, true),
      meta(args.bitmap, true),
      // create_drop has four SPL slots, not five: no `*_ata` account.
      ...(token === undefined
        ? [absent(), absent(), absent(), absent()]
        : [
            meta(token.mint, false),
            meta(token.vault, true),
            meta(token.tokenProgram, false),
            meta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
          ]),
      systemProgram(),
    ],
    data: new Writer()
      .bytes(discriminatorOf("create_drop"))
      .bytes(encodeCreateParams(args.params))
      .finish(),
  };
}

/**
 * 6.2. With a zero fee the fee wallet still has to be passed and match `drop.fee_wallet`. Since
 * the token drop program `activate` has three token slots, `mint`, `vault`
 * and `token_program`, and no fee token account, no ATA program and no system program.
 */
export function activateInstruction(args: {
  readonly caller: Pubkey;
  readonly drop: Pubkey;
  readonly feeWallet: Pubkey;
  readonly token?: DropToken;
}): Instruction {
  const token = args.token;
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [
      meta(args.caller, true, true),
      meta(args.drop, true),
      meta(args.feeWallet, true),
      // Read only here: `activate` reads the vault balance and moves no token.
      ...(token === undefined
        ? [absent(), absent(), absent()]
        : [meta(token.mint, false), meta(token.vault, false), meta(token.tokenProgram, false)]),
    ],
    data: discriminatorOf("activate"),
  };
}

/** 6.3. `recipient` is bound by the proof, not by the caller. */
export function claimInstruction(args: {
  readonly caller: Pubkey;
  readonly drop: Pubkey;
  readonly bitmap: Pubkey;
  readonly recipient: Pubkey;
  readonly index: number;
  readonly amount: bigint;
  readonly proof: readonly Uint8Array[];
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [
      meta(args.caller, true, true),
      meta(args.drop, true),
      meta(args.bitmap, true),
      meta(args.recipient, true),
      ...noSplAccounts(),
      systemProgram(),
    ],
    data: new Writer()
      .bytes(discriminatorOf("claim"))
      .u32(args.index)
      .u64(args.amount)
      .vec32(args.proof)
      .finish(),
  };
}

/**
 * The accounts in the IDL order: `caller`, `config`, `drop`, `bitmap`, `recipient`, the five
 * SPL slots (absent for a SOL drop; the receiver's token account for a token drop, which the
 * claim creates when missing), the instructions sysvar, the system program. The drop is
 * at position 2, not 1 as in every other drop instruction, which the relayer's guard 3 knows.
 */
export function claimHandleInstruction(args: {
  readonly caller: Pubkey;
  readonly drop: Pubkey;
  readonly bitmap: Pubkey;
  readonly recipient: Pubkey;
  readonly index: number;
  readonly xId: bigint;
  readonly amount: bigint;
  readonly proof: readonly Uint8Array[];
  readonly token?: DropToken;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [
      meta(args.caller, true, true),
      meta(configPda().address, false),
      meta(args.drop, true),
      meta(args.bitmap, true),
      meta(args.recipient, true),
      ...splAccounts(args.token, args.recipient),
      meta(INSTRUCTIONS_SYSVAR_ID, false),
      systemProgram(),
    ],
    data: new Writer()
      .bytes(discriminatorOf("claim_handle"))
      .u32(args.index)
      .u64(args.xId)
      .u64(args.amount)
      .vec32(args.proof)
      .finish(),
  };
}

/**
 * The native Ed25519 check with its data as `ed25519InstructionData` builds it. No
 * accounts: every offset points into this instruction's own data.
 */
export function ed25519Instruction(data: Uint8Array): Instruction {
  return { programId: ED25519_PROGRAM_ID, keys: [], data };
}

export function isEd25519Instruction(ix: Instruction): boolean {
  return pubkeyEquals(ix.programId, ED25519_PROGRAM_ID);
}

interface SettleArgs {
  readonly caller: Pubkey;
  readonly drop: Pubkey;
  readonly refundRecipient: Pubkey;
  /** A token drop: the tokens go to `refund_recipient`'s token account, made when missing. */
  readonly token?: DropToken;
}

function settleInstruction(name: "refund" | "cancel_unfunded", args: SettleArgs): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [
      meta(args.caller, true, true),
      meta(args.drop, true),
      meta(args.refundRecipient, true),
      ...splAccounts(args.token, args.refundRecipient),
      systemProgram(),
    ],
    data: discriminatorOf(name),
  };
}

/** 6.7. After the claim deadline, everything left goes to `drop.refund_recipient`. */
export function refundInstruction(args: SettleArgs): Instruction {
  return settleInstruction("refund", args);
}

/** 6.6. After the funding deadline with no activation, whatever arrived goes back. */
export function cancelUnfundedInstruction(args: SettleArgs): Instruction {
  return settleInstruction("cancel_unfunded", args);
}

/** 6.10. Rent to `drop.rent_payer`, leftovers to `drop.refund_recipient`, never to the caller. */
export function closeDropInstruction(args: {
  readonly caller: Pubkey;
  readonly drop: Pubkey;
  readonly bitmap: Pubkey;
  readonly rentPayer: Pubkey;
  readonly refundRecipient: Pubkey;
  readonly token?: DropToken;
}): Instruction {
  return {
    programId: DROPCHAD_PROGRAM_ID,
    keys: [
      meta(args.caller, true, true),
      meta(args.drop, true),
      meta(args.bitmap, true),
      meta(args.rentPayer, true),
      meta(args.refundRecipient, true),
      ...splAccounts(args.token, args.refundRecipient),
      systemProgram(),
    ],
    data: discriminatorOf("close_drop"),
  };
}

// ---------------------------------------------------------------------------
// compute budget, the one other program the relayer may address
// ---------------------------------------------------------------------------

/** `SetComputeUnitLimit`, discriminant 2, u32. */
export function setComputeUnitLimit(units: number): Instruction {
  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data: new Writer().u8(2).u32(units).finish(),
  };
}

/** `SetComputeUnitPrice`, discriminant 3, u64 micro lamports per unit., zero on devnet. */
export function setComputeUnitPrice(microLamports: bigint): Instruction {
  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data: new Writer().u8(3).u64(microLamports).finish(),
  };
}

export function isComputeBudgetInstruction(ix: Instruction): boolean {
  return pubkeyEquals(ix.programId, COMPUTE_BUDGET_PROGRAM_ID);
}

export function isDropchadInstruction(ix: Instruction): boolean {
  return pubkeyEquals(ix.programId, DROPCHAD_PROGRAM_ID);
}
