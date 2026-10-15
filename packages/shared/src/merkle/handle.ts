/**
 * Handle mode: the handle leaf, the handle tree and the version 2 manifest.
 *
 * EVM
 *
 * ```solidity
 * leaf = keccak256(bytes.concat(keccak256(abi.encode(
 *   HANDLE_LEAF_TAG, address drop, uint256 chainId, uint256 index, uint256 xId, uint256 amount
 * ))));
 * ```
 *
 * Solana: the same six words, the drop a raw 32 byte key.
 *
 * - the frame is 192 bytes, an address frame 160: under keccak the two can never collide.
 *   The tag word is there to read, and so a future leaf kind can get its own.
 * - `xId` is the numeric X user id, `0 < xId < 2^64`, never the handle string.
 * - one leaf per X id, amounts merged, sorted by `xId` ascending, `index` in that
 *   order, every amount above zero, the sum exact. A tree is one mode. The manifest is version 2
 *   with `mode: "handle"` and never carries an address or a handle string.
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

import { isPubkey, pubkeyToHex } from "./base58.js";
import { MAX_LEAVES } from "./generator.js";
import type { LeafFamily } from "./leaf.js";
import { buildTree, proofFor, verifyProof, type MerkleTree } from "./tree.js";

/** `keccak256("dropchad:handle-leaf:v1")`. The same word on both chains. */
export const HANDLE_LEAF_TAG: Hex = keccak256(toHex("dropchad:handle-leaf:v1"));

/** Six 32 byte words. */
export const HANDLE_LEAF_ENCODED_BYTES = 192;

/** The largest X id a leaf may hold, `2^64 - 1`. */
export const MAX_X_ID = 2n ** 64n - 1n;

const U64_MAX = 2n ** 64n - 1n;

/** Throws for an X id outside `0 < xId < 2^64`. Shared with the binding builders. */
export function assertXId(xId: bigint): void {
  if (xId <= 0n || xId > MAX_X_ID) {
    throw new Error(`x id must be 0 < xId < 2^64, got ${xId}`);
  }
}

/** The six words of the EVM handle leaf, in order. Consensus with `DropV2`, never change it. */
export const HANDLE_LEAF_ABI_PARAMETERS = [
  { name: "tag", type: "bytes32" },
  { name: "drop", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "index", type: "uint256" },
  { name: "xId", type: "uint256" },
  { name: "amount", type: "uint256" },
] as const;

export interface EvmHandleLeafInput {
  readonly family?: "evm";
  readonly drop: Address;
  readonly chainId: number;
  readonly index: number;
  readonly xId: bigint;
  readonly amount: bigint;
}

export interface SvmHandleLeafInput {
  readonly family: "svm";
  /** The drop PDA, base58. */
  readonly drop: string;
  readonly chainId: number;
  readonly index: number;
  readonly xId: bigint;
  /** `u64` on chain. */
  readonly amount: bigint;
}

export type HandleLeafInput = EvmHandleLeafInput | SvmHandleLeafInput;

/** The 192 bytes that go into the inner hash. */
export function encodeHandleLeaf(input: HandleLeafInput): Hex {
  assertXId(input.xId);
  let encoded: Hex;
  if (input.family === "svm") {
    if (input.amount < 0n || input.amount > U64_MAX) {
      throw new Error(`svm amount must fit u64, got ${input.amount}`);
    }
    encoded = concat([
      HANDLE_LEAF_TAG,
      pubkeyToHex(input.drop),
      pad(toHex(BigInt(input.chainId)), { size: 32 }),
      pad(toHex(BigInt(input.index)), { size: 32 }),
      pad(toHex(input.xId), { size: 32 }),
      pad(toHex(input.amount), { size: 32 }),
    ]);
  } else {
    encoded = encodeAbiParameters(HANDLE_LEAF_ABI_PARAMETERS, [
      HANDLE_LEAF_TAG,
      getAddress(input.drop),
      BigInt(input.chainId),
      BigInt(input.index),
      input.xId,
      input.amount,
    ]);
  }
  /* istanbul ignore next -- neither path can produce another length, this pins the design anyway. */
  if (size(encoded) !== HANDLE_LEAF_ENCODED_BYTES) {
    throw new Error(
      `handle leaf encoding must be ${HANDLE_LEAF_ENCODED_BYTES} bytes, got ${size(encoded)}`,
    );
  }
  return encoded;
}

/** Double keccak, as every leaf. */
export function handleLeafHash(input: HandleLeafInput): Hex {
  return keccak256(keccak256(encodeHandleLeaf(input)));
}

// -- the tree -----------------------------------------------------------------------------------

/** One receiver of a handle drop: an X id already resolved from a handle, and an amount. */
export interface HandleReceiver {
  readonly xId: bigint;
  readonly amount: bigint;
}

export interface HandleDropTreeEntry {
  readonly index: number;
  readonly xId: bigint;
  readonly amount: bigint;
  readonly leaf: Hex;
  readonly proof: readonly Hex[];
}

export interface HandleDropTree<A extends string = string> {
  readonly mode: "handle";
  readonly family: LeafFamily;
  readonly drop: A;
  readonly chainId: number;
  readonly root: Hex;
  readonly leafCount: number;
  readonly totalEntitlements: bigint;
  readonly entries: readonly HandleDropTreeEntry[];
  readonly tree: MerkleTree;
}

