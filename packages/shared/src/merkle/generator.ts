/**
 * The merkle generator, exactly as the design define it.
 * One builder for both chains; the `family` picks how addresses are read, deduplicated and sorted.
 *
 * - recipients are deduplicated **before** the tree is built. The same address
 *   twice is merged into one leaf. Two leaves for one address are forbidden.
 * - leaves are sorted by `recipient` ascending, then `index` is `0, 1, 2...`
 *   in that order. EVM compares the 20 byte address, Solana the 32 raw bytes of the key, both as
 *   unsigned big endian numbers. The same input list always gives the same root.
 * - every `amount` is greater than zero. Zero amount leaves are removed.
 * - `sum(amount) == totalEntitlements`, exactly. The generator refuses to
 *   publish otherwise.
 * - `leafCount` is the number of leaves.
 *
 * `MAX_LEAVES` is the contract constant from
 * the same number on both chains. The generator refuses a bigger tree here rather than letting
 * creation fail after the relayer has already paid.
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";

import { hexToPubkey, isPubkey, pubkeyToHex } from "./base58.js";
import { leafHash, type LeafFamily } from "./leaf.js";
import { buildTree, proofFor, verifyProof, type MerkleTree } from "./tree.js";

/** A 10,000 leaf tree gives a proof of exactly 14 nodes. */
export const MAX_LEAVES = 10_000;

/**
 * The rent exempt minimum for an account with no data. A SOL leaf
 * below it cannot be paid to a fresh wallet, the runtime refuses the transfer. The builder does
 * not know whether an svm drop is SOL or SPL, so the backend applies this bound.
 */
export const MIN_SOL_LEAF_LAMPORTS = 890_880n;

/** One line of the pasted address list, before any normalisation. `A` is the address type. */
export interface Receiver<A extends string = Address> {
  readonly recipient: A;
  readonly amount: bigint;
}

/** One leaf of the finished tree, with everything a claimer needs. */
export interface DropTreeEntry<A extends string = Address> {
  readonly index: number;
  readonly recipient: A;
  readonly amount: bigint;
  readonly leaf: Hex;
  readonly proof: readonly Hex[];
}

export interface DropTree<A extends string = Address> {
  readonly family: LeafFamily;
  readonly drop: A;
  readonly chainId: number;
  readonly root: Hex;
  readonly leafCount: number;
  readonly totalEntitlements: bigint;
  readonly entries: readonly DropTreeEntry<A>[];
  readonly tree: MerkleTree;
}

export interface BuildDropTreeArgs<A extends string = Address> {
  /** `evm` when absent. */
  readonly family?: LeafFamily;
  /** The clone address or the drop PDA. It must be known **before** the tree is built. */
  readonly drop: A;
  readonly chainId: number;
  readonly receivers: readonly Receiver<A>[];
  /**
   * When given, the generator checks `sum(amount)` against it and throws on a mismatch.
   * Pass it whenever the total was decided somewhere else, so the two can never drift apart.
   */
  readonly expectedTotal?: bigint;
}

/**
 * EVM. Dedupe, drop zeros, sort.
 *
 * Addresses are compared case insensitively, because `0xAaAa...` and `0xaaaa...` are the same
 * account and must never become two leaves. The returned addresses are checksummed.
 */
export function normalizeReceivers(receivers: readonly Receiver[]): Receiver[] {
  const merged = new Map<string, bigint>();

  for (const receiver of receivers) {
    if (!isAddress(receiver.recipient, { strict: false })) {
      throw new Error(`not an address: ${String(receiver.recipient)}`);
    }
    if (receiver.amount < 0n) {
      throw new Error(`negative amount for ${receiver.recipient}`);
    }
    const key = receiver.recipient.toLowerCase();
    merged.set(key, (merged.get(key) ?? 0n) + receiver.amount);
  }

  return [...merged.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([recipient, amount]) => ({ recipient: getAddress(recipient), amount }));
}

/**
 * Solana. Dedupe by the 32 raw bytes, drop zeros, sort by the raw bytes.
 *
 * Base58 is case sensitive and one key has one spelling, so the raw bytes are the identity. The
 * sort is on the hex of those bytes, which orders them as unsigned big endian numbers, the same
 * rule the EVM path applies to its 20 byte addresses.
 */
export function normalizeSvmReceivers(receivers: readonly Receiver<string>[]): Receiver<string>[] {
  const merged = new Map<Hex, bigint>();

  for (const receiver of receivers) {
    if (!isPubkey(receiver.recipient)) {
      throw new Error(`not a public key: ${String(receiver.recipient)}`);
    }
    if (receiver.amount < 0n) {
      throw new Error(`negative amount for ${receiver.recipient}`);
    }
    const key = pubkeyToHex(receiver.recipient);
    merged.set(key, (merged.get(key) ?? 0n) + receiver.amount);
  }

  return [...merged.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([hex, amount]) => ({ recipient: hexToPubkey(hex), amount }));
}

/**
 * Build the whole tree for a drop: root, leaf count, total, and a proof per receiver.
 *
 * Every proof is verified against the root before this returns. The generator never hands out a
 * proof it has not checked itself.
 */
export function buildDropTree(
  args: BuildDropTreeArgs<Address> & { readonly family?: "evm" },
): DropTree<Address>;
export function buildDropTree(
  args: BuildDropTreeArgs<string> & { readonly family: "svm" },
): DropTree<string>;
export function buildDropTree(args: BuildDropTreeArgs<string>): DropTree<string> {
  const family: LeafFamily = args.family ?? "evm";

  let drop: string;
  let receivers: Receiver<string>[];
  if (family === "svm") {
    if (!isPubkey(args.drop)) throw new Error(`not a public key: ${args.drop}`);
    drop = args.drop;
    receivers = normalizeSvmReceivers(args.receivers);
  } else {
    drop = getAddress(args.drop);
    receivers = normalizeReceivers(args.receivers as readonly Receiver[]);
  }

  if (receivers.length === 0) {
    throw new Error("a drop needs at least one receiver with a non zero amount");
  }
  if (receivers.length > MAX_LEAVES) {
    throw new Error(`too many leaves: ${receivers.length} > MAX_LEAVES ${MAX_LEAVES}`);
  }

  const totalEntitlements = receivers.reduce((sum, r) => sum + r.amount, 0n);
  if (args.expectedTotal !== undefined && args.expectedTotal !== totalEntitlements) {
    // Refuse to publish rather than create a drop that can never pay everyone.
    throw new Error(
      `total mismatch: leaves sum to ${totalEntitlements}, expected ${args.expectedTotal}`,
    );
  }

  const leaves = receivers.map((receiver, index) =>
    family === "svm"
      ? leafHash({
          family: "svm",
          drop,
          chainId: args.chainId,
          index,
          recipient: receiver.recipient,
          amount: receiver.amount,
        })
      : leafHash({
          drop: drop as Address,
          chainId: args.chainId,
          index,
          recipient: receiver.recipient as Address,
          amount: receiver.amount,
        }),
  );

  const tree = buildTree(leaves);

  const entries: DropTreeEntry<string>[] = receivers.map((receiver, index) => {
    const leaf = leaves[index] as Hex;
    const proof = proofFor(tree, index);
    if (!verifyProof(leaf, proof, tree.root)) {
      throw new Error(`generated proof does not verify for index ${index}`);
    }
    return { index, recipient: receiver.recipient, amount: receiver.amount, leaf, proof };
  });

  return {
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
