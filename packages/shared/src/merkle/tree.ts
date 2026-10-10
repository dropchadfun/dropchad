/**
 * The tree, exactly as the design defines it.
 *
 * - a parent is `keccak256(a ++ b)` with the two children **sorted ascending as 32 byte
 *   big endian values**. Commutative hashing, the OpenZeppelin `MerkleProof` default, so a proof
 *   carries no left/right flags.
 * - an odd node at any level is promoted unchanged to the next level. It is never paired
 *   with itself and never paired with a zero.
 * - verification on chain is OpenZeppelin `MerkleProof.verifyCalldata`. `verifyProof`
 *   below is the same fold, so a proof that passes here passes there.
 */
import { concat, keccak256, type Hex } from "viem";

/** A tree, bottom layer first. `layers[0]` are the leaves, the last layer is `[root]`. */
export interface MerkleTree {
  readonly layers: readonly (readonly Hex[])[];
  readonly root: Hex;
}

function compareHex(a: Hex, b: Hex): number {
  // Both are 0x + 64 lowercase hex characters of the same length, so a string compare is the same
  // as comparing the 32 byte big endian values. `sortedHashPair` normalises the case first.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `keccak256(sorted(a, b))`. */
export function sortedHashPair(a: Hex, b: Hex): Hex {
  const left = a.toLowerCase() as Hex;
  const right = b.toLowerCase() as Hex;
  return compareHex(left, right) <= 0
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]));
}

/**
 * Build every layer from the leaf hashes.
 *
 * A single leaf is its own root. An empty list has no root and is rejected: a drop with no
 * receivers is not a drop.
 */
export function buildTree(leaves: readonly Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error("merkle tree needs at least one leaf");

  const layers: Hex[][] = [leaves.map((leaf) => leaf.toLowerCase() as Hex)];

  for (;;) {
    const current = layers[layers.length - 1];
    if (current === undefined || current.length <= 1) break;

    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i] as Hex;
      const right = current[i + 1];
      // an odd node is promoted unchanged, never paired with itself.
      next.push(right === undefined ? left : sortedHashPair(left, right));
    }
    layers.push(next);
  }

  const top = layers[layers.length - 1];
  const root = top?.[0];
  if (root === undefined) throw new Error("merkle tree has no root");
  return { layers, root };
}

/**
 * The proof for one leaf index: the sibling at every level, bottom up.
 *
 * A promoted node has no sibling at that level, so nothing is pushed and it simply moves
 * up. That is why a three leaf tree gives index 2 a proof of length one, not two.
 */
export function proofFor(tree: MerkleTree, index: number): Hex[] {
  const leafLayer = tree.layers[0];
  if (leafLayer === undefined || index < 0 || index >= leafLayer.length) {
    throw new Error(`leaf index ${index} is out of range`);
  }

  const proof: Hex[] = [];
  let position = index;

  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const layer = tree.layers[level];
    if (layer === undefined) break;
    const siblingPosition = position % 2 === 0 ? position + 1 : position - 1;
    const sibling = layer[siblingPosition];
    if (sibling !== undefined) proof.push(sibling);
    position = Math.floor(position / 2);
  }

  return proof;
}

/**
 * The same fold OpenZeppelin `MerkleProof` does on chain.
 * Used by the tests, and by the generator to check its own output before publishing.
 */
export function processProof(leaf: Hex, proof: readonly Hex[]): Hex {
  let computed = leaf.toLowerCase() as Hex;
  for (const node of proof) computed = sortedHashPair(computed, node);
  return computed;
}

/** True when `proof` proves `leaf` belongs to `root`. */
export function verifyProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  return processProof(leaf, proof) === (root.toLowerCase() as Hex);
}
