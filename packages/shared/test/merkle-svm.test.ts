/**
 * The Solana side of the shared builder against the worked example.
 * The same vector is hard coded in `contracts/solana/programs/dropchad/tests/fixture.rs`, so the
 * TypeScript builder and the on chain verifier are pinned to the same bytes.
 *
 * If a test here fails, the fixture is not the thing to change.
 */
import { describe, expect, it } from "vitest";
import { type Hex } from "viem";

import {
  base58Decode,
  base58Encode,
  buildDropTree,
  canonicalManifestJson,
  encodeLeaf,
  hexToPubkey,
  isPubkey,
  leafHash,
  normalizeSvmReceivers,
  pubkeyToHex,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  toManifest,
} from "../src/merkle/index.js";

const REFERENCE = {
  programId: "EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft",
  chainId: SOLANA_DEVNET_CHAIN_ID,
  drop: "G5wphfR2mffv3dd2yWb5eFioBf1BFGVtAZfbG6CXQbh5",
  dropHex: "0xe0239d742435ee47a148204da3a775f25ae860ad47e10e68bd8b8a1ceeb769f4" as Hex,
  receivers: [
    { recipient: "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB", amount: 1_000_000_000n },
    { recipient: "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC", amount: 2_000_000_000n },
    { recipient: "EnTJCS15dqbDTU2XywYSMaScoPv4Py4GzExrtY9DQxoD", amount: 3_000_000_000n },
  ],
  totalEntitlements: 6_000_000_000n,
  inner0: "0xa963d93e54ccf3fe75bf3178baf98bd3786c7480a223e40e64d0f63f45002232" as Hex,
  leaf0: "0xab4deca79371f377ac4bf9999a071a50364894a81127480a3a02bbe80b8f9624" as Hex,
  leaf1: "0x08ef04e850b1ceef45a3036d9aef89a1baeb98afdb1def697624ce821face04e" as Hex,
  leaf2: "0x2b1baecfb6d086c3e821a1a41643cf7a99892baf7c533547d41879698b639ec8" as Hex,
  node01: "0xdc19519425da901d003d8666f1b1fe5b2300c023377ca9218b0586c12ba848ce" as Hex,
  root: "0xc5154a707e5ff37be7e1eb3a22a0d87a9d28c59f88a4df3d96d7c94672b0e889" as Hex,
} as const;

describe("base58", () => {
  it("round trips the program id and the example keys", () => {
    for (const key of [
      REFERENCE.programId,
      REFERENCE.drop,
      ...REFERENCE.receivers.map((r) => r.recipient),
    ]) {
      expect(base58Encode(base58Decode(key))).toBe(key);
      expect(isPubkey(key)).toBe(true);
    }
  });

  it("decodes the drop PDA to the bytes in the design", () => {
    expect(pubkeyToHex(REFERENCE.drop)).toBe(REFERENCE.dropHex);
    expect(hexToPubkey(REFERENCE.dropHex)).toBe(REFERENCE.drop);
  });

  it("decodes the example recipients to repeated bytes", () => {
    expect(pubkeyToHex(REFERENCE.receivers[0].recipient)).toBe(`0x${"aa".repeat(32)}`);
    expect(pubkeyToHex(REFERENCE.receivers[1].recipient)).toBe(`0x${"bb".repeat(32)}`);
    expect(pubkeyToHex(REFERENCE.receivers[2].recipient)).toBe(`0x${"cc".repeat(32)}`);
  });

  it("keeps leading zero bytes", () => {
    const zeros = new Uint8Array(32);
    expect(base58Encode(zeros)).toBe("1".repeat(32));
    expect(base58Decode("1".repeat(32))).toEqual(zeros);
  });

  it("rejects things that are not a 32 byte key", () => {
    expect(isPubkey("0xed1522decb0421e76f3d8de2384d4ee401d8cb4a")).toBe(false);
    expect(isPubkey("not a key")).toBe(false);
    expect(isPubkey("abc")).toBe(false);
    expect(() => pubkeyToHex("abc")).toThrow(/32 byte/);
  });
});

