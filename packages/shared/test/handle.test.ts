/**
 * Handle mode in the shared package: the handle leaf, the handle tree, the version 2 manifest,
 * the EVM binding and the Solana binding.
 *
 * The vectors below are pinned in three places, each written on its own:
 * - here, against this package
 * - `contracts/evm/test/HandleVector.t.sol`, against `MerkleHelper.handleLeafOf`,
 *   `DropV2.bindingDigest` and, for binding v2, `DropV7.bindingDigest`
 * - `contracts/solana/programs/dropchad/tests/fixture.rs`, against the program's `merkle.rs`
 *
 * They were computed from the formulas with plain viem primitives, not from this code.
 * If a test here fails, the vector is not the thing to change.
 */
import { describe, expect, it } from "vitest";
import { hashTypedData, keccak256, toHex, type Address, type Hex } from "viem";

import {
  BINDING_SIGN_AHEAD_SECONDS,
  BINDING_TAG,
  BINDING_TAG_V2,
  ED25519_PROGRAM_ID,
  MAX_BINDING_LIFETIME_SECONDS,
  SVM_BINDING_MESSAGE_BYTES_V2,
  bindingTypedData,
  bindingTypedDataV2,
  ed25519InstructionData,
  evmBindingDigest,
  evmBindingDigestV2,
  svmBindingMessage,
  svmBindingMessageV2,
} from "../src/binding.js";
import {
  HANDLE_LEAF_ENCODED_BYTES,
  HANDLE_LEAF_TAG,
  MAX_X_ID,
  buildHandleDropTree,
  canonicalHandleManifestJson,
  canonicalManifestJson,
  encodeHandleLeaf,
  handleLeafHash,
  keccakHandleManifestHash,
  normalizeHandleReceivers,
  toHandleManifest,
  verifyProof,
} from "../src/merkle/index.js";

// -- the vectors ------------------------------------------------------------------------------

const EVM = {
  drop: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address,
  chainId: 46_630,
  index: 3,
  xId: 44_196_397n,
  amount: 10n ** 15n,
  recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
  leaf: "0x10c3411e3c93eaa075475a3c2e503721a7910653d7798c3469c17436b105127e" as Hex,
  bindingDigest: "0x53bd9528008510e33df2d5499ec3c5ec2f2b7da1f43897582618eea3ff4edc21" as Hex,
};

const SVM = {
  drop: "9ArT5gUTfmD81oKeNL66RhcWrK9nuaoxuJV2wH7QT9Ra",
  chainId: 103,
  index: 3,
  xId: 44_196_397n,
  amount: 1_000_000_000n,
  recipient: "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP",
  leaf: "0x15dc56d9819f08879f1f9831cea3108df5788c328ccab56b392fcf5f98d824e3" as Hex,
  bindingMessageKeccak: "0x08e0ae0376d4df8690797bb38076fde2cfdab166d4a36f83115b65233e233819" as Hex,
};

/**
 * Binding v2: the same leaves, `validUntil` 1,800,000,000. Computed with plain viem
 * primitives; the same method gives the v1 vectors above.
 */
const V2 = {
  validUntil: 1_800_000_000n,
  evmBindingDigest: "0x13e573639b759628e01d5b7b38307b6487b468bf905c6432b22689fef320f883" as Hex,
  svmTag: "0x36d597492a29339b1615b781c8de15000844916f30650c7542815049c4809f6b" as Hex,
  svmBindingMessageKeccak:
    "0xb7a11d0fdfeff78d99b82cc621fb9e3e2d3e0157798ee2c44ed3e465401eda82" as Hex,
};

// -- tags ---------------------------------------------------------------------------------------

