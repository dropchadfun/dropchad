/**
 * The legacy Solana transaction, byte for byte.
 *
 * A transaction is a compact array of 64 byte signatures followed by the message. The message is
 * a three byte header, the account keys, the recent blockhash and the compiled instructions:
 *
 *   header      num_required_signatures, num_readonly_signed, num_readonly_unsigned
 *   keys        compact array of 32 byte keys, fee payer first, then writable signers, readonly
 *               signers, writable non-signers, readonly non-signers
 *   blockhash   32 bytes
 *   ixs         compact array of { program index u8, compact account indexes, compact data }
 *
 * "Compact" is the shortvec encoding: little endian base 128 with a continuation bit, at most
 * three bytes. Legacy, and one v0 form: a token `claim_handle` with
 * the one fixed lookup table, read-only lookups only. The whole transaction must fit in 1,232
 * bytes, which is the bound the fit table in 6.5 comes from.
 *
 * Written out instead of imported for the same reason as `pda.ts`: it is small, it is the thing
 * the relayer's guards inspect, and pinning it in a test is cheaper than trusting a client
 * library's version of it. A test signs a message here and verifies it with `@noble/curves`.
 */
import { ed25519 } from "@noble/curves/ed25519";

import type { Signer } from "./keypair.js";
import { pubkeyEquals, pubkeyToBase58, type Pubkey } from "./pubkey.js";

/** `PACKET_DATA_SIZE`, the largest transaction the network accepts. */
export const MAX_TRANSACTION_BYTES = 1232;

export interface AccountMeta {
  readonly pubkey: Pubkey;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface Instruction {
  readonly programId: Pubkey;
  readonly keys: readonly AccountMeta[];
  readonly data: Uint8Array;
}

export interface CompiledInstruction {
  readonly programIdIndex: number;
  readonly accountIndexes: readonly number[];
  readonly data: Uint8Array;
}

export interface Message {
  readonly header: {
    readonly numRequiredSignatures: number;
    readonly numReadonlySigned: number;
    readonly numReadonlyUnsigned: number;
  };
  readonly accountKeys: readonly Pubkey[];
  readonly recentBlockhash: Uint8Array;
  readonly instructions: readonly CompiledInstruction[];
}

export function encodeShortVec(length: number): Uint8Array {
  if (length < 0 || length > 0x3fff)
    throw new Error(`shortvec length out of range: ${String(length)}`);
  const out: number[] = [];
  let rest = length;
  for (;;) {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return new Uint8Array(out);
    }
    byte |= 0x80;
    out.push(byte);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Compile instructions into a message. Merges every appearance of a key into one entry, and a
 * key that is a signer or writable anywhere is a signer or writable in the merged entry. The
 * fee payer is always index 0.
 */
export function compileMessage(args: {
  readonly feePayer: Pubkey;
  readonly recentBlockhash: Uint8Array;
  readonly instructions: readonly Instruction[];
}): Message {
  if (args.recentBlockhash.length !== 32) throw new Error("blockhash must be 32 bytes");

  interface Merged {
    pubkey: Pubkey;
    isSigner: boolean;
    isWritable: boolean;
  }
  const merged: Merged[] = [{ pubkey: args.feePayer, isSigner: true, isWritable: true }];

  const upsert = (meta: AccountMeta) => {
    const existing = merged.find((m) => pubkeyEquals(m.pubkey, meta.pubkey));
    if (existing === undefined) {
      merged.push({ pubkey: meta.pubkey, isSigner: meta.isSigner, isWritable: meta.isWritable });
    } else {
      existing.isSigner ||= meta.isSigner;
      existing.isWritable ||= meta.isWritable;
    }
  };

  for (const ix of args.instructions) {
    for (const key of ix.keys) upsert(key);
    upsert({ pubkey: ix.programId, isSigner: false, isWritable: false });
  }

  // The fee payer stays first; everything else is grouped the way the header describes it.
  const [payer, ...rest] = merged;
  const writableSigners = rest.filter((m) => m.isSigner && m.isWritable);
  const readonlySigners = rest.filter((m) => m.isSigner && !m.isWritable);
  const writableOthers = rest.filter((m) => !m.isSigner && m.isWritable);
  const readonlyOthers = rest.filter((m) => !m.isSigner && !m.isWritable);
  const ordered = [
    payer as Merged,
    ...writableSigners,
    ...readonlySigners,
    ...writableOthers,
    ...readonlyOthers,
  ];

  const indexOf = (key: Pubkey): number => {
    const index = ordered.findIndex((m) => pubkeyEquals(m.pubkey, key));
    if (index < 0) throw new Error(`key not in message: ${pubkeyToBase58(key)}`);
    return index;
  };

  return {
    header: {
      numRequiredSignatures: 1 + writableSigners.length + readonlySigners.length,
      numReadonlySigned: readonlySigners.length,
      numReadonlyUnsigned: readonlyOthers.length,
    },
    accountKeys: ordered.map((m) => m.pubkey),
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions.map((ix) => ({
      programIdIndex: indexOf(ix.programId),
      accountIndexes: ix.keys.map((key) => indexOf(key.pubkey)),
      data: ix.data,
    })),
  };
}

export function serializeMessage(message: Message): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([
      message.header.numRequiredSignatures,
      message.header.numReadonlySigned,
      message.header.numReadonlyUnsigned,
    ]),
    encodeShortVec(message.accountKeys.length),
    ...message.accountKeys,
    message.recentBlockhash,
    encodeShortVec(message.instructions.length),
  ];
  for (const ix of message.instructions) {
    parts.push(
      new Uint8Array([ix.programIdIndex]),
      encodeShortVec(ix.accountIndexes.length),
      new Uint8Array(ix.accountIndexes),
      encodeShortVec(ix.data.length),
      ix.data,
    );
  }
  return concat(parts);
}

