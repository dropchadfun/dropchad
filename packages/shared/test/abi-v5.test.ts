/**
 * The `DropV5` and `DropFactoryV5` ABIs.
 * Generated from the foundry build like every other ABI here (`npm run sync:abi`). `DropV5` is
 * `DropV3` plus `NativeReturnFailed` and two errors; `DropFactoryV5` is `DropFactoryV4` plus the
 * refund check error and `Ownable2Step`. Every V3 and V4 item the indexer and the relayer use is
 * in them unchanged.
 */
import { describe, expect, it } from "vitest";

import { dropFactoryV4Abi, dropFactoryV5Abi, dropV3Abi, dropV5Abi } from "../src/index.js";

type AbiItem = { readonly type: string; readonly name?: string };

function item(abi: readonly AbiItem[], type: string, name: string) {
  return abi.find((entry) => entry.type === type && entry.name === name);
}

describe("dropV5Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropV5Abi)).toBe(true);
  });

  it("carries every DropV3 item unchanged", () => {
    for (const entry of dropV3Abi as readonly AbiItem[]) {
      expect(dropV5Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
  });

  it("has the event NativeReturnFailed(address indexed to, uint256 amount)", () => {
    expect(item(dropV5Abi, "event", "NativeReturnFailed")).toEqual({
      type: "event",
      name: "NativeReturnFailed",
      inputs: [
        { name: "to", type: "address", indexed: true, internalType: "address" },
        { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      ],
      anonymous: false,
    });
  });

  it.each(["RefundRecipientRefused", "ZeroRefundRecipient"])("has the error %s()", (name) => {
    expect(item(dropV5Abi, "error", name)).toEqual({ type: "error", name, inputs: [] });
  });
});

describe("dropFactoryV5Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropFactoryV5Abi)).toBe(true);
  });

  it("carries every DropFactoryV4 item unchanged, but renounceOwnership", () => {
    for (const entry of dropFactoryV4Abi as readonly AbiItem[]) {
      if (entry.type === "function" && entry.name === "renounceOwnership") continue;
      expect(dropFactoryV5Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
    expect(item(dropFactoryV5Abi, "event", "DropCreated")).toEqual(
      item(dropFactoryV4Abi, "event", "DropCreated"),
    );
    expect(item(dropFactoryV5Abi, "function", "createDrop")).toEqual(
      item(dropFactoryV4Abi, "function", "createDrop"),
    );
  });

  it.each(["RefundRecipientRefused", "RenounceDisabled"])("has the error %s()", (name) => {
    expect(item(dropFactoryV5Abi, "error", name)).toEqual({ type: "error", name, inputs: [] });
  });

  it("is Ownable2Step: pendingOwner, acceptOwnership, OwnershipTransferStarted", () => {
    expect(item(dropFactoryV5Abi, "function", "pendingOwner")).toBeDefined();
    expect(item(dropFactoryV5Abi, "function", "acceptOwnership")).toBeDefined();
    expect(item(dropFactoryV5Abi, "event", "OwnershipTransferStarted")).toBeDefined();
  });

  it("renounceOwnership is pure: it can only revert", () => {
    const fn = item(dropFactoryV5Abi, "function", "renounceOwnership") as
      { stateMutability: string } | undefined;
    expect(fn?.stateMutability).toBe("pure");
  });
});