describe("tags", () => {
  it("HANDLE_LEAF_TAG is keccak256 of the string", () => {
    expect(HANDLE_LEAF_TAG).toBe(
      "0xa0b22646bbd12226d8c5181512aeffe56b1a4474b4404bc3a1dc79464d135054",
    );
    expect(HANDLE_LEAF_TAG).toBe(keccak256(toHex("dropchad:handle-leaf:v1")));
  });

  it("BINDING_TAG is keccak256 of the string and is not the leaf tag", () => {
    expect(BINDING_TAG).toBe("0x8f3062fe58d32ec73693d0ade6d3544cdfd1ffbbb0abb7661d351fcd5260b923");
    expect(BINDING_TAG).not.toBe(HANDLE_LEAF_TAG);
  });
});

// -- the handle leaf ----------------------------------------------------------------------------

describe("handle leaf", () => {
  it("the EVM vector", () => {
    const input = {
      drop: EVM.drop,
      chainId: EVM.chainId,
      index: EVM.index,
      xId: EVM.xId,
      amount: EVM.amount,
    };
    const frame = encodeHandleLeaf(input);
    expect((frame.length - 2) / 2).toBe(HANDLE_LEAF_ENCODED_BYTES);
    expect(HANDLE_LEAF_ENCODED_BYTES).toBe(192);
    expect(frame.slice(0, 66)).toBe(HANDLE_LEAF_TAG);
    expect(handleLeafHash(input)).toBe(EVM.leaf);
  });

  it("the Solana vector", () => {
    const input = {
      family: "svm" as const,
      drop: SVM.drop,
      chainId: SVM.chainId,
      index: SVM.index,
      xId: SVM.xId,
      amount: SVM.amount,
    };
    expect((encodeHandleLeaf(input).length - 2) / 2).toBe(192);
    expect(handleLeafHash(input)).toBe(SVM.leaf);
  });

  it("an X id of 0 or of 2^64 is refused, 2^64 - 1 is the largest", () => {
    const base = { drop: EVM.drop, chainId: EVM.chainId, index: 0, amount: 1n };
    expect(MAX_X_ID).toBe(2n ** 64n - 1n);
    expect(() => handleLeafHash({ ...base, xId: 0n })).toThrow(/x id/i);
    expect(() => handleLeafHash({ ...base, xId: 2n ** 64n })).toThrow(/x id/i);
    expect(() => handleLeafHash({ ...base, xId: MAX_X_ID })).not.toThrow();
  });
});

// -- the handle tree ----------------------------------------------------------------------------

describe("buildHandleDropTree", () => {
  it("merges one X id, drops zeros, sorts ascending and indexes in that order", () => {
    const out = normalizeHandleReceivers([
      { xId: 30n, amount: 5n },
      { xId: 10n, amount: 1n },
      { xId: 30n, amount: 2n },
      { xId: 20n, amount: 0n },
    ]);
    expect(out).toEqual([
      { xId: 10n, amount: 1n },
      { xId: 30n, amount: 7n },
    ]);
  });

  it("refuses a negative amount and a bad X id", () => {
    expect(() => normalizeHandleReceivers([{ xId: 1n, amount: -1n }])).toThrow(/negative/);
    expect(() => normalizeHandleReceivers([{ xId: 0n, amount: 1n }])).toThrow(/x id/i);
  });

  it("builds a tree whose every proof verifies, on both families", () => {
    const receivers = [
      { xId: 900n, amount: 3n },
      { xId: 100n, amount: 1n },
      { xId: 500n, amount: 2n },
    ];
    const evm = buildHandleDropTree({
      drop: EVM.drop,
      chainId: EVM.chainId,
      receivers,
      expectedTotal: 6n,
    });
    expect(evm.mode).toBe("handle");
    expect(evm.leafCount).toBe(3);
    expect(evm.entries.map((e) => e.xId)).toEqual([100n, 500n, 900n]);
    for (const e of evm.entries) {
      expect(e.leaf).toBe(
        handleLeafHash({
          drop: EVM.drop,
          chainId: EVM.chainId,
          index: e.index,
          xId: e.xId,
          amount: e.amount,
        }),
      );
      expect(verifyProof(e.leaf, e.proof, evm.root)).toBe(true);
    }

    const svm = buildHandleDropTree({
      family: "svm",
      drop: SVM.drop,
      chainId: SVM.chainId,
      receivers,
    });
    expect(svm.root).not.toBe(evm.root);
    for (const e of svm.entries) expect(verifyProof(e.leaf, e.proof, svm.root)).toBe(true);
  });

  it("refuses a total that does not match, and an empty list", () => {
    const receivers = [{ xId: 1n, amount: 1n }];
    expect(() =>
      buildHandleDropTree({ drop: EVM.drop, chainId: 1, receivers, expectedTotal: 2n }),
    ).toThrow(/total/);
    expect(() => buildHandleDropTree({ drop: EVM.drop, chainId: 1, receivers: [] })).toThrow(
      /at least one/,
    );
  });
});

