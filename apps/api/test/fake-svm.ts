/**
 * A fake Solana cluster running the dropchad program's rules in memory.
 *
 * The twin of `fake-chain.ts`, and like it deliberately **not** a mock that echoes: it decodes
 * the transaction bytes the relayer actually signed, derives the PDAs itself, checks the merkle
 * proof with the shared leaf hashing, keeps a real bitmap, writes `Drop` accounts in the real
 * layout and logs real `Program data:` events. So the api's transaction serialisation, its
 * instruction encoding, its account decoding and its event parsing are all exercised for real.
 *
 * What it does not simulate: compute units (a test may set `unitsOverride`), the rent rule of
 * for fresh wallets, the token programs beyond a token account's balance (:
 * the vault, the receiver's and the refund recipient's associated token accounts, created when
 * missing, the rent pay back of), and the upgrade authority check of `initialize_config`. Those belong to the 201 LiteSVM tests and to
 * `svm-litesvm.integration.test.ts`.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { handleLeafHash, leafHash, verifyProof } from "@dropchad/shared";
import { bytesToHex, keccak256, toBytes, toHex } from "viem";

import {
  BITMAP_ACCOUNT_BYTES,
  BITMAP_BYTES,
  CONFIG_ACCOUNT_BYTES,
  CONFIG_ACCOUNT_BYTES_HANDLE,
  DROP_ACCOUNT_BYTES_HANDLE,
  SVM_STATUS_ACTIVE,
  SVM_STATUS_CANCELLED,
  SVM_STATUS_CREATED,
  SVM_STATUS_FINALIZED,
  accountDiscriminator,
  eventDiscriminator,
} from "../src/chain/svm/accounts.js";
import { instructionNameOf } from "../src/chain/svm/instructions.js";
import { bitmapPda, configPda, dropPda, findProgramAddress } from "../src/chain/svm/pda.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  DROPCHAD_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  pubkeyEquals,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import type { AccountInfo, Commitment, SvmRpc, TransactionMeta } from "../src/chain/svm/rpc.js";
import type { Message } from "../src/chain/svm/transaction.js";

export const FAKE_SVM_CHAIN_ID = 103n;

/** The two token programs and the ATA program, written out here, not imported. */
export const FAKE_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const FAKE_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const FAKE_ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** the program's `MAX_SOL_FEE_LAMPORTS`. */
const FAKE_MAX_SOL_FEE = 1_000_000_000n;
/** the mints allowed a freeze authority. */
const FAKE_FREEZE_EXCEPTIONS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
]);

/** The associated token account the way the ATA program finds it:, token program, mint. */
export function fakeAta(owner: Pubkey, mint: Pubkey, tokenProgram: Pubkey): Pubkey {
  return findProgramAddress([owner, tokenProgram, mint], pubkeyFromBase58(FAKE_ATA_PROGRAM))
    .address;
}
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/**
 * A token account in the base layout both token programs share: mint at 0, owner at 32, amount
 * at 64, state at 108 (1, initialised). Token-2022 adds the account type at 165 and the empty
 * `immutableOwner` extension, 170 bytes.
 */
export function encodeTokenAccount(
  mint: Pubkey,
  owner: Pubkey,
  amount: bigint,
  tokenProgram: Pubkey,
): Uint8Array {
  const is2022 = pubkeyToBase58(tokenProgram) === FAKE_TOKEN_2022_PROGRAM;
  const data = new Uint8Array(is2022 ? 170 : 165);
  data.set(mint, 0);
  data.set(owner, 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  if (is2022) {
    data[165] = 2; // AccountType::Account
    data[166] = 7; // ExtensionType::ImmutableOwner, little endian u16, length 0
  }
  return data;
}

function tokenAmountIn(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset).getBigUint64(64, true);
}

/** `(bytes + 128) × 6,960`, today's cluster parameters. */
export function rentFor(bytes: number): bigint {
  return BigInt(bytes + 128) * 6_960n;
}

// ---------------------------------------------------------------------------
// borsh helpers, the fake's own so it does not share code with what it tests
// ---------------------------------------------------------------------------

