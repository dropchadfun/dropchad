/**
 * The handle mode binding: what the binder signs so a handle leaf pays one wallet.
 *
 * - EVM: EIP 712, domain `name "dropchad"`, `version "1"`, the chain id,
 *   `verifyingContract` the drop; type `Binding(uint256 index, uint256 xId, address recipient)`.
 *   `DropV2.bindingDigest` returns the same digest, the vector in `test/handle.test.ts` pins it.
 * - Solana: a 192 byte message signed raw with ed25519, carried in
 *   an Ed25519 program instruction directly before `claim_handle`, in the one strict layout of
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
  /* istanbul ignore next -- six fixed words, this pins the design anyway. */
  if (msg.length !== SVM_BINDING_MESSAGE_BYTES)
    throw new Error(`binding message must be 192 bytes, got ${msg.length}`);
  return msg;
}

/** The native Ed25519 signature verify program. */
export const ED25519_PROGRAM_ID = "Ed25519SigVerify111111111111111111111111111";

/**
 * The Ed25519 instruction data in the one layout `claim_handle` accepts: one signature,
 * the padding byte zero, every instruction index `u16::MAX`, the key at 16, the signature at 48,
 * the message at 112. 304 bytes. The same layout `solana-ed25519-program` 3.0.0 builds.
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
  if (message.length !== SVM_BINDING_MESSAGE_BYTES) {
    throw new Error(`message must be ${SVM_BINDING_MESSAGE_BYTES} bytes, got ${message.length}`);
  }

  const data = new Uint8Array(16 + 32 + 64 + SVM_BINDING_MESSAGE_BYTES);
  data[0] = 1; // one signature
  data[1] = 0; // padding the design requires zero
  const offsets = [48, 0xffff, 16, 0xffff, 112, SVM_BINDING_MESSAGE_BYTES, 0xffff];
  offsets.forEach((v, i) => {
    data[2 + 2 * i] = v & 0xff;
    data[3 + 2 * i] = v >> 8;
  });
  data.set(key, 16);
  data.set(signature, 48);
  data.set(message, 112);
  return data;
}
