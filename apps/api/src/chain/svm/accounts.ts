/**
 * Decoding the program's accounts and events. section 5 and 11.
 *
 * Two checks before a single field is read: the account is owned by **our** program id,
 * and its first eight bytes are the discriminator of the type we expect. A fake `Drop` with the
 * right bytes under another owner fails the first; a `Config` passed where a `Drop` was expected
 * fails the second. The indexer will apply the same two checks, S-, S-.
 *
 * Layouts follow the IDL field order. Borsh: little endian integers, a `bool` is one byte, an
 * enum with unit variants is one byte, `Pubkey` and `[u8; 32]` are 32 raw bytes. The sizes are
 * pinned by a test against the numbers in.
 */
import { dropchadIdl } from "@dropchad/shared";

import { DROPCHAD_PROGRAM_ID, SYSVAR_OWNER_ID, pubkeyEquals, type Pubkey } from "./pubkey.js";
import type { AccountInfo } from "./rpc.js";

export type AccountName = (typeof dropchadIdl.accounts)[number]["name"];
export type EventName = (typeof dropchadIdl.events)[number]["name"];

export function accountDiscriminator(name: AccountName): Uint8Array {
  const entry = dropchadIdl.accounts.find((a) => a.name === name);
  if (entry === undefined) throw new Error(`no account ${name} in the idl`);
  return new Uint8Array(entry.discriminator);
}

export function eventDiscriminator(name: EventName): Uint8Array {
  const entry = dropchadIdl.events.find((e) => e.name === name);
  if (entry === undefined) throw new Error(`no event ${name} in the idl`);
  return new Uint8Array(entry.discriminator);
}

/** non-normative but pinned: a layout change must be a design change. */
/** `Config` before handle mode; devnet holds this until `migrate_config`. */
export const CONFIG_ACCOUNT_BYTES = 116;
/** `Config` after handle mode. */
export const CONFIG_ACCOUNT_BYTES_HANDLE = 253;
/** `Drop` before handle mode. Devnet drops of this size are lost at the upgrade. */
export const DROP_ACCOUNT_BYTES = 360;
/** `Drop` after handle mode, the 64 byte reserved tail. */
export const DROP_ACCOUNT_BYTES_HANDLE = 424;
export const BITMAP_ACCOUNT_BYTES = 1291;
export const BITMAP_BYTES = 1250;

/** the same four values as the EVM `status`. */
export const SVM_STATUS_CREATED = 0;
export const SVM_STATUS_ACTIVE = 1;
export const SVM_STATUS_FINALIZED = 2;
export const SVM_STATUS_CANCELLED = 3;

export class AccountDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDecodeError";
  }
}

class Reader {
  private offset = 8; // past the discriminator
  constructor(private readonly bytes: Uint8Array) {}

  private view(length: number): DataView {
    if (this.offset + length > this.bytes.length) throw new AccountDecodeError("account too short");
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, length);
    this.offset += length;
    return view;
  }
  pubkey(): Pubkey {
    if (this.offset + 32 > this.bytes.length) throw new AccountDecodeError("account too short");
    const out = this.bytes.slice(this.offset, this.offset + 32);
    this.offset += 32;
    return out;
  }
  bytes32(): Uint8Array {
    return this.pubkey();
  }
  u8(): number {
    return this.view(1).getUint8(0);
  }
  u16(): number {
    return this.view(2).getUint16(0, true);
  }
  u32(): number {
    return this.view(4).getUint32(0, true);
  }
  u64(): bigint {
    return this.view(8).getBigUint64(0, true);
  }
  i64(): bigint {
    return this.view(8).getBigInt64(0, true);
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  rest(): Uint8Array {
    return this.bytes.slice(this.offset);
  }
  get position(): number {
    return this.offset;
  }
}

function checked(
  info: AccountInfo,
  name: AccountName,
  expectedBytes: number | readonly number[],
): Reader {
  if (!pubkeyEquals(info.owner, DROPCHAD_PROGRAM_ID)) {
    throw new AccountDecodeError(`${name} account is not owned by the dropchad program`);
  }
  const disc = accountDiscriminator(name);
  if (info.data.length < 8 || !disc.every((b, i) => info.data[i] === b)) {
    throw new AccountDecodeError(`account does not carry the ${name} discriminator`);
  }
  // Two sizes are legal while devnet moves to handle mode: the new api must read both, so it
  // can go live before `migrate_config` finding.
  const allowed = typeof expectedBytes === "number" ? [expectedBytes] : expectedBytes;
  if (!allowed.includes(info.data.length)) {
    throw new AccountDecodeError(
      `${name} account is ${String(info.data.length)} bytes, expected ${allowed.join(" or ")}`,
    );
  }
  return new Reader(info.data);
}

/** 5.1. */
export interface ConfigAccount {
  readonly admin: Pubkey;
  readonly relayer: Pubkey;
  readonly feeWallet: Pubkey;
  readonly defaultFeeBps: number;
  readonly paused: boolean;
  readonly chainId: bigint;
  readonly bump: number;
  /** `null` on a 116 byte `Config` that predates handle mode. */
  readonly handle: ConfigHandleFields | null;
}