// -- the version 2 manifest ---------------------------------------------------------------------

describe("the handle manifest, version 2", () => {
  const tree = buildHandleDropTree({
    drop: EVM.drop,
    chainId: EVM.chainId,
    receivers: [
      { xId: 44_196_397n, amount: 10n ** 15n },
      { xId: 12n, amount: 7n },
    ],
  });

  it("carries version 2 and mode handle, and never an address or a handle string", () => {
    const m = toHandleManifest(tree);
    expect(m.version).toBe(2);
    expect(m.mode).toBe("handle");
    expect(m.entries[0]).toEqual({ index: 0, xId: "12", amount: "7", proof: m.entries[0]?.proof });
    const json = canonicalHandleManifestJson(m);
    expect(json.startsWith('{"version":2,"mode":"handle","drop":')).toBe(true);
    expect(json).not.toContain("recipient");
  });

  it("the canonical key order is fixed, and the hash is keccak of those bytes", () => {
    const m = toHandleManifest(tree);
    const json = canonicalHandleManifestJson(m);
    const parsed = JSON.parse(json) as { entries: Record<string, unknown>[] };
    expect(Object.keys(parsed)).toEqual([
      "version",
      "mode",
      "drop",
      "chainId",
      "root",
      "totalEntitlements",
      "leafCount",
      "entries",
    ]);
    expect(Object.keys(parsed.entries[0] ?? {})).toEqual(["index", "xId", "amount", "proof"]);
    expect(keccakHandleManifestHash(m)).toBe(keccak256(toHex(json)));
  });

  it("the address manifest is untouched: version 1, no mode key", () => {
    const addressJson = canonicalManifestJson({
      version: 1,
      drop: EVM.drop,
      chainId: 1,
      root: "0x00",
      totalEntitlements: "1",
      leafCount: 1,
      entries: [],
    });
    expect(addressJson).toBe(
      '{"version":1,"drop":"0x5FbDB2315678afecb367f032d93F642f64180aa3","chainId":1,"root":"0x00","totalEntitlements":"1","leafCount":1,"entries":[]}',
    );
  });
});

// -- the EVM binding ---------------------------------------------------------------------

describe("the EVM binding", () => {
  const args = {
    drop: EVM.drop,
    chainId: EVM.chainId,
    index: EVM.index,
    xId: EVM.xId,
    recipient: EVM.recipient,
  };

  it("is plain EIP 712 with the domain and type", () => {
    const td = bindingTypedData(args);
    expect(td.domain).toEqual({
      name: "dropchad",
      version: "1",
      chainId: EVM.chainId,
      verifyingContract: EVM.drop,
    });
    expect(td.primaryType).toBe("Binding");
    expect(td.types.Binding).toEqual([
      { name: "index", type: "uint256" },
      { name: "xId", type: "uint256" },
      { name: "recipient", type: "address" },
    ]);
    expect(hashTypedData(td)).toBe(EVM.bindingDigest);
  });

  it("the digest vector, the same number DropV2.bindingDigest returns", () => {
    expect(evmBindingDigest(args)).toBe(EVM.bindingDigest);
  });

  it("refuses a bad X id before anything is signed", () => {
    expect(() => bindingTypedData({ ...args, xId: 0n })).toThrow(/x id/i);
  });
});

