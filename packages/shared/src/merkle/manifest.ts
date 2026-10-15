/**
 * The manifest.
 *
 * The manifest is the full list published off chain: `drop`, `chainId`, `root`,
 * `totalEntitlements`, and every `index, recipient, amount, proof`. `manifestHash` is stored in
 * the drop, so anybody can prove the published list is the one the drop was created with.
 *
 * ** the design is closed **: `manifestHash` is `keccak256` of the canonical JSON bytes,
 * An IPFS CID was the other candidate and was not taken: it needs multihash
 * encoding, and it would put the availability of the payout list on a network we do not run.
 *
 * `title` and `memeImageUrl` are deliberately **not** in this document and not in the hash.
 * They are dropchad presentation data and live in our own database only.
 */
import { keccak256, toHex, type Address, type Hex } from "viem";

import type { DropTree } from "./generator.js";

/** One published receiver. Amounts are decimal strings, because JSON has no bigint. */
export interface ManifestEntry<A extends string = Address> {
  readonly index: number;
  readonly recipient: A;
  readonly amount: string;
  readonly proof: readonly Hex[];
}

/**
 * The same document on both chains. On Solana `drop` and every
 * `recipient` are base58 public keys and `chainId` is the cluster constant of. The key
 * order and the hash rule do not change.
 */
export interface Manifest<A extends string = Address> {
  /** Bumped whenever the document shape changes. A reader must refuse an unknown version. */
  readonly version: 1;
  readonly drop: A;
  readonly chainId: number;
  readonly root: Hex;
  readonly totalEntitlements: string;
  readonly leafCount: number;
  readonly entries: readonly ManifestEntry<A>[];
}

/** Turn a built tree into the document that gets published. */
export function toManifest<A extends string>(tree: DropTree<A>): Manifest<A> {
  return {
    version: 1,
    drop: tree.drop,
    chainId: tree.chainId,
    root: tree.root,
    totalEntitlements: tree.totalEntitlements.toString(),
    leafCount: tree.leafCount,
    entries: tree.entries.map((entry) => ({
      index: entry.index,
      recipient: entry.recipient,
      amount: entry.amount.toString(),
      proof: [...entry.proof],
    })),
  };
}

/**
 * The canonical JSON bytes of a manifest.
 *
 * Canonical means: keys in a fixed order, no whitespace, no trailing newline. Two machines that
 * hold the same manifest must produce the same bytes, or the hash is worthless. `JSON.stringify`
 * on its own does not guarantee that, so the key order is written out here by hand.
 */
export function canonicalManifestJson(manifest: Manifest<string>): string {
  const entries = manifest.entries.map((entry) => ({
    index: entry.index,
    recipient: entry.recipient,
    amount: entry.amount,
    proof: [...entry.proof],
  }));

  return JSON.stringify({
    version: manifest.version,
    drop: manifest.drop,
    chainId: manifest.chainId,
    root: manifest.root,
    totalEntitlements: manifest.totalEntitlements,
    leafCount: manifest.leafCount,
    entries,
  });
}

/**
 * `keccak256` of the canonical JSON bytes.
 *
 * This is the value written into the drop as `manifestHash`., closed
 */
export function keccakManifestHash(manifest: Manifest<string>): Hex {
  return keccak256(toHex(canonicalManifestJson(manifest)));
}