export interface SignedTransaction {
  readonly message: Message;
  readonly messageBytes: Uint8Array;
  readonly signatures: readonly Uint8Array[];
  readonly bytes: Uint8Array;
  /** The first signature, base58. What the network calls the transaction id. */
  readonly signature: string;
}

/**
 * Sign with every signer the header requires. One signer today, the relayer; the shape allows
 * more so a test can build a two signer transaction and prove the header counts it.
 *
 * Every signer is found before any signs, and the signatures keep the header order whichever
 * answers first.
 */
export async function signTransaction(
  message: Message,
  signers: readonly Signer[],
): Promise<SignedTransaction> {
  return signMessageBytes(message, serializeMessage(message), signers);
}

async function signMessageBytes<M extends Message>(
  message: M,
  messageBytes: Uint8Array,
  signers: readonly Signer[],
): Promise<SignedTransaction & { readonly message: M }> {
  const required = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  const ordered = required.map((key) => {
    const signer = signers.find((s) => pubkeyEquals(s.publicKey, key));
    if (signer === undefined) throw new Error(`missing signer for ${pubkeyToBase58(key)}`);
    return signer;
  });
  const signatures = await Promise.all(ordered.map((signer) => signer.sign(messageBytes)));
  const bytes = concat([encodeShortVec(signatures.length), ...signatures, messageBytes]);
  if (bytes.length > MAX_TRANSACTION_BYTES) {
    throw new TransactionTooLargeError(bytes.length);
  }
  return {
    message,
    messageBytes,
    signatures,
    bytes,
    signature: pubkeyToBase58(signatures[0] as Uint8Array),
  };
}

export class TransactionTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`transaction is ${String(bytes)} bytes, the limit is ${String(MAX_TRANSACTION_BYTES)}`);
    this.name = "TransactionTooLargeError";
  }
}

/** The serialized size a set of instructions would have with one signer. For the fit table. */
export function transactionSize(args: {
  readonly feePayer: Pubkey;
  readonly instructions: readonly Instruction[];
}): number {
  const message = compileMessage({ ...args, recentBlockhash: new Uint8Array(32) });
  return 1 + 64 * message.header.numRequiredSignatures + serializeMessage(message).length;
}

/** Verify one signature over the message. Used by tests, and by nothing that sends. */
export function verifySignature(tx: SignedTransaction, signerIndex = 0): boolean {
  const key = tx.message.accountKeys[signerIndex];
  const signature = tx.signatures[signerIndex];
  if (key === undefined || signature === undefined) return false;
  return ed25519.verify(signature, tx.messageBytes, key);
}

// ---------------------------------------------------------------------------
// v0
// ---------------------------------------------------------------------------