// -- the Solana binding ------------------------------------------------------

describe("the Solana binding", () => {
  const args = {
    drop: SVM.drop,
    chainId: SVM.chainId,
    index: SVM.index,
    xId: SVM.xId,
    recipient: SVM.recipient,
  };

  it("the message vector: 192 bytes, the binding tag first", () => {
    const msg = svmBindingMessage(args);
    expect(msg.length).toBe(192);
    expect(toHex(msg.slice(0, 32))).toBe(BINDING_TAG);
    expect(keccak256(msg)).toBe(SVM.bindingMessageKeccak);
  });

  it("the Ed25519 instruction data is the one strict layout", () => {
    const key = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";
    const sig = new Uint8Array(64).fill(7);
    const msg = svmBindingMessage(args);
    const data = ed25519InstructionData(key, sig, msg);

    expect(ED25519_PROGRAM_ID).toBe("Ed25519SigVerify111111111111111111111111111");
    expect(data.length).toBe(304);
    expect([data[0], data[1]]).toEqual([1, 0]);
    const offsets = [...Array(7).keys()].map(
      (i) => (data[2 + 2 * i] ?? 0) | ((data[3 + 2 * i] ?? 0) << 8),
    );
    expect(offsets).toEqual([48, 0xffff, 16, 0xffff, 112, 192, 0xffff]);
    expect(toHex(data.slice(16, 48))).toBe(
      "0xe6885b3fadc2fcb5b24cd6611f188e5a837651c7dbcb17245a65637bb766df50",
    );
    expect([...data.slice(48, 112)]).toEqual([...sig]);
    expect([...data.slice(112)]).toEqual([...msg]);
  });

  it("refuses a signature or a message of the wrong length", () => {
    const key = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";
    expect(() => ed25519InstructionData(key, new Uint8Array(63), svmBindingMessage(args))).toThrow(
      /64/,
    );
    expect(() => ed25519InstructionData(key, new Uint8Array(64), new Uint8Array(191))).toThrow(
      /192/,
    );
  });
});

// -- binding v2 ------------------------------------------------------------------------

describe("binding v2 constants", () => {
  it("the api signs 600 seconds ahead, the chain takes at most 3600", () => {
    expect(BINDING_SIGN_AHEAD_SECONDS).toBe(600);
    expect(MAX_BINDING_LIFETIME_SECONDS).toBe(3600);
  });
});

