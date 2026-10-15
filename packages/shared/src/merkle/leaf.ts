/**
 * The merkle leaf, one frame for both chains.
 *
 * EVM
 *
 * ```solidity
 * leaf = keccak256(bytes.concat(keccak256(abi.encode(
 *   address drop, uint256 chainId, uint256 index, address recipient, uint256 amount
 * ))));
 * ```
 *
 * Solana: the same five 32 byte words, the same double keccak. A public
 * key is 32 bytes and fills its word; an EVM address is 20 bytes left padded to 32. Integers are
 * unsigned big endian 256 bit words on both, which is what `abi.encode` produces. So the frame is
 * always 160 bytes and only the way the two address words are made differs by family.
 *
 * - 160 bytes, five words. Never `abi.encodePacked`.
 * - double hash. A leaf is keccak of 32 bytes, a node keccak of 64 bytes.
 * - the drop address in the leaf stops replay on another drop.
 * - the chain id stops replay on another chain, or another Solana cluster.
 * - the index ties the leaf to one bitmap bit.
 */
import {
  concat,
  encodeAbiParameters,
  getAddress,
  keccak256,
  pad,
  size,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { pubkeyToHex } from "./base58.js";

/** Which chain the leaf is for. Decides how the two address words are made. */
export type LeafFamily = "evm" | "svm";

/**
 * The Solana token list convention, not a standard. Written into the
 * program's config at init and copied into every drop; the registry carries the same numbers.
 */
export const SOLANA_MAINNET_CHAIN_ID = 101;
export const SOLANA_DEVNET_CHAIN_ID = 103;

/** The five words of the EVM leaf, in order. The order is consensus with the contract, never change it. */
export const LEAF_ABI_PARAMETERS = [
  { name: "drop", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "index", type: "uint256" },
  { name: "recipient", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

/** Five 32 byte words. */
export const LEAF_ENCODED_BYTES = 160;

export interface EvmLeafInput {
  readonly family?: "evm";
  /** The clone address. */
  readonly drop: Address;
  /** The EVM chain id. */
  readonly chainId: number;
  /** Position in the sorted leaf list, and the bitmap bit. */
  readonly index: number;
  readonly recipient: Address;
  /** Wei, or the smallest unit of the ERC20. Always greater than zero. */
  readonly amount: bigint;
}

export interface SvmLeafInput {
  readonly family: "svm";
  /** The drop PDA, base58. */
  readonly drop: string;
  /** `SOLANA_MAINNET_CHAIN_ID` or `SOLANA_DEVNET_CHAIN_ID`. */
  readonly chainId: number;
  readonly index: number;
  /** A public key, base58. */
  readonly recipient: string;
  /** Lamports, or the mint's base unit. `u64` on chain. */
  readonly amount: bigint;
}

export type LeafInput = EvmLeafInput | SvmLeafInput;

const U64_MAX = 2n ** 64n - 1n;

/**
 * The 160 bytes that go into the inner hash. Exported so a test can assert the byte layout of
 * the worked examples, not only the resulting hash.
 */
export function encodeLeaf(input: LeafInput): Hex {
  const encoded =
    input.family === "svm"
      ? encodeSvmFrame(input)
      : encodeAbiParameters(LEAF_ABI_PARAMETERS, [
          getAddress(input.drop),
          BigInt(input.chainId),
          BigInt(input.index),
          getAddress(input.recipient),
          input.amount,
        ]);
  /* istanbul ignore next -- neither path can produce another length, this pins the design anyway. */
  if (size(encoded) !== LEAF_ENCODED_BYTES) {
    throw new Error(`leaf encoding must be ${LEAF_ENCODED_BYTES} bytes, got ${size(encoded)}`);
  }
  return encoded;
}

/** Two raw 32 byte keys and three big endian words. */
function encodeSvmFrame(input: SvmLeafInput): Hex {
  if (input.amount < 0n || input.amount > U64_MAX) {
    throw new Error(`svm amount must fit u64, got ${input.amount}`);
  }
  return concat([
    pubkeyToHex(input.drop),
    pad(toHex(BigInt(input.chainId)), { size: 32 }),
    pad(toHex(BigInt(input.index)), { size: 32 }),
    pubkeyToHex(input.recipient),
    pad(toHex(input.amount), { size: 32 }),
  ]);
}

/** The leaf hash. Double keccak. */
export function leafHash(input: LeafInput): Hex {
  return keccak256(keccak256(encodeLeaf(input)));
}
