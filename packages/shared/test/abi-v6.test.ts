/**
 * The `DropV6`, `DropFactoryV6` and `BinderRegistryV2` ABIs.
 * Generated from the foundry build like every other ABI here (`npm run sync:abi`).
 * `DropV6` is `DropV5` plus `BadIndex`; `DropFactoryV6` is `DropFactoryV5` plus the pause
 * guardian; `BinderRegistryV2` is `BinderRegistry` made `Ownable2Step` with no renounce. Every
 * V5 item the indexer and the relayer use is in them unchanged.
 */
import { describe, expect, it } from "vitest";

import {
  binderRegistryAbi,
  binderRegistryV2Abi,
  dropFactoryV5Abi,
  dropFactoryV6Abi,
  dropV5Abi,
  dropV6Abi,
} from "../src/index.js";

type AbiItem = { readonly type: string; readonly name?: string };

function item(abi: readonly AbiItem[], type: string, name: string) {
  return abi.find((entry) => entry.type === type && entry.name === name);
}

describe("dropV6Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropV6Abi)).toBe(true);
  });

  it("carries every DropV5 item unchanged, NativeReturnFailed and Swept among them", () => {
    for (const entry of dropV5Abi as readonly AbiItem[]) {
      expect(dropV6Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
    expect(item(dropV6Abi, "event", "NativeReturnFailed")).toBeDefined();
    expect(item(dropV6Abi, "event", "Swept")).toBeDefined();
  });

  it("has the error BadIndex(), L-05", () => {
    expect(item(dropV6Abi, "error", "BadIndex")).toEqual({
      type: "error",
      name: "BadIndex",
      inputs: [],
    });
  });
});

describe("dropFactoryV6Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropFactoryV6Abi)).toBe(true);
  });

  it("carries every DropFactoryV5 item unchanged, createDrop and DropCreated among them", () => {
    for (const entry of dropFactoryV5Abi as readonly AbiItem[]) {
      expect(dropFactoryV6Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
    expect(item(dropFactoryV6Abi, "function", "createDrop")).toEqual(
      item(dropFactoryV5Abi, "function", "createDrop"),
    );
    expect(item(dropFactoryV6Abi, "event", "DropCreated")).toEqual(
      item(dropFactoryV5Abi, "event", "DropCreated"),
    );
  });

  it("has the pause guardian: pauseGuardian, setPauseGuardian, pause", () => {
    expect(item(dropFactoryV6Abi, "function", "pauseGuardian")).toEqual({
      type: "function",
      name: "pauseGuardian",
      inputs: [],
      outputs: [{ name: "", type: "address", internalType: "address" }],
      stateMutability: "view",
    });
    expect(item(dropFactoryV6Abi, "function", "setPauseGuardian")).toEqual({
      type: "function",
      name: "setPauseGuardian",
      inputs: [{ name: "newGuardian", type: "address", internalType: "address" }],
      outputs: [],
      stateMutability: "nonpayable",
    });
    expect(item(dropFactoryV6Abi, "function", "pause")).toEqual({
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable",
    });
  });

  it("has the event PauseGuardianSet(address oldGuardian, address newGuardian)", () => {
    expect(item(dropFactoryV6Abi, "event", "PauseGuardianSet")).toEqual({
      type: "event",
      name: "PauseGuardianSet",
      inputs: [
        { name: "oldGuardian", type: "address", indexed: false, internalType: "address" },
        { name: "newGuardian", type: "address", indexed: false, internalType: "address" },
      ],
      anonymous: false,
    });
  });

  it("has the error NotOwnerOrGuardian()", () => {
    expect(item(dropFactoryV6Abi, "error", "NotOwnerOrGuardian")).toEqual({
      type: "error",
      name: "NotOwnerOrGuardian",
      inputs: [],
    });
  });
});

describe("binderRegistryV2Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(binderRegistryV2Abi)).toBe(true);
  });

  it("carries every BinderRegistry item unchanged, but renounceOwnership", () => {
    for (const entry of binderRegistryAbi as readonly AbiItem[]) {
      if (entry.type === "function" && entry.name === "renounceOwnership") continue;
      expect(binderRegistryV2Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
  });

  it("is Ownable2Step: pendingOwner, acceptOwnership, OwnershipTransferStarted", () => {
    expect(item(binderRegistryV2Abi, "function", "pendingOwner")).toBeDefined();
    expect(item(binderRegistryV2Abi, "function", "acceptOwnership")).toBeDefined();
    expect(item(binderRegistryV2Abi, "event", "OwnershipTransferStarted")).toBeDefined();
  });

  it("renounceOwnership is pure and reverts RenounceDisabled", () => {
    const fn = item(binderRegistryV2Abi, "function", "renounceOwnership") as
      { stateMutability: string } | undefined;
    expect(fn?.stateMutability).toBe("pure");
    expect(item(binderRegistryV2Abi, "error", "RenounceDisabled")).toEqual({
      type: "error",
      name: "RenounceDisabled",
      inputs: [],
    });
  });
});