/** the fields after `bump`. */
export interface ConfigHandleFields {
  readonly binder: Pubkey;
  readonly binderRevoked: boolean;
  readonly guardian: Pubkey;
  readonly minFeeLamports: bigint;
  /** from the old reserved bytes: zero on a `Config` from before the upgrade, off. */
  readonly minFeePerReceiverLamports: bigint;
  /** zero is no cap. */
  readonly maxFeeLamports: bigint;
}

export function decodeConfig(info: AccountInfo): ConfigAccount {
  const r = checked(info, "Config", [CONFIG_ACCOUNT_BYTES, CONFIG_ACCOUNT_BYTES_HANDLE]);
  const base = {
    admin: r.pubkey(),
    relayer: r.pubkey(),
    feeWallet: r.pubkey(),
    defaultFeeBps: r.u16(),
    paused: r.bool(),
    chainId: r.u64(),
    bump: r.u8(),
  };
  if (info.data.length === CONFIG_ACCOUNT_BYTES) return { ...base, handle: null };
  return {
    ...base,
    handle: {
      binder: r.pubkey(),
      binderRevoked: r.bool(),
      guardian: r.pubkey(),
      minFeeLamports: r.u64(),
      minFeePerReceiverLamports: r.u64(),
      maxFeeLamports: r.u64(),
    },
  };
}

/** 5.2 to 5.4, every field. */
export interface DropAccount {
  readonly asset: Pubkey;
  readonly vault: Pubkey;
  readonly merkleRoot: Uint8Array;
  readonly manifestHash: Uint8Array;
  readonly totalEntitlements: bigint;
  readonly grossRequired: bigint;
  readonly feeAmount: bigint;
  readonly feeWallet: Pubkey;
  readonly refundRecipient: Pubkey;
  readonly fundingDeadline: bigint;
  readonly claimPeriod: number;
  readonly creatorCommitment: Uint8Array;
  readonly nonce: bigint;
  readonly leafCount: number;
  readonly chainId: bigint;
  readonly rentPayer: Pubkey;
  readonly createdAt: bigint;
  readonly bump: number;
  readonly bitmapBump: number;
  readonly activatedAt: bigint;
  readonly claimDeadline: bigint;
  readonly status: number;
  readonly totalClaimed: bigint;
  readonly claimedCount: number;
  readonly closed: boolean;
  /** 5.2 fields 20 to 22, token drops. Zero on a SOL drop and a 360 byte one. */
  readonly solFeeLamports: bigint;
  readonly accountBudgetLamports: bigint;
  readonly accountBudgetUsed: bigint;
  /** The account's own lamports. The spendable balance is this minus the rent minimum. */
  readonly lamports: bigint;
}

export function decodeDrop(info: AccountInfo): DropAccount {
  // A 424 byte drop: the three token fields, then `reserved` 40, never read.
  const r = checked(info, "Drop", [DROP_ACCOUNT_BYTES, DROP_ACCOUNT_BYTES_HANDLE]);
  const tail = info.data.length === DROP_ACCOUNT_BYTES_HANDLE;
  return {
    asset: r.pubkey(),
    vault: r.pubkey(),
    merkleRoot: r.bytes32(),
    manifestHash: r.bytes32(),
    totalEntitlements: r.u64(),
    grossRequired: r.u64(),
    feeAmount: r.u64(),
    feeWallet: r.pubkey(),
    refundRecipient: r.pubkey(),
    fundingDeadline: r.i64(),
    claimPeriod: r.u32(),
    creatorCommitment: r.bytes32(),
    nonce: r.u64(),
    leafCount: r.u32(),
    chainId: r.u64(),
    rentPayer: r.pubkey(),
    createdAt: r.i64(),
    bump: r.u8(),
    bitmapBump: r.u8(),
    activatedAt: r.i64(),
    claimDeadline: r.i64(),
    status: r.u8(),
    totalClaimed: r.u64(),
    claimedCount: r.u32(),
    closed: r.bool(),
    // In order: these read after `closed`, the object literal runs top to bottom.
    solFeeLamports: tail ? r.u64() : 0n,
    accountBudgetLamports: tail ? r.u64() : 0n,
    accountBudgetUsed: tail ? r.u64() : 0n,
    lamports: info.lamports,
  };
}

/** 5.5. `bits` is the raw 1,250 bytes; `isClaimed` reads one bit the way the program does. */
export interface ClaimBitmapAccount {
  readonly drop: Pubkey;
  readonly bump: number;
  readonly bits: Uint8Array;
}

export function decodeClaimBitmap(info: AccountInfo): ClaimBitmapAccount {
  const r = checked(info, "ClaimBitmap", BITMAP_ACCOUNT_BYTES);
  const drop = r.pubkey();
  const bump = r.u8();
  const bits = r.rest();
  if (bits.length !== BITMAP_BYTES) throw new AccountDecodeError("bitmap has the wrong length");
  return { drop, bump, bits };
}