/** A lookup table as the relayer knows it: its address and its checked address list. */
export interface LookupTable {
  readonly address: Pubkey;
  readonly addresses: readonly Pubkey[];
}

export interface MessageLookup {
  readonly accountKey: Pubkey;
  readonly writableIndexes: readonly number[];
  readonly readonlyIndexes: readonly number[];
}

/** A v0 message. `accountKeys` are the static keys only; the lookups follow them. */
export interface MessageV0 extends Message {
  readonly lookups: readonly MessageLookup[];
}

/**
 * Compile instructions into a v0 message with one table. A key moves into the table only when
 * the table holds it and it is not a signer, not writable and not an invoked program; those stay
 * static. The moved keys are read-only lookups in table order, after the static keys.
 */
export function compileMessageV0(args: {
  readonly feePayer: Pubkey;
  readonly recentBlockhash: Uint8Array;
  readonly instructions: readonly Instruction[];
  readonly table: LookupTable;
}): MessageV0 {
  const legacy = compileMessage(args);
  const flags = (index: number) => {
    const h = legacy.header;
    const n = legacy.accountKeys.length;
    const signer = index < h.numRequiredSignatures;
    const writable = signer
      ? index < h.numRequiredSignatures - h.numReadonlySigned
      : index < n - h.numReadonlyUnsigned;
    return { signer, writable };
  };
  const invoked = new Set(legacy.instructions.map((ix) => ix.programIdIndex));
  const moved: { key: Pubkey; tableIndex: number }[] = [];
  const staticKeys: Pubkey[] = [];
  let readonlyUnsigned = 0;
  legacy.accountKeys.forEach((key, index) => {
    const { signer, writable } = flags(index);
    const tableIndex = args.table.addresses.findIndex((a) => pubkeyEquals(a, key));
    if (!signer && !writable && !invoked.has(index) && tableIndex >= 0) {
      moved.push({ key, tableIndex });
      return;
    }
    staticKeys.push(key);
    if (!signer && !writable) readonlyUnsigned += 1;
  });
  moved.sort((a, b) => a.tableIndex - b.tableIndex);
  const all = [...staticKeys, ...moved.map((m) => m.key)];
  const indexOf = (key: Pubkey): number => {
    const index = all.findIndex((k) => pubkeyEquals(k, key));
    if (index < 0) throw new Error(`key not in message: ${pubkeyToBase58(key)}`);
    return index;
  };
  const keyAt = (index: number) => legacy.accountKeys[index] as Pubkey;
  return {
    header: { ...legacy.header, numReadonlyUnsigned: readonlyUnsigned },
    accountKeys: staticKeys,
    recentBlockhash: legacy.recentBlockhash,
    instructions: legacy.instructions.map((ix) => ({
      programIdIndex: indexOf(keyAt(ix.programIdIndex)),
      accountIndexes: ix.accountIndexes.map((i) => indexOf(keyAt(i))),
      data: ix.data,
    })),
    lookups:
      moved.length === 0
        ? []
        : [
            {
              accountKey: args.table.address,
              writableIndexes: [],
              readonlyIndexes: moved.map((m) => m.tableIndex),
            },
          ],
  };
}

/** The version byte `0x80`, the legacy layout, then the lookups. */
export function serializeMessageV0(message: MessageV0): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x80]), serializeMessage(message)];
  parts.push(encodeShortVec(message.lookups.length));
  for (const lookup of message.lookups) {
    parts.push(
      lookup.accountKey,
      encodeShortVec(lookup.writableIndexes.length),
      new Uint8Array(lookup.writableIndexes),
      encodeShortVec(lookup.readonlyIndexes.length),
      new Uint8Array(lookup.readonlyIndexes),
    );
  }
  return concat(parts);
}

export async function signTransactionV0(
  message: MessageV0,
  signers: readonly Signer[],
): Promise<SignedTransaction & { readonly message: MessageV0 }> {
  return signMessageBytes(message, serializeMessageV0(message), signers);
}

/** The serialized size of a v0 transaction with one signer and the given table. */
export function transactionSizeV0(args: {
  readonly feePayer: Pubkey;
  readonly instructions: readonly Instruction[];
  readonly table: LookupTable;
}): number {
  const message = compileMessageV0({ ...args, recentBlockhash: new Uint8Array(32) });
  return 1 + 64 * message.header.numRequiredSignatures + serializeMessageV0(message).length;
}
