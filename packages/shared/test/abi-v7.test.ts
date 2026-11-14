/**
 * The `DropV7` and `DropFactoryV7` ABIs. Generated from the
 * foundry build like every other ABI here (`npm run sync:abi`). `DropV7` is `DropV6` with binding
 * v2: the seven argument `claimHandle` and the four argument `bindingDigest` replace the old ones,
 * plus `MAX_BINDING_LIFETIME`, `BindingExpired` and `BindingTooLong`. `DropFactoryV7` is
 * `DropFactoryV6` with only its name changed.
 */
import { describe, expect, it } from "vitest";

import { dropFactoryV6Abi, dropFactoryV7Abi, dropV6Abi, dropV7Abi } from "../src/index.js";

type AbiItem = {
  readonly type: string;
  readonly name?: string;
  readonly inputs?: readonly unknown[];
};

function items(abi: readonly AbiItem[], type: string, name: string) {
  return abi.filter((entry) => entry.type === type && entry.name === name);
}

describe("dropV7Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropV7Abi)).toBe(true);
  });

  it("carries every DropV6 item but the old claimHandle and bindingDigest", () => {
    for (const entry of dropV6Abi as readonly AbiItem[]) {
      if (
        entry.type === "function" &&
        (entry.name === "claimHandle" || entry.name === "bindingDigest")
      ) {
        continue;
      }
      expect(dropV7Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
  });

  it("has one claimHandle, with validUntil after recipient.1", () => {
    const fns = items(dropV7Abi, "function", "claimHandle");
    expect(fns).toHaveLength(1);
    expect(fns[0]).toEqual({
      type: "function",
      name: "claimHandle",
      inputs: [
        { name: "index", type: "uint256", internalType: "uint256" },
        { name: "xId", type: "uint256", internalType: "uint256" },
        { name: "amount", type: "uint256", internalType: "uint256" },
        { name: "recipient", type: "address", internalType: "address" },
        { name: "validUntil", type: "uint64", internalType: "uint64" },
        { name: "proof", type: "bytes32[]", internalType: "bytes32[]" },
        { name: "signature", type: "bytes", internalType: "bytes" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    });
  });

  it("has one bindingDigest, with validUntil.2", () => {
    const fns = items(dropV7Abi, "function", "bindingDigest");
    expect(fns).toHaveLength(1);
    expect(fns[0]).toEqual({
      type: "function",
      name: "bindingDigest",
      inputs: [
        { name: "index", type: "uint256", internalType: "uint256" },
        { name: "xId", type: "uint256", internalType: "uint256" },
        { name: "recipient", type: "address", internalType: "address" },
        { name: "validUntil", type: "uint64", internalType: "uint64" },
      ],
      outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
      stateMutability: "view",
    });
  });

  it("has MAX_BINDING_LIFETIME, BindingExpired and BindingTooLong.1 and 1.3", () => {
    expect(items(dropV7Abi, "function", "MAX_BINDING_LIFETIME")).toHaveLength(1);
    expect(items(dropV7Abi, "error", "BindingExpired")[0]).toEqual({
      type: "error",
      name: "BindingExpired",
      inputs: [],
    });
    expect(items(dropV7Abi, "error", "BindingTooLong")[0]).toEqual({
      type: "error",
      name: "BindingTooLong",
      inputs: [],
    });
  });
});

describe("dropFactoryV7Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropFactoryV7Abi)).toBe(true);
  });

  it("is the DropFactoryV6 ABI, item for item", () => {
    expect([...dropFactoryV7Abi]).toEqual([...dropFactoryV6Abi]);
  });
});
