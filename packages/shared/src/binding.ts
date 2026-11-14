/**
 * The handle mode binding: what the binder signs so a handle leaf pays one wallet.
 *
 * - EVM: EIP 712, domain `name "dropchad"`, `version "1"`, the chain id,
 *   `verifyingContract` the drop; type `Binding(uint256 index, uint256 xId, address recipient)`.
 *   `DropV2.bindingDigest` returns the same digest, the vector in `test/handle.test.ts` pins it.
 * - Solana: a 192 byte message signed raw with ed25519, carried in
 *   an Ed25519 program instruction directly before `claim_handle`, in the one strict layout of
 *
 * Binding v2, adds `validUntil`: on the EVM a fourth field of the type, on
 * Solana 8 bytes after the six words, 200 bytes. A `DropV7` drop and a Solana cluster whose
 * program runs binding v2 take only v2; every older drop keeps v1, so both stay here.
 *
 * Pure functions. Nothing here holds or sees a key: the api signs with the binder key it loads,
 * and only these bytes cross into that code.
 */
import {
  concat,
  getAddress,
  hashTypedData,
  keccak256,
  pad,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { base58Decode, pubkeyToHex } from "./merkle/base58.js";
import { assertXId } from "./merkle/handle.js";

// -- binding v2 -------------------------------------------------------------------------

/** How far ahead of the server's time the api signs `validUntil`. */
export const BINDING_SIGN_AHEAD_SECONDS = 600;

/** The furthest `validUntil` the chain takes ahead of its own time. */
export const MAX_BINDING_LIFETIME_SECONDS = 3600;

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_INT64 = 2n ** 63n - 1n;

function assertValidUntil(validUntil: bigint, max: bigint): void {
  if (validUntil <= 0n || validUntil > max) {
    throw new Error(
      `validUntil must be above 0 and at most ${max.toString()}, got ${validUntil.toString()}`,
    );
  }
}

// -- EVM ----------------------------------------------------------------------------------------

export const BINDING_EIP712_NAME = "dropchad";
export const BINDING_EIP712_VERSION = "1";

/** The field order is consensus with `DropV2`, never change it. */
export const BINDING_EIP712_TYPES = {
  Binding: [
    { name: "index", type: "uint256" },
    { name: "xId", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

export interface EvmBindingArgs {
  /** The drop clone, the `verifyingContract`. */
  readonly drop: Address;
  readonly chainId: number;
  readonly index: number;
  readonly xId: bigint;
  /** The wallet the receiver proved they hold. */
  readonly recipient: Address;
}

/** The typed data for viem `signTypedData` and `hashTypedData`. */
export function bindingTypedData(args: EvmBindingArgs) {
  assertXId(args.xId);
  return {
    domain: {
      name: BINDING_EIP712_NAME,
      version: BINDING_EIP712_VERSION,
      chainId: args.chainId,
      verifyingContract: getAddress(args.drop),
    },
    types: BINDING_EIP712_TYPES,
    primaryType: "Binding" as const,
    message: { index: BigInt(args.index), xId: args.xId, recipient: getAddress(args.recipient) },
  };
}

/** The digest the binder signs, equal to `DropV2.bindingDigest(index, xId, recipient)`. */
export function evmBindingDigest(args: EvmBindingArgs): Hex {
  return hashTypedData(bindingTypedData(args));
}

/** binding v2. The field order is consensus with `DropV7`, never change it. */
export const BINDING_EIP712_TYPES_V2 = {
  Binding: [
    { name: "index", type: "uint256" },
    { name: "xId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export interface EvmBindingArgsV2 extends EvmBindingArgs {
  /** Unix seconds; the drop refuses the binding after it.1. */
  readonly validUntil: bigint;
}

/** The binding v2 typed data, the same domain as v1. */
export function bindingTypedDataV2(args: EvmBindingArgsV2) {
  assertXId(args.xId);
  assertValidUntil(args.validUntil, MAX_UINT64);
  return {
    domain: {
      name: BINDING_EIP712_NAME,
      version: BINDING_EIP712_VERSION,
      chainId: args.chainId,
      verifyingContract: getAddress(args.drop),
    },
    types: BINDING_EIP712_TYPES_V2,
    primaryType: "Binding" as const,
    message: {
      index: BigInt(args.index),
      xId: args.xId,
      recipient: getAddress(args.recipient),
      validUntil: args.validUntil,
    },
  };
}

/** The digest the binder signs, equal to `DropV7.bindingDigest(index, xId, recipient, validUntil)`. */
export function evmBindingDigestV2(args: EvmBindingArgsV2): Hex {
  return hashTypedData(bindingTypedDataV2(args));
}

// -- Solana -------------------------------------------------------------------------------------

/** `keccak256("dropchad:binding:v1")`. Not the leaf tag. */
export const BINDING_TAG: Hex = keccak256(toHex("dropchad:binding:v1"));

/** Six words. */
export const SVM_BINDING_MESSAGE_BYTES = 192;

export interface SvmBindingArgs {
  /** The drop PDA, base58. */
  readonly drop: string;
  readonly chainId: number;
  readonly index: number;
  readonly xId: bigint;
  /** The wallet, base58. */
  readonly recipient: string;
}

/** `tag ++ drop ++ chain_id ++ index ++ x_id ++ recipient`, signed raw. */
export function svmBindingMessage(args: SvmBindingArgs): Uint8Array {
  assertXId(args.xId);
  const msg = toBytes(
    concat([
      BINDING_TAG,
      pubkeyToHex(args.drop),
      pad(toHex(BigInt(args.chainId)), { size: 32 }),
      pad(toHex(BigInt(args.index)), { size: 32 }),
      pad(toHex(args.xId), { size: 32 }),
      pubkeyToHex(args.recipient),
    ]),
  );
  /* istanbul ignore next -- six fixed words, this pins the layout anyway. */
  if (msg.length !== SVM_BINDING_MESSAGE_BYTES)
    throw new Error(`binding message must be 192 bytes, got ${msg.length}`);
  return msg;
}

/** `keccak256("dropchad:binding:v2")` binding v2. Neither the v1 tag nor the leaf tag. */
export const BINDING_TAG_V2: Hex = keccak256(toHex("dropchad:binding:v2"));

/** binding v2. Six words and `valid_until`. */
export const SVM_BINDING_MESSAGE_BYTES_V2 = 200;

export interface SvmBindingArgsV2 extends SvmBindingArgs {
  /** Unix seconds, written as 8 bytes, i64 big endian. */
  readonly validUntil: bigint;
}

/** binding v2. `tag ++ drop ++ chain_id ++ index ++ x_id ++ recipient ++ valid_until`. */
export function svmBindingMessageV2(args: SvmBindingArgsV2): Uint8Array {
  assertXId(args.xId);
  assertValidUntil(args.validUntil, MAX_INT64);
  const msg = toBytes(
    concat([
      BINDING_TAG_V2,
      pubkeyToHex(args.drop),
      pad(toHex(BigInt(args.chainId)), { size: 32 }),
      pad(toHex(BigInt(args.index)), { size: 32 }),
      pad(toHex(args.xId), { size: 32 }),
      pubkeyToHex(args.recipient),
      pad(toHex(args.validUntil), { size: 8 }),
    ]),
  );
  /* istanbul ignore next -- six words and 8 bytes, this pins the length anyway. */
  if (msg.length !== SVM_BINDING_MESSAGE_BYTES_V2)
    throw new Error(`binding v2 message must be 200 bytes, got ${msg.length}`);
  return msg;
}

/** The native Ed25519 signature verify program. */
export const ED25519_PROGRAM_ID = "Ed25519SigVerify111111111111111111111111111";

/**
 * The Ed25519 instruction data in the one layout `claim_handle` accepts: one signature,
 * the padding byte zero, every instruction index `u16::MAX`, the key at 16, the signature at 48,
 * the message at 112. 304 bytes for a v1 message, 312 for a binding v2 message. The same layout
 * `solana-ed25519-program` 3.0.0 builds.
 */
export function ed25519InstructionData(
  binder: string,
  signature: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  const key = base58Decode(binder);
  if (key.length !== 32) throw new Error(`binder key must be 32 bytes, got ${key.length}`);
  if (signature.length !== 64)
    throw new Error(`signature must be 64 bytes, got ${signature.length}`);
  if (
    message.length !== SVM_BINDING_MESSAGE_BYTES &&
    message.length !== SVM_BINDING_MESSAGE_BYTES_V2
  ) {
    throw new Error(
      `message must be ${SVM_BINDING_MESSAGE_BYTES} or ${SVM_BINDING_MESSAGE_BYTES_V2} bytes, got ${message.length}`,
    );
  }

  const data = new Uint8Array(16 + 32 + 64 + message.length);
  data[0] = 1; // one signature
  data[1] = 0; // padding, always zero
  const offsets = [48, 0xffff, 16, 0xffff, 112, message.length, 0xffff];
  offsets.forEach((v, i) => {
    data[2 + 2 * i] = v & 0xff;
    data[3 + 2 * i] = v >> 8;
  });
  data.set(key, 16);
  data.set(signature, 48);
  data.set(message, 112);
  return data;
}