class Cursor {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array {
    const out = this.bytes.slice(this.offset, this.offset + n);
    if (out.length !== n) throw new Error("short read");
    this.offset += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0] as number;
  }
  u16(): number {
    return new DataView(this.take(2).buffer).getUint16(0, true);
  }
  u32(): number {
    return new DataView(this.take(4).buffer).getUint32(0, true);
  }
  u64(): bigint {
    return new DataView(this.take(8).buffer).getBigUint64(0, true);
  }
  shortvec(): number {
    let len = 0;
    let size = 0;
    for (;;) {
      const byte = this.u8();
      len |= (byte & 0x7f) << (size * 7);
      size += 1;
      if ((byte & 0x80) === 0) return len;
    }
  }
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}
function i64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, true);
  return out;
}
function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}
function u16le(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The inverse of `serializeMessage`, so the fake reads what the relayer really signed. */
export function decodeTransaction(bytes: Uint8Array): {
  signatures: Uint8Array[];
  message: Message;
} {
  const c = new Cursor(bytes);
  const sigCount = c.shortvec();
  const signatures = Array.from({ length: sigCount }, () => c.take(64));
  const header = {
    numRequiredSignatures: c.u8(),
    numReadonlySigned: c.u8(),
    numReadonlyUnsigned: c.u8(),
  };
  const keyCount = c.shortvec();
  const accountKeys = Array.from({ length: keyCount }, () => c.take(32));
  const recentBlockhash = c.take(32);
  const ixCount = c.shortvec();
  const instructions = Array.from({ length: ixCount }, () => {
    const programIdIndex = c.u8();
    const accountCount = c.shortvec();
    const accountIndexes = [...c.take(accountCount)];
    const dataLength = c.shortvec();
    const data = c.take(dataLength);
    return { programIdIndex, accountIndexes, data };
  });
  if (c.offset !== bytes.length) throw new Error("trailing bytes in transaction");
  return { signatures, message: { header, accountKeys, recentBlockhash, instructions } };
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export interface FakeConfig {
  admin: Pubkey;
  relayer: Pubkey;
  feeWallet: Pubkey;
  defaultFeeBps: number;
  paused: boolean;
  chainId: bigint;
  /** Present means the migrated 253 byte layout. */
  handle?: {
    binder: Pubkey;
    binderRevoked: boolean;
    minFeeLamports: bigint;
    /** the two fields cut from the reserved bytes. Zero is off. */
    minFeePerReceiverLamports?: bigint;
    maxFeeLamports?: bigint;
  };
}

export interface FakeDrop {
  asset: Pubkey;
  vault: Pubkey;
  merkleRoot: Uint8Array;
  manifestHash: Uint8Array;
  totalEntitlements: bigint;
  grossRequired: bigint;
  feeAmount: bigint;
  feeWallet: Pubkey;
  refundRecipient: Pubkey;
  fundingDeadline: bigint;
  claimPeriod: number;
  creatorCommitment: Uint8Array;
  nonce: bigint;
  leafCount: number;
  chainId: bigint;
  rentPayer: Pubkey;
  createdAt: bigint;
  bump: number;
  bitmapBump: number;
  activatedAt: bigint;
  claimDeadline: bigint;
  status: number;
  totalClaimed: bigint;
  claimedCount: number;
  closed: boolean;
  /** 5.2 fields 20 to 22, token drops. Absent reads zero, a SOL drop. */
  solFeeLamports?: bigint;
  accountBudgetLamports?: bigint;
  accountBudgetUsed?: bigint;
}

export function encodeDropAccount(d: FakeDrop): Uint8Array {
  const bytes = concat([
    accountDiscriminator("Drop"),
    d.asset,
    d.vault,
    d.merkleRoot,
    d.manifestHash,
    u64le(d.totalEntitlements),
    u64le(d.grossRequired),
    u64le(d.feeAmount),
    d.feeWallet,
    d.refundRecipient,
    i64le(d.fundingDeadline),
    u32le(d.claimPeriod),
    d.creatorCommitment,
    u64le(d.nonce),
    u32le(d.leafCount),
    u64le(d.chainId),
    d.rentPayer,
    i64le(d.createdAt),
    new Uint8Array([d.bump, d.bitmapBump]),
    i64le(d.activatedAt),
    i64le(d.claimDeadline),
    new Uint8Array([d.status]),
    u64le(d.totalClaimed),
    u32le(d.claimedCount),
    new Uint8Array([d.closed ? 1 : 0]),
    // The 64 byte tail since handle mode: the three token fields of 5.2, zero on a SOL
    // drop, then `reserved` 40. 424 bytes, what the program creates.
    u64le(d.solFeeLamports ?? 0n),
    u64le(d.accountBudgetLamports ?? 0n),
    u64le(d.accountBudgetUsed ?? 0n),
    new Uint8Array(40),
  ]);
  if (bytes.length !== DROP_ACCOUNT_BYTES_HANDLE)
    throw new Error(`drop is ${String(bytes.length)} bytes`);
  return bytes;
}

export function encodeConfigAccount(c: FakeConfig, bump: number): Uint8Array {
  const bytes = concat([
    accountDiscriminator("Config"),
    c.admin,
    c.relayer,
    c.feeWallet,
    u16le(c.defaultFeeBps),
    new Uint8Array([c.paused ? 1 : 0]),
    u64le(c.chainId),
    new Uint8Array([bump]),
    ...(c.handle === undefined
      ? []
      : [
          c.handle.binder,
          new Uint8Array([c.handle.binderRevoked ? 1 : 0]),
          new Uint8Array(32), // guardian, none
          u64le(c.handle.minFeeLamports),
          u64le(c.handle.minFeePerReceiverLamports ?? 0n),
          u64le(c.handle.maxFeeLamports ?? 0n),
          new Uint8Array(48), // reserved
        ]),
  ]);
  const size = c.handle === undefined ? CONFIG_ACCOUNT_BYTES : CONFIG_ACCOUNT_BYTES_HANDLE;
  if (bytes.length !== size) throw new Error("config size");
  return bytes;
}

export function encodeBitmapAccount(drop: Pubkey, bump: number, bits: Uint8Array): Uint8Array {
  const bytes = concat([accountDiscriminator("ClaimBitmap"), drop, new Uint8Array([bump]), bits]);
  if (bytes.length !== BITMAP_ACCOUNT_BYTES) throw new Error("bitmap size");
  return bytes;
}

interface Account {
  lamports: bigint;
  owner: Pubkey;
  data: Uint8Array;
}

class ProgramError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Anchor error codes, so the fake fails the way the program does. */
const CODES: Record<string, number> = {
  NotRelayer: 6005,
  CreationPaused: 6006,
  WrongStatus: 6018,
  FundingExpired: 6019,
  Underfunded: 6020,
  WrongFeeWallet: 6021,
  AssetAccountsMismatch: 6022,
  ClaimWindowClosed: 6023,
  BadIndex: 6024,
  AlreadyClaimed: 6025,
  BadProof: 6026,
  FundingStillOpen: 6028,
  ClaimWindowOpen: 6029,
  WrongRefundRecipient: 6030,
  NotFinished: 6032,
  AlreadyClosed: 6034,
  WrongRentPayer: 6035,
  BadXId: 6038,
  NoBinder: 6039,
  BinderIsRevoked: 6040,
  BadBinding: 6041,
};

/** the tag of a binding message. The fake builds the message itself, byte by byte. */
const BINDING_TAG_BYTES = toBytes(keccak256(toHex("dropchad:binding:v1")));
const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";

const u256be = (value: bigint): Uint8Array => toBytes(value, { size: 32 });

/**
 * The native Ed25519 program as the runtime runs it for: one signature, offsets pointing
 * into this instruction, and the signature must verify. Anything else fails the transaction.
 */
function verifyEd25519(data: Uint8Array): { key: Uint8Array; message: Uint8Array } {
  const u16 = (at: number) => (data[at] as number) | ((data[at + 1] as number) << 8);
  if (data.length < 16 || data[0] !== 1) throw new ProgramError("PrecompileFailure");
  const [sigOffset, sigIx, keyOffset, keyIx, msgOffset, msgSize, msgIx] = [
    2, 4, 6, 8, 10, 12, 14,
  ].map(u16);
  const here = [sigIx, keyIx, msgIx].every((ix) => ix === 0xffff);
  const signature = data.slice(sigOffset, (sigOffset as number) + 64);
  const key = data.slice(keyOffset, (keyOffset as number) + 32);
  const message = data.slice(msgOffset, (msgOffset as number) + (msgSize as number));
  if (!here || signature.length !== 64 || key.length !== 32 || message.length !== msgSize) {
    throw new ProgramError("PrecompileFailure");
  }
  if (!ed25519.verify(signature, message, key)) throw new ProgramError("PrecompileFailure");
  return { key, message };
}

export interface FakeSvmOptions {
  readonly relayer: Pubkey;
  readonly feeWallet?: Pubkey;
  /** Leave the config out, to test the gate. */
  readonly withConfig?: boolean;
  /** `config.default_fee_bps`. Zero unless a test says otherwise. */
  readonly defaultFeeBps?: number;
  /** A migrated 253 byte `Config` with this binder. Absent: the old 116 byte one. */
  readonly binder?: Pubkey;
  /** The fee fields of a 253 byte `Config`. Zero unless a test says otherwise. */
  readonly minFeeLamports?: bigint;
  readonly minFeePerReceiverLamports?: bigint;
  readonly maxFeeLamports?: bigint;
  readonly relayerLamports?: bigint;
}

/** What a test may change in a drop right after the fake creates it, to make the read back lie. */
export type FakeTamper = (drop: FakeDrop) => FakeDrop;

/**
 * The cluster. Accounts by base58 key, a clock, a block height, and the transactions it saw.
 */
export class FakeSvm {
  readonly accounts = new Map<string, Account>();
  readonly transactions = new Map<string, TransactionMeta>();
  /** Every dropchad instruction that ran, by name, in order. */
  readonly executed: string[] = [];
  /** Claim indexes that must fail, like a recipient the runtime rejects. */
  readonly failingIndexes = new Set<number>();
  clock = 1_800_000_000n;
  blockHeight = 1_000;
  /**
   * What a `finalized` read sees, when it lags behind `confirmed`. `null`, the default, means
   * finalized has caught up and both read the live accounts. Set it from `snapshot()`.
   */
  finalizedView: Map<string, Account> | null = null;
  readonly relayer: Pubkey;
  readonly feeWallet: Pubkey;
  /** Applied to the next drop `create_drop` writes. */
  tamperCreate: FakeTamper | null = null;
  /** Every transaction sent for real, as signed, in order. */
  readonly sent: Uint8Array[] = [];
  /** The compute units every transaction reports, when a test wants a number. */
  unitsOverride: number | null = null;

  constructor(options: FakeSvmOptions) {
    this.relayer = options.relayer;
    this.feeWallet = options.feeWallet ?? options.relayer;
    this.setLamports(options.relayer, options.relayerLamports ?? 500_000_000n);
    if (options.withConfig !== false) {
      const pda = configPda();
      const config: FakeConfig = {
        admin: options.relayer,
        relayer: options.relayer,
        feeWallet: this.feeWallet,
        defaultFeeBps: options.defaultFeeBps ?? 0,
        paused: false,
        chainId: FAKE_SVM_CHAIN_ID,
        ...(options.binder === undefined
          ? {}
          : {
              handle: {
                binder: options.binder,
                binderRevoked: false,
                minFeeLamports: options.minFeeLamports ?? 0n,
                minFeePerReceiverLamports: options.minFeePerReceiverLamports ?? 0n,
                maxFeeLamports: options.maxFeeLamports ?? 0n,
              },
            }),
      };
      this.accounts.set(pubkeyToBase58(pda.address), {
        lamports: rentFor(
          config.handle === undefined ? CONFIG_ACCOUNT_BYTES : CONFIG_ACCOUNT_BYTES_HANDLE,
        ),
        owner: DROPCHAD_PROGRAM_ID,
        data: encodeConfigAccount(config, pda.bump),
      });
    }
  }

  // --- helpers the tests use -------------------------------------------------------------

  lamportsOf(key: Pubkey): bigint {
    return this.accounts.get(pubkeyToBase58(key))?.lamports ?? 0n;
  }

  setLamports(key: Pubkey, lamports: bigint): void {
    const id = pubkeyToBase58(key);
    const existing = this.accounts.get(id);
    if (existing === undefined) {
      this.accounts.set(id, { lamports, owner: SYSTEM_PROGRAM_ID, data: new Uint8Array() });
    } else {
      existing.lamports = lamports;
    }
  }

  /** Any account, a mint for example, with its owner and bytes. */
  putAccount(
    key: Pubkey | string,
    owner: Pubkey | string,
    data: Uint8Array,
    lamports?: bigint,
  ): void {
    const id = typeof key === "string" ? key : pubkeyToBase58(key);
    this.accounts.set(id, {
      lamports: lamports ?? rentFor(data.length),
      owner: typeof owner === "string" ? pubkeyFromBase58(owner) : owner,
      data,
    });
  }

  ownerOf(key: Pubkey): Pubkey | null {
    return this.accounts.get(pubkeyToBase58(key))?.owner ?? null;
  }

  /** A plain transfer into a drop, 3.3. */
  fund(drop: Pubkey, lamports: bigint): void {
    this.setLamports(drop, this.lamportsOf(drop) + lamports);
  }

  /** The balance of a token account, `null` when it does not exist. */
  tokenAmountOf(key: Pubkey): bigint | null {
    const account = this.accounts.get(pubkeyToBase58(key));
    return account === undefined ? null : tokenAmountIn(account.data);
  }

  /** A token transfer into an existing token account, the vault for example. */
  mintTokens(account: Pubkey, amount: bigint): void {
    const existing = this.accounts.get(pubkeyToBase58(account));
    if (existing === undefined) throw new Error("no token account");
    new DataView(existing.data.buffer, existing.data.byteOffset).setBigUint64(
      64,
      tokenAmountIn(existing.data) + amount,
      true,
    );
  }

  /** A wallet's associated token account that exists already. Returns its address. */
  putTokenAccount(owner: Pubkey, mint: Pubkey, tokenProgram: Pubkey, amount = 0n): Pubkey {
    const key = fakeAta(owner, mint, tokenProgram);
    const data = encodeTokenAccount(mint, owner, amount, tokenProgram);
    this.accounts.set(pubkeyToBase58(key), {
      lamports: rentFor(data.length),
      owner: tokenProgram,
      data,
    });
    return key;
  }

  drop(key: Pubkey): FakeDrop | null {
    const account = this.accounts.get(pubkeyToBase58(key));
    return account === undefined ? null : decodeFakeDrop(account.data);
  }

  bitmapBits(drop: Pubkey): Uint8Array | null {
    const account = this.accounts.get(pubkeyToBase58(bitmapPda(drop).address));
    return account === undefined ? null : account.data.slice(8 + 33);
  }

  setClaimed(drop: Pubkey, index: number): void {
    const account = this.accounts.get(pubkeyToBase58(bitmapPda(drop).address));
    if (account === undefined) throw new Error("no bitmap");
    const bits = account.data;
    const at = 8 + 33 + (index >> 3);
    bits[at] = (bits[at] as number) | (1 << (index & 7));
  }

  /** `revoke_binder`, or a new `set_binder` clearing it. */
  setBinderRevoked(revoked: boolean): void {
    const pda = configPda();
    const account = this.accounts.get(pubkeyToBase58(pda.address));
    if (account === undefined) throw new Error("no config");
    const cfg = decodeFakeConfig(account.data);
    if (cfg.handle === undefined) throw new Error("config is not migrated");
    account.data = encodeConfigAccount(
      { ...cfg, handle: { ...cfg.handle, binderRevoked: revoked } },
      pda.bump,
    );
  }

  setStatus(drop: Pubkey, status: number): void {
    this.writeDrop(drop, { ...(this.drop(drop) as FakeDrop), status });
  }

  /**
   * Somebody else sent `refund` and `close_drop` first: both are permissionless. The drop
   * is `Finalized` and `closed`, and its bitmap is gone.
   */
  closeByStranger(drop: Pubkey): void {
    this.writeDrop(drop, { ...(this.drop(drop) as FakeDrop), status: 2, closed: true });
    this.accounts.delete(pubkeyToBase58(bitmapPda(drop).address));
  }

  setClaimDeadline(drop: Pubkey, deadline: bigint): void {
    this.writeDrop(drop, { ...(this.drop(drop) as FakeDrop), claimDeadline: deadline });
  }

  private writeDrop(key: Pubkey, d: FakeDrop): void {
    const id = pubkeyToBase58(key);
    const existing = this.accounts.get(id);
    this.accounts.set(id, {
      lamports: existing?.lamports ?? 0n,
      owner: DROPCHAD_PROGRAM_ID,
      data: encodeDropAccount(d),
    });
  }

  snapshot(): Map<string, Account> {
    return new Map(
      [...this.accounts.entries()].map(([k, v]) => [k, { ...v, data: new Uint8Array(v.data) }]),
    );
  }

  restore(snapshot: Map<string, Account>): void {
    this.accounts.clear();
    for (const [k, v] of snapshot) this.accounts.set(k, v);
  }

  // --- running a transaction -----------------------------------------------------------

  /**
   * Run a serialized transaction. Returns the meta the rpc would; a failing instruction rolls
   * every write back, and the fee is still paid.
   */
  run(bytes: Uint8Array): TransactionMeta {
    const { signatures, message } = decodeTransaction(bytes);
    const payer = message.accountKeys[0] as Pubkey;
    const logs: string[] = [];
    const before = this.snapshot();
    const preBalances = message.accountKeys.map((k) => this.lamportsOf(k));
    const fee = LAMPORTS_PER_SIGNATURE * BigInt(signatures.length);
    this.setLamports(payer, this.lamportsOf(payer) - fee);
    let err: unknown = null;

    try {
      message.instructions.forEach((ix, position) => {
        const program = message.accountKeys[ix.programIdIndex] as Pubkey;
        if (pubkeyEquals(program, COMPUTE_BUDGET_PROGRAM_ID)) return;
        const previous = position > 0 ? message.instructions[position - 1] : undefined;
        const previousProgram =
          previous === undefined ? null : (message.accountKeys[previous.programIdIndex] as Pubkey);
        try {
          if (pubkeyToBase58(program) === ED25519_PROGRAM) {
            verifyEd25519(ix.data);
            return;
          }
          if (!pubkeyEquals(program, DROPCHAD_PROGRAM_ID)) {
            throw new ProgramError(`unknown program ${pubkeyToBase58(program)}`);
          }
          const keys = ix.accountIndexes.map((i) => message.accountKeys[i] as Pubkey);
          const signers = new Set(
            message.accountKeys.slice(0, message.header.numRequiredSignatures).map(pubkeyToBase58),
          );
          const ed25519Before =
            previous !== undefined &&
            previousProgram !== null &&
            pubkeyToBase58(previousProgram) === ED25519_PROGRAM
              ? previous.data
              : null;
          this.execute(ix.data, keys, signers, logs, ed25519Before);
        } catch (error) {
          if (!(error instanceof ProgramError)) throw error;
          const code = CODES[error.code];
          err = {
            InstructionError: [position, code === undefined ? error.code : { Custom: code }],
          };
          logs.push(`Program log: AnchorError ${error.code}`);
          throw error;
        }
      });
    } catch {
      // Roll back everything except the fee.
      this.restore(before);
      this.setLamports(payer, this.lamportsOf(payer) - fee);
    }

    this.blockHeight += 1;
    return {
      slot: this.blockHeight,
      blockTime: Number(this.clock),
      fee,
      err,
      logMessages: logs,
      computeUnitsConsumed:
        this.unitsOverride ?? 12_000 * Math.max(1, message.instructions.length - 1),
      preBalances,
      postBalances: message.accountKeys.map((k) => this.lamportsOf(k)),
      accountKeys: message.accountKeys,
    };
  }

  private execute(
    data: Uint8Array,
    keys: Pubkey[],
    signers: Set<string>,
    logs: string[],
    ed25519Before: Uint8Array | null,
  ): void {
    const name = instructionNameOf(data);
    if (name === null) throw new ProgramError("InstructionFallbackNotFound");
    this.executed.push(name);
    const key = (i: number): Pubkey => {
      const k = keys[i];
      if (k === undefined) throw new ProgramError("NotEnoughAccountKeys");
      return k;
    };
    const mustSign = (k: Pubkey) => {
      if (!signers.has(pubkeyToBase58(k))) throw new ProgramError("MissingRequiredSignature");
    };
    const now = this.clock;
    const args = new Cursor(data.slice(8));

    switch (name) {
      case "create_drop": {
        const relayer = key(0);
        mustSign(relayer);
        const config = this.accounts.get(pubkeyToBase58(key(1)));
        if (config === undefined) throw new ProgramError("AccountNotInitialized");
        const cfg = decodeFakeConfig(config.data);
        if (!pubkeyEquals(cfg.relayer, relayer)) throw new ProgramError("NotRelayer");
        if (cfg.paused) throw new ProgramError("CreationPaused");
        const merkleRoot = args.take(32);
        const manifestHash = args.take(32);
        const totalEntitlements = args.u64();
        const leafCount = args.u32();
        const refundRecipient = args.take(32);
        const creatorCommitment = args.take(32);
        const nonce = args.u64();
        const fundingPeriod = args.u32();
        const claimPeriod = args.u32();
        const solFee = args.u64();
        const pda = dropPda(creatorCommitment, nonce);
        if (!pubkeyEquals(pda.address, key(2))) throw new ProgramError("ConstraintSeeds");
        if (this.accounts.has(pubkeyToBase58(pda.address)))
          throw new ProgramError("AccountAlreadyInUse");
        const bitmap = bitmapPda(pda.address);
        if (!pubkeyEquals(bitmap.address, key(3))) throw new ProgramError("ConstraintSeeds");
        // The four SPL slots, 6.1: all absent (the program id) on a SOL drop.
        const isAbsent = (k: Pubkey) => pubkeyEquals(k, DROPCHAD_PROGRAM_ID);
        const token = isAbsent(key(4))
          ? null
          : { mint: key(4), vault: key(5), program: key(6), ataProgram: key(7) };
        // at most 1 SOL on a token drop, zero on a SOL drop.
        if (token === null ? solFee !== 0n : solFee > FAKE_MAX_SOL_FEE)
          throw new ProgramError("SolFeeTooHigh");
        let tokenAccountBytes = 0;
        if (token !== null) {
          // the part the fake knows: the mint's program, the freeze rule, the vault.
          const mintAccount = this.accounts.get(pubkeyToBase58(token.mint));
          const mintProgram = mintAccount === undefined ? null : pubkeyToBase58(mintAccount.owner);
          if (
            mintAccount === undefined ||
            (mintProgram !== FAKE_TOKEN_PROGRAM && mintProgram !== FAKE_TOKEN_2022_PROGRAM)
          )
            throw new ProgramError("AccountOwnedByWrongProgram");
          if (pubkeyToBase58(token.program) !== mintProgram)
            throw new ProgramError("WrongTokenProgram");
          if (pubkeyToBase58(token.ataProgram) !== FAKE_ATA_PROGRAM)
            throw new ProgramError("InvalidProgramId");
          const hasFreeze = mintAccount.data[46] === 1;
          if (hasFreeze && !FAKE_FREEZE_EXCEPTIONS.has(pubkeyToBase58(token.mint)))
            throw new ProgramError("MintHasFreezeAuthority");
          if (!pubkeyEquals(token.vault, fakeAta(pda.address, token.mint, token.program)))
            throw new ProgramError("InvalidSeeds");
          tokenAccountBytes = mintProgram === FAKE_TOKEN_2022_PROGRAM ? 170 : 165;
        }
        const vaultRent = token === null ? 0n : rentFor(tokenAccountBytes);
        const rent = rentFor(DROP_ACCOUNT_BYTES_HANDLE) + rentFor(BITMAP_ACCOUNT_BYTES) + vaultRent;
        if (this.lamportsOf(relayer) < rent) throw new ProgramError("InsufficientFunds");
        this.setLamports(relayer, this.lamportsOf(relayer) - rent);
        if (token !== null) {
          this.accounts.set(pubkeyToBase58(token.vault), {
            lamports: vaultRent,
            owner: token.program,
            data: encodeTokenAccount(token.mint, pda.address, 0n, token.program),
          });
        }
        // written out here on its own, as `sol_drop_fee` in handlers.rs does it: a SOL
        // drop pays min(max(bps fee, flat minimum, per receiver x leaves), cap), a zero cap is no
        // cap; a token drop pays no fee in the token.
        let feeAmount = 0n;
        if (token === null) {
          feeAmount = (totalEntitlements * BigInt(cfg.defaultFeeBps)) / 10_000n;
          const flat = cfg.handle?.minFeeLamports ?? 0n;
          if (flat > feeAmount) feeAmount = flat;
          const perReceiver = (cfg.handle?.minFeePerReceiverLamports ?? 0n) * BigInt(leafCount);
          if (perReceiver > feeAmount) feeAmount = perReceiver;
          const cap = cfg.handle?.maxFeeLamports ?? 0n;
          if (cap !== 0n && feeAmount > cap) feeAmount = cap;
        }
        let drop: FakeDrop = {
          asset: token === null ? new Uint8Array(32) : token.mint,
          vault: token === null ? new Uint8Array(32) : token.vault,
          merkleRoot,
          manifestHash,
          totalEntitlements,
          grossRequired: totalEntitlements + feeAmount,
          feeAmount,
          feeWallet: cfg.feeWallet,
          refundRecipient,
          fundingDeadline: now + BigInt(fundingPeriod),
          claimPeriod,
          creatorCommitment,
          nonce,
          leafCount,
          chainId: cfg.chainId,
          rentPayer: relayer,
          createdAt: now,
          bump: pda.bump,
          bitmapBump: bitmap.bump,
          activatedAt: 0n,
          claimDeadline: 0n,
          status: SVM_STATUS_CREATED,
          totalClaimed: 0n,
          claimedCount: 0,
          closed: false,
          // the program works the budget out from the rent sysvar.
          solFeeLamports: solFee,
          accountBudgetLamports: token === null ? 0n : BigInt(leafCount) * vaultRent,
          accountBudgetUsed: 0n,
        };
        if (this.tamperCreate !== null) {
          drop = this.tamperCreate(drop);
          this.tamperCreate = null;
        }
        this.accounts.set(pubkeyToBase58(pda.address), {
          lamports: rentFor(DROP_ACCOUNT_BYTES_HANDLE),
          owner: DROPCHAD_PROGRAM_ID,
          data: encodeDropAccount(drop),
        });
        this.accounts.set(pubkeyToBase58(bitmap.address), {
          lamports: rentFor(BITMAP_ACCOUNT_BYTES),
          owner: DROPCHAD_PROGRAM_ID,
          data: encodeBitmapAccount(pda.address, bitmap.bump, new Uint8Array(BITMAP_BYTES)),
        });
        return;
      }

      case "activate": {
        mustSign(key(0));
        const dropKey = key(1);
        const d = this.requireDrop(dropKey);
        if (d.status !== SVM_STATUS_CREATED) throw new ProgramError("WrongStatus");
        if (now > d.fundingDeadline) throw new ProgramError("FundingExpired");
        // mint, vault, token program, or all three absent on a SOL drop.
        const token = this.assetSlots(d, keys, 3, false);
        // a token drop needs both payments.
        if (token === null) {
          if (this.spendable(dropKey) < d.grossRequired) throw new ProgramError("Underfunded");
        } else if (
          (this.tokenAmountOf(token.vault) ?? 0n) < d.totalEntitlements ||
          this.spendable(dropKey) < (d.solFeeLamports ?? 0n) + (d.accountBudgetLamports ?? 0n)
        ) {
          throw new ProgramError("Underfunded");
        }
        if (!pubkeyEquals(key(2), d.feeWallet)) throw new ProgramError("WrongFeeWallet");
        this.writeDrop(dropKey, {
          ...d,
          activatedAt: now,
          claimDeadline: now + BigInt(d.claimPeriod),
          status: SVM_STATUS_ACTIVE,
        });
        // a token drop's SOL fee to the fee wallet.
        const solFee = d.solFeeLamports ?? 0n;
        if (token !== null && solFee > 0n) {
          this.setLamports(dropKey, this.lamportsOf(dropKey) - solFee);
          this.setLamports(d.feeWallet, this.lamportsOf(d.feeWallet) + solFee);
        }
        return;
      }

      case "claim": {
        mustSign(key(0));
        const dropKey = key(1);
        const d = this.requireDrop(dropKey);
        const bitmapKey = key(2);
        const recipient = key(3);
        if (!pubkeyEquals(bitmapKey, bitmapPda(dropKey).address))
          throw new ProgramError("ConstraintSeeds");
        const index = args.u32();
        const amount = args.u64();
        const proofLen = args.u32();
        const proof = Array.from({ length: proofLen }, () => bytesToHex(args.take(32)));
        if (d.status !== SVM_STATUS_ACTIVE) throw new ProgramError("WrongStatus");
        if (now > d.claimDeadline) throw new ProgramError("ClaimWindowClosed");
        if (index >= d.leafCount) throw new ProgramError("BadIndex");
        const bitmap = this.accounts.get(pubkeyToBase58(bitmapKey));
        if (bitmap === undefined) throw new ProgramError("AccountNotInitialized");
        const at = 8 + 33 + (index >> 3);
        if (((bitmap.data[at] as number) & (1 << (index & 7))) !== 0)
          throw new ProgramError("AlreadyClaimed");
        const leaf = leafHash({
          family: "svm",
          drop: pubkeyToBase58(dropKey),
          chainId: Number(d.chainId),
          index,
          recipient: pubkeyToBase58(recipient),
          amount,
        });
        if (!verifyProof(leaf, proof, bytesToHex(d.merkleRoot))) throw new ProgramError("BadProof");
        if (this.failingIndexes.has(index)) throw new ProgramError("InsufficientFundsForRent");
        bitmap.data[at] = (bitmap.data[at] as number) | (1 << (index & 7));
        this.writeDrop(dropKey, {
          ...d,
          totalClaimed: d.totalClaimed + amount,
          claimedCount: d.claimedCount + 1,
        });
        this.setLamports(dropKey, this.lamportsOf(dropKey) - amount);
        this.setLamports(recipient, this.lamportsOf(recipient) + amount);
        logs.push(
          `Program data: ${Buffer.from(
            concat([
              eventDiscriminator("Claimed"),
              dropKey,
              u32le(index),
              recipient,
              u64le(amount),
            ]),
          ).toString("base64")}`,
        );
        return;
      }

      // in the program's order: x id, index, bit, binder, the Ed25519 instruction directly
      // before this one, the handle leaf and its proof, then the bit, the payout and the event.
      case "claim_handle": {
        mustSign(key(0));
        const config = this.accounts.get(pubkeyToBase58(key(1)));
        if (config === undefined || !pubkeyEquals(key(1), configPda().address))
          throw new ProgramError("ConstraintSeeds");
        const cfg = decodeFakeConfig(config.data);
        const dropKey = key(2);
        const d = this.requireDrop(dropKey);
        const bitmapKey = key(3);
        const recipient = key(4);
        if (!pubkeyEquals(bitmapKey, bitmapPda(dropKey).address))
          throw new ProgramError("ConstraintSeeds");
        const index = args.u32();
        const xId = args.u64();
        const amount = args.u64();
        const proofLen = args.u32();
        const proof = Array.from({ length: proofLen }, () => bytesToHex(args.take(32)));
        if (d.status !== SVM_STATUS_ACTIVE) throw new ProgramError("WrongStatus");
        if (now > d.claimDeadline) throw new ProgramError("ClaimWindowClosed");
        if (xId === 0n) throw new ProgramError("BadXId");
        if (index >= d.leafCount) throw new ProgramError("BadIndex");
        const bitmap = this.accounts.get(pubkeyToBase58(bitmapKey));
        if (bitmap === undefined) throw new ProgramError("AccountNotInitialized");
        const at = 8 + 33 + (index >> 3);
        if (((bitmap.data[at] as number) & (1 << (index & 7))) !== 0)
          throw new ProgramError("AlreadyClaimed");
        const handle = cfg.handle;
        if (handle === undefined || handle.binder.every((b) => b === 0))
          throw new ProgramError("NoBinder");
        if (handle.binderRevoked) throw new ProgramError("BinderIsRevoked");
        if (ed25519Before === null) throw new ProgramError("BadBinding");
        const { key: signedBy, message } = verifyEd25519(ed25519Before);
        const expected = concat([
          BINDING_TAG_BYTES,
          dropKey,
          u256be(d.chainId),
          u256be(BigInt(index)),
          u256be(xId),
          recipient,
        ]);
        if (
          !pubkeyEquals(signedBy, handle.binder) ||
          message.length !== expected.length ||
          !message.every((b, i) => b === expected[i])
        ) {
          throw new ProgramError("BadBinding");
        }
        const leaf = handleLeafHash({
          family: "svm",
          drop: pubkeyToBase58(dropKey),
          chainId: Number(d.chainId),
          index,
          xId,
          amount,
        });
        if (!verifyProof(leaf, proof, bytesToHex(d.merkleRoot))) throw new ProgramError("BadProof");
        const token = this.assetSlots(d, keys, 5, true);
        bitmap.data[at] = (bitmap.data[at] as number) | (1 << (index & 7));
        let budgetUsed = d.accountBudgetUsed ?? 0n;
        if (token === null) {
          this.setLamports(dropKey, this.lamportsOf(dropKey) - amount);
          this.setLamports(recipient, this.lamportsOf(recipient) + amount);
        } else {
          // the idempotent create, the transfer, then the rent back to the caller.
          const created = this.ensureAta(token.ata as Pubkey, recipient, token, key(0));
          this.moveTokens(token.vault, token.ata as Pubkey, amount);
          const left = (d.accountBudgetLamports ?? 0n) - budgetUsed;
          const payBack = created < left ? created : left;
          if (payBack > 0n) {
            this.setLamports(dropKey, this.lamportsOf(dropKey) - payBack);
            this.setLamports(key(0), this.lamportsOf(key(0)) + payBack);
            budgetUsed += payBack;
          }
        }
        this.writeDrop(dropKey, {
          ...d,
          totalClaimed: d.totalClaimed + amount,
          claimedCount: d.claimedCount + 1,
          accountBudgetUsed: budgetUsed,
        });
        logs.push(
          `Program data: ${Buffer.from(
            concat([
              eventDiscriminator("HandleClaimed"),
              dropKey,
              u32le(index),
              u64le(xId),
              recipient,
              u64le(amount),
            ]),
          ).toString("base64")}`,
        );
        return;
      }

      case "refund":
      case "cancel_unfunded": {
        mustSign(key(0));
        const dropKey = key(1);
        const d = this.requireDrop(dropKey);
        if (!pubkeyEquals(key(2), d.refundRecipient))
          throw new ProgramError("WrongRefundRecipient");
        if (name === "refund") {
          if (d.status !== SVM_STATUS_ACTIVE) throw new ProgramError("WrongStatus");
          if (now <= d.claimDeadline) throw new ProgramError("ClaimWindowOpen");
        } else {
          if (d.status !== SVM_STATUS_CREATED) throw new ProgramError("WrongStatus");
          if (now <= d.fundingDeadline) throw new ProgramError("FundingStillOpen");
        }
        const token = this.assetSlots(d, keys, 3, true);
        const balance = this.spendable(dropKey);
        this.writeDrop(dropKey, {
          ...d,
          status: name === "refund" ? SVM_STATUS_FINALIZED : SVM_STATUS_CANCELLED,
        });
        if (token !== null) {
          // `init_if_needed`: the caller pays the refund recipient's account when it is missing.
          this.ensureAta(token.ata as Pubkey, d.refundRecipient, token, key(0));
          this.moveTokens(token.vault, token.ata as Pubkey, this.tokenAmountOf(token.vault) ?? 0n);
        }
        // SOL drop: everything left. Token drop: every lamport above the rent.
        this.setLamports(dropKey, this.lamportsOf(dropKey) - balance);
        this.setLamports(d.refundRecipient, this.lamportsOf(d.refundRecipient) + balance);
        return;
      }

      case "close_drop": {
        mustSign(key(0));
        const dropKey = key(1);
        const d = this.requireDrop(dropKey);
        const bitmapKey = key(2);
        if (d.status !== SVM_STATUS_FINALIZED && d.status !== SVM_STATUS_CANCELLED) {
          throw new ProgramError("NotFinished");
        }
        if (d.closed) throw new ProgramError("AlreadyClosed");
        if (!pubkeyEquals(key(3), d.rentPayer)) throw new ProgramError("WrongRentPayer");
        if (!pubkeyEquals(key(4), d.refundRecipient))
          throw new ProgramError("WrongRefundRecipient");
        const token = this.assetSlots(d, keys, 5, true);
        if (token !== null) {
          // the tokens left, then the vault closed, its rent to the payer.
          this.ensureAta(token.ata as Pubkey, d.refundRecipient, token, key(0));
          this.moveTokens(token.vault, token.ata as Pubkey, this.tokenAmountOf(token.vault) ?? 0n);
          const vault = this.accounts.get(pubkeyToBase58(token.vault));
          if (vault !== undefined) {
            this.setLamports(d.rentPayer, this.lamportsOf(d.rentPayer) + vault.lamports);
            this.accounts.delete(pubkeyToBase58(token.vault));
          }
        }
        const leftovers = this.spendable(dropKey);
        this.setLamports(dropKey, this.lamportsOf(dropKey) - leftovers);
        this.setLamports(d.refundRecipient, this.lamportsOf(d.refundRecipient) + leftovers);
        const bitmap = this.accounts.get(pubkeyToBase58(bitmapKey));
        if (bitmap !== undefined) {
          this.setLamports(d.rentPayer, this.lamportsOf(d.rentPayer) + bitmap.lamports);
          this.accounts.delete(pubkeyToBase58(bitmapKey));
        }
        this.writeDrop(dropKey, { ...d, closed: true });
        return;
      }

      default:
        // The admin instructions and sweep. The relayer must never send them, so the fake does
        // not implement them: reaching here in a test means the allowlist failed.
        throw new ProgramError(`unexpected instruction ${name}`);
    }
  }

  /**
   * The SPL slots from `start`: mint, vault, then the `*_ata` when `withAta`, the token
   * program, and the ATA program when `withAta`. All absent on a SOL drop; on a token drop they
   * must be the drop's own, else `AssetAccountsMismatch`.
   */
  private assetSlots(
    d: FakeDrop,
    keys: Pubkey[],
    start: number,
    withAta: boolean,
  ): { mint: Pubkey; vault: Pubkey; ata: Pubkey | null; program: Pubkey } | null {
    const isSol = d.asset.every((b) => b === 0);
    const first = keys[start];
    if (first === undefined) throw new ProgramError("NotEnoughAccountKeys");
    if (pubkeyEquals(first, DROPCHAD_PROGRAM_ID)) {
      if (!isSol) throw new ProgramError("AssetAccountsMismatch");
      return null;
    }
    if (isSol) throw new ProgramError("AssetAccountsMismatch");
    const at = (i: number) => {
      const k = keys[start + i];
      if (k === undefined) throw new ProgramError("NotEnoughAccountKeys");
      return k;
    };
    const mint = at(0);
    const vault = at(1);
    const ata = withAta ? at(2) : null;
    const program = at(withAta ? 3 : 2);
    if (!pubkeyEquals(mint, d.asset) || !pubkeyEquals(vault, d.vault))
      throw new ProgramError("AssetAccountsMismatch");
    const mintOwner = this.ownerOf(mint);
    if (mintOwner === null || !pubkeyEquals(program, mintOwner))
      throw new ProgramError("AssetAccountsMismatch");
    if (withAta && pubkeyToBase58(at(4)) !== FAKE_ATA_PROGRAM)
      throw new ProgramError("InvalidProgramId");
    return { mint, vault, ata, program };
  }

  /** The ATA program's create: the address must be the ATA, the payer pays the rent. Returns it. */
  private ensureAta(
    ata: Pubkey,
    owner: Pubkey,
    token: { mint: Pubkey; program: Pubkey },
    payer: Pubkey,
  ): bigint {
    if (!pubkeyEquals(ata, fakeAta(owner, token.mint, token.program)))
      throw new ProgramError("InvalidSeeds");
    if (this.accounts.has(pubkeyToBase58(ata))) return 0n;
    const data = encodeTokenAccount(token.mint, owner, 0n, token.program);
    const rent = rentFor(data.length);
    if (this.lamportsOf(payer) < rent) throw new ProgramError("InsufficientFunds");
    this.setLamports(payer, this.lamportsOf(payer) - rent);
    this.accounts.set(pubkeyToBase58(ata), { lamports: rent, owner: token.program, data });
    return rent;
  }

  private moveTokens(from: Pubkey, to: Pubkey, amount: bigint): void {
    const a = this.accounts.get(pubkeyToBase58(from));
    const b = this.accounts.get(pubkeyToBase58(to));
    if (a === undefined || b === undefined) throw new ProgramError("AccountNotInitialized");
    const have = tokenAmountIn(a.data);
    if (have < amount) throw new ProgramError("InsufficientFunds");
    new DataView(a.data.buffer, a.data.byteOffset).setBigUint64(64, have - amount, true);
    new DataView(b.data.buffer, b.data.byteOffset).setBigUint64(
      64,
      tokenAmountIn(b.data) + amount,
      true,
    );
  }

  private requireDrop(key: Pubkey): FakeDrop {
    const d = this.drop(key);
    if (d === null) throw new ProgramError("AccountNotInitialized");
    return d;
  }

  private spendable(drop: Pubkey): bigint {
    const l = this.lamportsOf(drop) - rentFor(DROP_ACCOUNT_BYTES_HANDLE);
    return l > 0n ? l : 0n;
  }
}

export function decodeFakeConfig(data: Uint8Array): FakeConfig {
  const c = new Cursor(data.slice(8));
  const base = {
    admin: c.take(32),
    relayer: c.take(32),
    feeWallet: c.take(32),
    defaultFeeBps: c.u16(),
    paused: c.u8() !== 0,
    chainId: c.u64(),
  };
  if (data.length !== CONFIG_ACCOUNT_BYTES_HANDLE) return base;
  c.u8(); // bump
  const binder = c.take(32);
  const binderRevoked = c.u8() !== 0;
  c.take(32); // guardian
  const minFeeLamports = c.u64();
  const minFeePerReceiverLamports = c.u64();
  const maxFeeLamports = c.u64();
  return {
    ...base,
    handle: { binder, binderRevoked, minFeeLamports, minFeePerReceiverLamports, maxFeeLamports },
  };
}

export function decodeFakeDrop(data: Uint8Array): FakeDrop {
  const c = new Cursor(data.slice(8));
  const asset = c.take(32);
  const vault = c.take(32);
  const merkleRoot = c.take(32);
  const manifestHash = c.take(32);
  const totalEntitlements = c.u64();
  const grossRequired = c.u64();
  const feeAmount = c.u64();
  const feeWallet = c.take(32);
  const refundRecipient = c.take(32);
  const fundingDeadline = new DataView(c.take(8).buffer).getBigInt64(0, true);
  const claimPeriod = c.u32();
  const creatorCommitment = c.take(32);
  const nonce = c.u64();
  const leafCount = c.u32();
  const chainId = c.u64();
  const rentPayer = c.take(32);
  const createdAt = new DataView(c.take(8).buffer).getBigInt64(0, true);
  const bump = c.u8();
  const bitmapBump = c.u8();
  const activatedAt = new DataView(c.take(8).buffer).getBigInt64(0, true);
  const claimDeadline = new DataView(c.take(8).buffer).getBigInt64(0, true);
  const status = c.u8();
  const totalClaimed = c.u64();
  const claimedCount = c.u32();
  const closed = c.u8() !== 0;
  const solFeeLamports = c.u64();
  const accountBudgetLamports = c.u64();
  const accountBudgetUsed = c.u64();
  return {
    asset,
    vault,
    merkleRoot,
    manifestHash,
    totalEntitlements,
    grossRequired,
    feeAmount,
    feeWallet,
    refundRecipient,
    fundingDeadline,
    claimPeriod,
    creatorCommitment,
    nonce,
    leafCount,
    chainId,
    rentPayer,
    createdAt,
    bump,
    bitmapBump,
    activatedAt,
    claimDeadline,
    status,
    totalClaimed,
    claimedCount,
    closed,
    solFeeLamports,
    accountBudgetLamports,
    accountBudgetUsed,
  };
}

// ---------------------------------------------------------------------------
// the rpc over the fake
// ---------------------------------------------------------------------------

export interface FakeSvmRpcOptions {
  /** Make `sendTransaction` throw, for the error mapping tests. */
  readonly failSend?: () => never;
  /** Report every sent transaction as never confirmed, so the relayer sees it expire. */
  readonly neverConfirm?: boolean;
}

export function createFakeSvmRpc(svm: FakeSvm, options: FakeSvmRpcOptions = {}): SvmRpc {
  const clockId = "SysvarC1ock11111111111111111111111111111111";
  const info = (key: Pubkey, commitment?: Commitment): AccountInfo | null => {
    // The Clock sysvar, 40 bytes, `unix_timestamp` at 32: the cluster's own time, `svm.clock`.
    if (pubkeyToBase58(key) === clockId) {
      const data = new Uint8Array(40);
      const view = new DataView(data.buffer);
      view.setBigUint64(0, BigInt(svm.blockHeight), true);
      view.setBigInt64(32, svm.clock, true);
      return {
        lamports: rentFor(40),
        owner: pubkeyFromBase58("Sysvar1111111111111111111111111111111111111"),
        data,
        executable: false,
      };
    }
    const view =
      commitment === "finalized" && svm.finalizedView !== null ? svm.finalizedView : svm.accounts;
    const account = view.get(pubkeyToBase58(key));
    if (account === undefined) return null;
    return {
      lamports: account.lamports,
      owner: account.owner,
      data: new Uint8Array(account.data),
      executable: false,
    };
  };
  return {
    getAccountInfo: (key, commitment) => Promise.resolve(info(key, commitment)),
    getMultipleAccounts: (keys, commitment) =>
      Promise.resolve(keys.map((key) => info(key, commitment))),
    getBalance: (key) => Promise.resolve(svm.lamportsOf(key)),
    getMinimumBalanceForRentExemption: (bytes) => Promise.resolve(rentFor(bytes)),
    getLatestBlockhash: () =>
      Promise.resolve({
        blockhash: new Uint8Array(32).map((_, i) => (svm.blockHeight + i) & 0xff),
        lastValidBlockHeight: svm.blockHeight + 150,
      }),
    getBlockHeight: () => Promise.resolve(svm.blockHeight),
    simulateTransaction: (tx) => {
      const before = svm.snapshot();
      const height = svm.blockHeight;
      const executedBefore = svm.executed.length;
      // A simulation must not use up the one shot tamper meant for the real send.
      const tamper = svm.tamperCreate;
      const meta = svm.run(tx);
      svm.tamperCreate = tamper;
      svm.restore(before);
      svm.blockHeight = height;
      svm.executed.length = executedBefore;
      return Promise.resolve({
        err: meta.err,
        logs: meta.logMessages,
        unitsConsumed: meta.computeUnitsConsumed,
      });
    },
    sendTransaction: (tx) => {
      options.failSend?.();
      const { signatures } = decodeTransaction(tx);
      const signature = pubkeyToBase58(signatures[0] as Uint8Array);
      svm.sent.push(new Uint8Array(tx));
      const meta = svm.run(tx);
      svm.transactions.set(signature, meta);
      return Promise.resolve(signature);
    },
    getSignatureStatuses: (signatures) =>
      Promise.resolve(
        signatures.map((signature) => {
          const meta = svm.transactions.get(signature);
          if (meta === undefined || options.neverConfirm === true) {
            // An unconfirmed transaction still moves the chain along, so an expiry can be seen.
            svm.blockHeight += 100;
            return null;
          }
          return { slot: meta.slot, confirmationStatus: "confirmed" as const, err: meta.err };
        }),
      ),
    getTransaction: (signature) => Promise.resolve(svm.transactions.get(signature) ?? null),
  };
}

export { pubkeyFromBase58 };
