/**
 * The merkle generator against two fixtures with real, independently produced values.
 *
 * 1. The worked example. The same vector is hard coded in
 *    `contracts/evm/test/MerkleVector.t.sol`, so both sides of the system are pinned to it.
 * 2. The first real drop on Robinhood testnet 46630. Its root is on chain. This one proves the
 *    generator agrees with a contract that already accepted a claim against that root.
 *
 * If either fails, the fixture is not the thing to change.
 */
import { describe, expect, it } from "vitest";
import { keccak256, type Address, type Hex } from "viem";

import {
  buildDropTree,
  buildTree,
  canonicalManifestJson,
  encodeLeaf,
  keccakManifestHash,
  leafHash,
  MAX_LEAVES,
  normalizeReceivers,
  processProof,
  sortedHashPair,
  toManifest,
  verifyProof,
} from "../src/merkle/index.js";

// ---------------------------------------------------------------------------
// Fixture 1 —
// ---------------------------------------------------------------------------

const REFERENCE = {
  chainId: 4663,
  drop: "0xed1522decb0421e76f3d8de2384d4ee401d8cb4a" as Address,
  receivers: [
    {
      recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
      amount: 1_000000000000000000n,
    },
    {
      recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address,
      amount: 2_000000000000000000n,
    },
    {
      recipient: "0xcccccccccccccccccccccccccccccccccccccccc" as Address,
      amount: 3_000000000000000000n,
    },
  ],
  totalEntitlements: 6_000000000000000000n,
  leaf0: "0x7e111c7ad70166fcbc9bd92d5aa8b8f6bd0fe6c99e15908d6ce402a1e92dd693" as Hex,
  leaf1: "0xcf727fc1e4b6087d1e2ce41dffbedb501aade8ee979bcde832db1b93b57e2df8" as Hex,
  leaf2: "0xe8964472f1604d2bb6de853a0b8a69430ebcde367bdbad43f7d784bdd552e985" as Hex,
  node01: "0x24cc9adc3827d7adea8b5974f30ba1c03313f3edaa14a01fc0a6bc3d3daa5190" as Hex,
  root: "0x79a36291f9964ea735e4174dcd8b57e0fbdbc710add1e839693269cfee1a82a7" as Hex,
  inner0: "0x59b55d4e90e24583dccae1796ff438af566c70edf3bbcca7322e9fdb85e0dafc" as Hex,
} as const;

describe("worked example", () => {
  it("encodes the leaf as exactly 160 bytes, five words, in the documented order", () => {
    const encoded = encodeLeaf({
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      index: 0,
      recipient: REFERENCE.receivers[0].recipient,
      amount: REFERENCE.receivers[0].amount,
    });

    // 0x + 160 bytes.
    expect(encoded).toHaveLength(2 + 160 * 2);
    expect(encoded.toLowerCase()).toBe(
      "0x" +
        "000000000000000000000000ed1522decb0421e76f3d8de2384d4ee401d8cb4a" +
        "0000000000000000000000000000000000000000000000000000000000001237" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
        "0000000000000000000000000000000000000000000000000de0b6b3a7640000",
    );
  });

  it("produces the three documented leaves", () => {
    const leaves = REFERENCE.receivers.map((receiver, index) =>
      leafHash({
        drop: REFERENCE.drop,
        chainId: REFERENCE.chainId,
        index,
        recipient: receiver.recipient,
        amount: receiver.amount,
      }),
    );
    expect(leaves).toEqual([REFERENCE.leaf0, REFERENCE.leaf1, REFERENCE.leaf2]);
  });

  it("promotes the odd leaf instead of pairing it with itself", () => {
    const tree = buildTree([REFERENCE.leaf0, REFERENCE.leaf1, REFERENCE.leaf2]);
    expect(tree.layers[1]).toEqual([REFERENCE.node01, REFERENCE.leaf2]);
    expect(tree.root).toBe(REFERENCE.root);
  });

  it("hashes a pair commutatively", () => {
    expect(sortedHashPair(REFERENCE.leaf0, REFERENCE.leaf1)).toBe(REFERENCE.node01);
    expect(sortedHashPair(REFERENCE.leaf1, REFERENCE.leaf0)).toBe(REFERENCE.node01);
  });

  it("builds the documented root, proofs and totals end to end", () => {
    const built = buildDropTree({
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      receivers: REFERENCE.receivers,
      expectedTotal: REFERENCE.totalEntitlements,
    });

    expect(built.root).toBe(REFERENCE.root);
    expect(built.leafCount).toBe(3);
    expect(built.totalEntitlements).toBe(REFERENCE.totalEntitlements);
    expect(built.entries.map((e) => e.proof)).toEqual([
      [REFERENCE.leaf1, REFERENCE.leaf2],
      [REFERENCE.leaf0, REFERENCE.leaf2],
      [REFERENCE.node01],
    ]);
  });

  it("verifies index 1 the way the chain does", () => {
    const step1 = sortedHashPair(REFERENCE.leaf1, REFERENCE.leaf0);
    const step2 = sortedHashPair(step1, REFERENCE.leaf2);
    expect(step1).toBe(REFERENCE.node01);
    expect(step2).toBe(REFERENCE.root);
    expect(processProof(REFERENCE.leaf1, [REFERENCE.leaf0, REFERENCE.leaf2])).toBe(REFERENCE.root);
  });

  it("double hashes the leaf, so a leaf and an internal node live in different domains", () => {
    // A leaf is keccak of 32 bytes, an internal node is keccak of 64 bytes. The inner hash on its
    // own is not the leaf, and it does not verify.
    expect(REFERENCE.inner0).not.toBe(REFERENCE.leaf0);
    expect(keccak256(REFERENCE.inner0)).toBe(REFERENCE.leaf0);
    expect(verifyProof(REFERENCE.inner0, [REFERENCE.leaf1, REFERENCE.leaf2], REFERENCE.root)).toBe(
      false,
    );

    // Note what the design does **not** claim. `verifyProof` is a plain commutative fold, so folding an
    // internal node with the rest of the path does reach the root. That is true of every
    // OpenZeppelin tree. The protection is that the contract never takes a leaf from the caller:
    // it builds the leaf itself from (drop, chainId, index, recipient, amount), and no such input
    // can hash to an internal node, because the two hashes have different preimage lengths.
    expect(verifyProof(REFERENCE.node01, [REFERENCE.leaf2], REFERENCE.root)).toBe(true);
    const anyLeafFromInput = leafHash({
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      index: 0,
      recipient: REFERENCE.receivers[0].recipient,
      amount: REFERENCE.receivers[0].amount,
    });
    expect(anyLeafFromInput).not.toBe(REFERENCE.node01);
  });
});