export interface BuildHandleDropTreeArgs {
  /** `evm` when absent. */
  readonly family?: LeafFamily;
  readonly drop: string;
  readonly chainId: number;
  readonly receivers: readonly HandleReceiver[];
  /** Checked against the sum when given. */
  readonly expectedTotal?: bigint;
}

/** One leaf per X id with the amounts merged, zeros dropped, sorted by `xId` ascending. */
export function normalizeHandleReceivers(receivers: readonly HandleReceiver[]): HandleReceiver[] {
  const merged = new Map<bigint, bigint>();
  for (const r of receivers) {
    assertXId(r.xId);
    if (r.amount < 0n) throw new Error(`negative amount for x id ${r.xId}`);
    merged.set(r.xId, (merged.get(r.xId) ?? 0n) + r.amount);
  }
  return [...merged.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([xId, amount]) => ({ xId, amount }));
}

/**
 * Build a handle drop's tree: root, leaf count, total, a proof per X id. Every proof is verified
 * against the root before this returns, like `buildDropTree`.
 */
export function buildHandleDropTree(args: BuildHandleDropTreeArgs): HandleDropTree {
  const family: LeafFamily = args.family ?? "evm";
  let drop: string;
  if (family === "svm") {
    if (!isPubkey(args.drop)) throw new Error(`not a public key: ${args.drop}`);
    drop = args.drop;
  } else {
    drop = getAddress(args.drop);
  }

  const receivers = normalizeHandleReceivers(args.receivers);
  if (receivers.length === 0) {
    throw new Error("a drop needs at least one receiver with a non zero amount");
  }
  if (receivers.length > MAX_LEAVES) {
    throw new Error(`too many leaves: ${receivers.length} > MAX_LEAVES ${MAX_LEAVES}`);
  }

  const totalEntitlements = receivers.reduce((sum, r) => sum + r.amount, 0n);
  if (args.expectedTotal !== undefined && args.expectedTotal !== totalEntitlements) {
    throw new Error(
      `total mismatch: leaves sum to ${totalEntitlements}, expected ${args.expectedTotal}`,
    );
  }

  const leaves = receivers.map((r, index) =>
    family === "svm"
      ? handleLeafHash({
          family: "svm",
          drop,
          chainId: args.chainId,
          index,
          xId: r.xId,
          amount: r.amount,
        })
      : handleLeafHash({
          drop: drop as Address,
          chainId: args.chainId,
          index,
          xId: r.xId,
          amount: r.amount,
        }),
  );
  const tree = buildTree(leaves);

  const entries: HandleDropTreeEntry[] = receivers.map((r, index) => {
    const leaf = leaves[index] as Hex;
    const proof = proofFor(tree, index);
    if (!verifyProof(leaf, proof, tree.root)) {
      throw new Error(`generated proof does not verify for index ${index}`);
    }
    return { index, xId: r.xId, amount: r.amount, leaf, proof };
  });

  return {
    mode: "handle",
    family,
    drop,
    chainId: args.chainId,
    root: tree.root,
    leafCount: entries.length,
    totalEntitlements,
    entries,
    tree,
  };
}

// -- the version 2 manifest ---------------------------------------------------------------------

export interface HandleManifestEntry {
  readonly index: number;
  /** Decimal string, JSON has no bigint. */
  readonly xId: string;
  readonly amount: string;
  readonly proof: readonly Hex[];
}

/**
 * Version 2: a reader that knows only version 1 refuses it instead of
 * misreading an X id as an address. The address manifest stays version 1, byte for byte.
 */
export interface HandleManifest {
  readonly version: 2;
  readonly mode: "handle";
  readonly drop: string;
  readonly chainId: number;
  readonly root: Hex;
  readonly totalEntitlements: string;
  readonly leafCount: number;
  readonly entries: readonly HandleManifestEntry[];
}

export function toHandleManifest(tree: HandleDropTree): HandleManifest {
  return {
    version: 2,
    mode: "handle",
    drop: tree.drop,
    chainId: tree.chainId,
    root: tree.root,
    totalEntitlements: tree.totalEntitlements.toString(),
    leafCount: tree.leafCount,
    entries: tree.entries.map((e) => ({
      index: e.index,
      xId: e.xId.toString(),
      amount: e.amount.toString(),
      proof: [...e.proof],
    })),
  };
}

/** Canonical bytes: fixed key order, no whitespace, as `canonicalManifestJson`. */
export function canonicalHandleManifestJson(manifest: HandleManifest): string {
  return JSON.stringify({
    version: manifest.version,
    mode: manifest.mode,
    drop: manifest.drop,
    chainId: manifest.chainId,
    root: manifest.root,
    totalEntitlements: manifest.totalEntitlements,
    leafCount: manifest.leafCount,
    entries: manifest.entries.map((e) => ({
      index: e.index,
      xId: e.xId,
      amount: e.amount,
      proof: [...e.proof],
    })),
  });
}

/** `keccak256` of the canonical JSON bytes, written into the drop as `manifestHash`. */
export function keccakHandleManifestHash(manifest: HandleManifest): Hex {
  return keccak256(toHex(canonicalHandleManifestJson(manifest)));
}