describe("the EVM binding v2", () => {
  const args = {
    drop: EVM.drop,
    chainId: EVM.chainId,
    index: EVM.index,
    xId: EVM.xId,
    recipient: EVM.recipient,
    validUntil: V2.validUntil,
  };

  it("is EIP 712 with the same domain and validUntil last in the type", () => {
    const td = bindingTypedDataV2(args);
    expect(td.domain).toEqual({
      name: "dropchad",
      version: "1",
      chainId: EVM.chainId,
      verifyingContract: EVM.drop,
    });
    expect(td.primaryType).toBe("Binding");
    expect(td.types.Binding).toEqual([
      { name: "index", type: "uint256" },
      { name: "xId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "validUntil", type: "uint64" },
    ]);
    expect(hashTypedData(td)).toBe(V2.evmBindingDigest);
  });

  it("the digest vector, the same number DropV7.bindingDigest returns", () => {
    expect(evmBindingDigestV2(args)).toBe(V2.evmBindingDigest);
  });

  it("is never the v1 digest, and validUntil changes it", () => {
    expect(evmBindingDigestV2(args)).not.toBe(EVM.bindingDigest);
    expect(evmBindingDigestV2({ ...args, validUntil: V2.validUntil + 1n })).not.toBe(
      V2.evmBindingDigest,
    );
  });

  it("the v1 builders are unchanged", () => {
    const { validUntil: _, ...v1 } = args;
    expect(evmBindingDigest(v1)).toBe(EVM.bindingDigest);
    expect(bindingTypedData(v1).types.Binding).toHaveLength(3);
  });

  it("refuses a validUntil that is zero, negative or above uint64, and a bad X id", () => {
    expect(() => bindingTypedDataV2({ ...args, validUntil: 0n })).toThrow(/valid ?until/i);
    expect(() => bindingTypedDataV2({ ...args, validUntil: -1n })).toThrow(/valid ?until/i);
    expect(() => bindingTypedDataV2({ ...args, validUntil: 2n ** 64n })).toThrow(/valid ?until/i);
    expect(() => bindingTypedDataV2({ ...args, xId: 0n })).toThrow(/x id/i);
  });
});

describe("the Solana binding v2", () => {
  const args = {
    drop: SVM.drop,
    chainId: SVM.chainId,
    index: SVM.index,
    xId: SVM.xId,
    recipient: SVM.recipient,
    validUntil: V2.validUntil,
  };
  const key = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";

  it("the v2 tag is keccak256 of the string and is neither the v1 tag nor the leaf tag", () => {
    expect(BINDING_TAG_V2).toBe(V2.svmTag);
    expect(BINDING_TAG_V2).toBe(keccak256(toHex("dropchad:binding:v2")));
    expect(BINDING_TAG_V2).not.toBe(BINDING_TAG);
    expect(BINDING_TAG_V2).not.toBe(HANDLE_LEAF_TAG);
  });

  it("the message vector: 200 bytes, the v2 tag first, validUntil last as i64 big endian", () => {
    const msg = svmBindingMessageV2(args);
    expect(SVM_BINDING_MESSAGE_BYTES_V2).toBe(200);
    expect(msg.length).toBe(200);
    expect(toHex(msg.slice(0, 32))).toBe(BINDING_TAG_V2);
    expect(toHex(msg.slice(192))).toBe("0x000000006b49d200");
    expect(keccak256(msg)).toBe(V2.svmBindingMessageKeccak);
  });

  it("the first 160 bytes after the tag are the v1 words", () => {
    const { validUntil: _, ...v1 } = args;
    expect([...svmBindingMessageV2(args).slice(32, 192)]).toEqual([
      ...svmBindingMessage(v1).slice(32, 192),
    ]);
  });

  it("the Ed25519 instruction data is the strict v2 layout, 312 bytes, message size 200", () => {
    const sig = new Uint8Array(64).fill(7);
    const msg = svmBindingMessageV2(args);
    const data = ed25519InstructionData(key, sig, msg);
    expect(data.length).toBe(312);
    expect([data[0], data[1]]).toEqual([1, 0]);
    const offsets = [...Array(7).keys()].map(
      (i) => (data[2 + 2 * i] ?? 0) | ((data[3 + 2 * i] ?? 0) << 8),
    );
    expect(offsets).toEqual([48, 0xffff, 16, 0xffff, 112, 200, 0xffff]);
    expect([...data.slice(48, 112)]).toEqual([...sig]);
    expect([...data.slice(112)]).toEqual([...msg]);
  });

  it("the v1 layout is unchanged, 304 bytes", () => {
    const { validUntil: _, ...v1 } = args;
    expect(ed25519InstructionData(key, new Uint8Array(64), svmBindingMessage(v1)).length).toBe(304);
  });

  it("refuses a message that is neither 192 nor 200 bytes", () => {
    expect(() => ed25519InstructionData(key, new Uint8Array(64), new Uint8Array(199))).toThrow(
      /200/,
    );
  });

  it("refuses a validUntil that is zero, negative or above i64", () => {
    expect(() => svmBindingMessageV2({ ...args, validUntil: 0n })).toThrow(/valid ?until/i);
    expect(() => svmBindingMessageV2({ ...args, validUntil: -5n })).toThrow(/valid ?until/i);
    expect(() => svmBindingMessageV2({ ...args, validUntil: 2n ** 63n })).toThrow(/valid ?until/i);
  });
});