describe("worked example", () => {
  it("uses the chain id constants of", () => {
    expect(SOLANA_MAINNET_CHAIN_ID).toBe(101);
    expect(SOLANA_DEVNET_CHAIN_ID).toBe(103);
  });

  it("encodes the leaf as exactly 160 bytes, five words, raw keys in their words", () => {
    const encoded = encodeLeaf({
      family: "svm",
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      index: 0,
      recipient: REFERENCE.receivers[0].recipient,
      amount: REFERENCE.receivers[0].amount,
    });
    expect(encoded).toHaveLength(2 + 160 * 2);
    expect(encoded.toLowerCase()).toBe(
      "0x" +
        "e0239d742435ee47a148204da3a775f25ae860ad47e10e68bd8b8a1ceeb769f4" +
        "0000000000000000000000000000000000000000000000000000000000000067" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
        "000000000000000000000000000000000000000000000000000000003b9aca00",
    );
  });

  it("produces the three documented leaves", () => {
    const leaves = REFERENCE.receivers.map((receiver, index) =>
      leafHash({
        family: "svm",
        drop: REFERENCE.drop,
        chainId: REFERENCE.chainId,
        index,
        recipient: receiver.recipient,
        amount: receiver.amount,
      }),
    );
    expect(leaves).toEqual([REFERENCE.leaf0, REFERENCE.leaf1, REFERENCE.leaf2]);
  });

  it("builds the documented root, proofs and totals end to end", () => {
    const built = buildDropTree({
      family: "svm",
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      receivers: REFERENCE.receivers,
      expectedTotal: REFERENCE.totalEntitlements,
    });
    expect(built.family).toBe("svm");
    expect(built.root).toBe(REFERENCE.root);
    expect(built.tree.layers[1]).toEqual([REFERENCE.node01, REFERENCE.leaf2]);
    expect(built.leafCount).toBe(3);
    expect(built.totalEntitlements).toBe(REFERENCE.totalEntitlements);
    expect(built.entries.map((e) => e.proof)).toEqual([
      [REFERENCE.leaf1, REFERENCE.leaf2],
      [REFERENCE.leaf0, REFERENCE.leaf2],
      [REFERENCE.node01],
    ]);
  });

  it("sorts by the raw bytes of the key, not by the base58 text", () => {
    const shuffled = [REFERENCE.receivers[2], REFERENCE.receivers[0], REFERENCE.receivers[1]];
    const built = buildDropTree({
      family: "svm",
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      receivers: shuffled,
    });
    expect(built.entries.map((e) => e.recipient)).toEqual(
      REFERENCE.receivers.map((r) => r.recipient),
    );
    expect(built.root).toBe(REFERENCE.root);
  });

  it("merges a duplicate key and drops a zero amount", () => {
    const normalized = normalizeSvmReceivers([
      { recipient: REFERENCE.receivers[1].recipient, amount: 1n },
      { recipient: REFERENCE.receivers[0].recipient, amount: 0n },
      { recipient: REFERENCE.receivers[1].recipient, amount: 2n },
    ]);
    expect(normalized).toEqual([{ recipient: REFERENCE.receivers[1].recipient, amount: 3n }]);
  });

  it("refuses an amount that does not fit u64", () => {
    expect(() =>
      leafHash({
        family: "svm",
        drop: REFERENCE.drop,
        chainId: REFERENCE.chainId,
        index: 0,
        recipient: REFERENCE.receivers[0].recipient,
        amount: 2n ** 64n,
      }),
    ).toThrow(/u64/);
  });

  it("gives a different root on mainnet for the same drop and crowd", () => {
    const mainnet = buildDropTree({
      family: "svm",
      drop: REFERENCE.drop,
      chainId: SOLANA_MAINNET_CHAIN_ID,
      receivers: REFERENCE.receivers,
    });
    expect(mainnet.root).not.toBe(REFERENCE.root);
  });

  it("publishes a manifest with base58 keys and the same canonical key order", () => {
    const built = buildDropTree({
      family: "svm",
      drop: REFERENCE.drop,
      chainId: REFERENCE.chainId,
      receivers: REFERENCE.receivers,
    });
    const manifest = toManifest(built);
    expect(manifest.drop).toBe(REFERENCE.drop);
    expect(manifest.entries[0]?.recipient).toBe(REFERENCE.receivers[0].recipient);
    expect(
      canonicalManifestJson(manifest).startsWith(
        `{"version":1,"drop":"${REFERENCE.drop}","chainId":103,`,
      ),
    ).toBe(true);
  });

  it("refuses an EVM address in the svm family and a key in the evm family", () => {
    expect(() =>
      buildDropTree({
        family: "svm",
        drop: "0xed1522decb0421e76f3d8de2384d4ee401d8cb4a",
        chainId: REFERENCE.chainId,
        receivers: REFERENCE.receivers,
      }),
    ).toThrow(/public key/);
    expect(() =>
      buildDropTree({
        drop: "0xed1522decb0421e76f3d8de2384d4ee401d8cb4a",
        chainId: 4663,
        receivers: [{ recipient: REFERENCE.drop as never, amount: 1n }],
      }),
    ).toThrow(/not an address/);
  });
});