/**
 * The Clock sysvar is `#[repr(C)]`, five 8 byte fields: `slot`, `epoch_start_timestamp`,
 * `epoch`, `leader_schedule_epoch`, `unix_timestamp`, 40 bytes. Read from `solana-clock` 4.0.0.
 */
export const CLOCK_SYSVAR_BYTES = 40;

/** `Clock::unix_timestamp`, the chain's own time, the one every deadline is checked against. */
export function decodeClockUnixTimestamp(info: AccountInfo): bigint {
  if (!pubkeyEquals(info.owner, SYSVAR_OWNER_ID)) {
    throw new AccountDecodeError("clock account is not owned by the sysvar program");
  }
  if (info.data.length !== CLOCK_SYSVAR_BYTES) {
    throw new AccountDecodeError(
      `clock account is ${String(info.data.length)} bytes, expected ${String(CLOCK_SYSVAR_BYTES)}`,
    );
  }
  return new DataView(info.data.buffer, info.data.byteOffset + 32, 8).getBigInt64(0, true);
}

/** `bits[i / 8] & (1 << (i % 8))`. */
export function isClaimedBit(bits: Uint8Array, index: number): boolean {
  const byte = bits[index >> 3];
  if (byte === undefined) return false;
  return (byte & (1 << (index & 7))) !== 0;
}

// ---------------------------------------------------------------------------
// events, out of the transaction log
// ---------------------------------------------------------------------------

/** 11.1, `Claimed { drop, index, recipient, amount }`. */
export interface ClaimedEventSvm {
  readonly drop: Pubkey;
  readonly index: number;
  readonly recipient: Pubkey;
  readonly amount: bigint;
}

const PROGRAM_DATA_PREFIX = "Program data: ";

/**
 * Every `Claimed` event our program emitted in a transaction, in log order.
 *
 * Anchor writes an event as `Program data: <base64>` where the bytes are the event discriminator
 * followed by the borsh fields. Only events whose `drop` field is the drop we asked about count,
 * On Solana a transaction with a failing claim writes nothing, so a successful
 * transaction carries one event per claim instruction; the events are still read rather than
 * assumed, the same rule the EVM worker follows.
 */
export function decodeClaimedEvents(
  logMessages: readonly string[],
  drop: Pubkey,
): ClaimedEventSvm[] {
  const disc = eventDiscriminator("Claimed");
  const out: ClaimedEventSvm[] = [];
  for (const line of logMessages) {
    if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(line.slice(PROGRAM_DATA_PREFIX.length), "base64"));
    } catch {
      continue;
    }
    if (bytes.length !== 8 + 32 + 4 + 32 + 8) continue;
    if (!disc.every((b, i) => bytes[i] === b)) continue;
    const r = new Reader(bytes);
    const event: ClaimedEventSvm = {
      drop: r.pubkey(),
      index: r.u32(),
      recipient: r.pubkey(),
      amount: r.u64(),
    };
    if (pubkeyEquals(event.drop, drop)) out.push(event);
  }
  return out;
}

/** 11.1, `HandleClaimed { drop, index, x_id, recipient, amount }` on Solana. */
export interface HandleClaimedEventSvm {
  readonly drop: Pubkey;
  readonly index: number;
  readonly xId: bigint;
  readonly recipient: Pubkey;
  readonly amount: bigint;
}

/** Every `HandleClaimed` our program emitted for this drop, in log order. As `Claimed` above. */
export function decodeHandleClaimedEvents(
  logMessages: readonly string[],
  drop: Pubkey,
): HandleClaimedEventSvm[] {
  const disc = eventDiscriminator("HandleClaimed");
  const out: HandleClaimedEventSvm[] = [];
  for (const line of logMessages) {
    if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(line.slice(PROGRAM_DATA_PREFIX.length), "base64"));
    } catch {
      continue;
    }
    if (bytes.length !== 8 + 32 + 4 + 8 + 32 + 8) continue;
    if (!disc.every((b, i) => bytes[i] === b)) continue;
    const r = new Reader(bytes);
    const event: HandleClaimedEventSvm = {
      drop: r.pubkey(),
      index: r.u32(),
      xId: r.u64(),
      recipient: r.pubkey(),
      amount: r.u64(),
    };
    if (pubkeyEquals(event.drop, drop)) out.push(event);
  }
  return out;
}

/** The `Custom(n)` code inside a runtime error, so a refusal can name the program error. */
export function programErrorName(err: unknown): string | null {
  const record = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : null;
  const inner: unknown = record?.["InstructionError"];
  if (!Array.isArray(inner)) return null;
  const detail: unknown = (inner as unknown[])[1];
  const custom =
    typeof detail === "object" && detail !== null
      ? (detail as Record<string, unknown>)["Custom"]
      : undefined;
  if (typeof custom !== "number") return typeof detail === "string" ? detail : null;
  const named = dropchadIdl.errors.find((e) => e.code === custom);
  return named === undefined ? `Custom(${String(custom)})` : named.name;
}