// ---------------------------------------------------------------------------
// Fixture 2 — the first real drop on Robinhood testnet 46630
// ---------------------------------------------------------------------------

const TESTNET = {
  chainId: 46630,
  drop: "0x01532cdb9fA0AEde791c3295e7c49ADe9b29f315" as Address,
  amount: 100_000_000_000_000n, // 1e14 wei each
  // The three well known anvil addresses, in the order of contracts/evm/script/input/test-receivers.json.
  receivers: [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ] as Address[],
  root: "0xc658ef8de5b06692c794b6d362c4349ae53476fe456621a2de0e7b44445f4a32" as Hex,
} as const;

describe("first Robinhood testnet drop, root read back off chain", () => {
  const built = buildDropTree({
    drop: TESTNET.drop,
    chainId: TESTNET.chainId,
    receivers: TESTNET.receivers.map((recipient) => ({ recipient, amount: TESTNET.amount })),
    expectedTotal: TESTNET.amount * 3n,
  });

  it("reproduces the root the live drop was created with", () => {
    expect(built.root).toBe(TESTNET.root);
  });

  it("sorts by recipient ascending and numbers the leaves in that order", () => {
    expect(built.entries.map((e) => e.recipient)).toEqual([
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    ]);
    expect(built.entries.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it("gives the address that really claimed on chain a proof that verifies", () => {
    // 0x3C44Cddd... claimed leaf 0 in tx 0x3cfae53c... on block 115978914.
    const entry = built.entries.find(
      (e) => e.recipient === "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    );
    expect(entry).toBeDefined();
    expect(entry?.index).toBe(0);
    expect(entry?.amount).toBe(TESTNET.amount);
    expect(verifyProof(entry!.leaf, entry!.proof, built.root)).toBe(true);
  });

  it("is deterministic: input order does not change the root", () => {
    const reversed = buildDropTree({
      drop: TESTNET.drop,
      chainId: TESTNET.chainId,
      receivers: [...TESTNET.receivers]
        .reverse()
        .map((recipient) => ({ recipient, amount: TESTNET.amount })),
    });
    expect(reversed.root).toBe(TESTNET.root);
  });

  it("binds the drop address: another drop with the same crowd has another root", () => {
    const other = buildDropTree({
      drop: "0x000000000000000000000000000000000000dEaD",
      chainId: TESTNET.chainId,
      receivers: TESTNET.receivers.map((recipient) => ({ recipient, amount: TESTNET.amount })),
    });
    expect(other.root).not.toBe(TESTNET.root);
  });

  it("binds the chain id: the same drop on another chain has another root", () => {
    const other = buildDropTree({
      drop: TESTNET.drop,
      chainId: 4663,
      receivers: TESTNET.receivers.map((recipient) => ({ recipient, amount: TESTNET.amount })),
    });
    expect(other.root).not.toBe(TESTNET.root);
  });
});

// ---------------------------------------------------------------------------
// Build rules
// ---------------------------------------------------------------------------

describe("build rules", () => {
  const drop = TESTNET.drop;
  const chainId = TESTNET.chainId;
  const a = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
  const b = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

  it("merges a repeated recipient into one leaf", () => {
    const built = buildDropTree({
      drop,
      chainId,
      receivers: [
        { recipient: a, amount: 1n },
        { recipient: b, amount: 5n },
        { recipient: a, amount: 2n },
      ],
    });
    expect(built.leafCount).toBe(2);
    expect(built.entries.find((e) => e.recipient.toLowerCase() === a)?.amount).toBe(3n);
    expect(built.totalEntitlements).toBe(8n);
  });

  it("treats a mixed case address as the same account", () => {
    const merged = normalizeReceivers([
      { recipient: "0xAAAAaaaaAAAAaaaaAAAAaaaaAaAaAaAaAAAaAAaA", amount: 1n },
      { recipient: a, amount: 1n },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.amount).toBe(2n);
  });

  it("removes zero amount leaves", () => {
    const built = buildDropTree({
      drop,
      chainId,
      receivers: [
        { recipient: a, amount: 0n },
        { recipient: b, amount: 7n },
      ],
    });
    expect(built.leafCount).toBe(1);
    expect(built.entries[0]?.recipient.toLowerCase()).toBe(b);
  });

  it("refuses to publish when the total does not match", () => {
    expect(() =>
      buildDropTree({
        drop,
        chainId,
        receivers: [{ recipient: a, amount: 5n }],
        expectedTotal: 6n,
      }),
    ).toThrow(/total mismatch/);
  });

  it("refuses an empty crowd", () => {
    expect(() => buildDropTree({ drop, chainId, receivers: [] })).toThrow(/at least one receiver/);
    expect(() =>
      buildDropTree({ drop, chainId, receivers: [{ recipient: a, amount: 0n }] }),
    ).toThrow(/at least one receiver/);
  });

  it("refuses a tree above MAX_LEAVES, before any gas is spent", () => {
    const receivers = Array.from({ length: MAX_LEAVES + 1 }, (_, i) => ({
      recipient: `0x${(i + 1).toString(16).padStart(40, "0")}` as const,
      amount: 1n,
    }));
    expect(() => buildDropTree({ drop, chainId, receivers })).toThrow(/MAX_LEAVES/);
  });

  it("rejects a line that is not an address", () => {
    expect(() =>
      normalizeReceivers([{ recipient: "not-an-address" as Address, amount: 1n }]),
    ).toThrow(/not an address/);
  });

  it("handles a one leaf tree, where the leaf is the root and the proof is empty", () => {
    const built = buildDropTree({ drop, chainId, receivers: [{ recipient: a, amount: 1n }] });
    expect(built.root).toBe(built.entries[0]?.leaf);
    expect(built.entries[0]?.proof).toEqual([]);
    expect(verifyProof(built.entries[0]!.leaf, [], built.root)).toBe(true);
  });

  it("every proof verifies for an awkward, non power of two crowd", () => {
    const receivers = Array.from({ length: 37 }, (_, i) => ({
      recipient: `0x${(i + 1).toString(16).padStart(40, "0")}` as const,
      amount: BigInt(i + 1),
    }));
    const built = buildDropTree({ drop, chainId, receivers });
    expect(built.leafCount).toBe(37);
    for (const entry of built.entries) {
      expect(verifyProof(entry.leaf, entry.proof, built.root)).toBe(true);
    }
    // A proof from one index never verifies another index's leaf.
    expect(verifyProof(built.entries[0]!.leaf, built.entries[1]!.proof, built.root)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("manifest", () => {
  const built = buildDropTree({
    drop: TESTNET.drop,
    chainId: TESTNET.chainId,
    receivers: TESTNET.receivers.map((recipient) => ({ recipient, amount: TESTNET.amount })),
  });

  it("publishes drop, chainId, root, total and every index, recipient, amount, proof", () => {
    const manifest = toManifest(built);
    expect(manifest.drop).toBe(TESTNET.drop);
    expect(manifest.chainId).toBe(TESTNET.chainId);
    expect(manifest.root).toBe(TESTNET.root);
    expect(manifest.totalEntitlements).toBe((TESTNET.amount * 3n).toString());
    expect(manifest.leafCount).toBe(3);
    expect(manifest.entries[0]).toEqual({
      index: 0,
      recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      amount: TESTNET.amount.toString(),
      proof: built.entries[0]?.proof,
    });
  });

  it("serialises canonically, so the same manifest always gives the same bytes", () => {
    const manifest = toManifest(built);
    const json = canonicalManifestJson(manifest);
    expect(json).toBe(canonicalManifestJson(JSON.parse(json) as typeof manifest));
    expect(json.startsWith('{"version":1,"drop":')).toBe(true);
    expect(keccakManifestHash(manifest)).toBe(keccakManifestHash(manifest));
  });

  it("a different crowd gives a different manifest hash", () => {
    const other = buildDropTree({
      drop: TESTNET.drop,
      chainId: TESTNET.chainId,
      receivers: [{ recipient: TESTNET.receivers[0]!, amount: TESTNET.amount }],
    });
    expect(keccakManifestHash(toManifest(other))).not.toBe(keccakManifestHash(toManifest(built)));
  });
});
