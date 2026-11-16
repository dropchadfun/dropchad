/**
 * `DropFactoryV6` in the indexer.
 * the sixth factory once the V6 set is recorded (`hasV6Contracts`), its drops must be clones of
 * `DropV6`, the approval stays per factory, and a chain with the V6 set alone (the mainnet shape)
 * is followed with `DropFactoryV6` only. The live robinhood testnet entry carries the deployed V6
 * set since; the shapes below use made up addresses.
 */
import { getChain, getDeployedChain } from "@dropchad/chains";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  approvedImplementationFor,
  factoriesFor,
  isIndexable,
  type IndexedChain,
} from "../src/factories.js";
import { cloneRuntimeCode, predictedCloneAddress, verifyClone } from "../src/verify-clone.js";

const F6 = getAddress("0x00000000000000000000000000000000000000f6");
const DROP_V6 = getAddress("0x00000000000000000000000000000000000000d6");
const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
const DROP_V5 = getAddress("0x39C2789dE00750a53987b140BE8b631965eBC933");
const F5 = getAddress("0xF01FF6f70482955078AF1cF774bd500E9276AFdc");
const SALT: Hex = keccak256("0x9abd");
const v6 = {
  factoryV6: F6,
  implementationV6: DROP_V6,
  binderRegistryV2: REGISTRY_V2,
  deployBlockV6: 140_000_000,
};

/** Robinhood testnet with V6 recorded on top of its V5: the testnet shape. */
const TESTNET = getDeployedChain("robinhood-testnet");
const ON_TOP = { ...TESTNET, contracts: { ...TESTNET.contracts, ...v6 } };
/** Robinhood mainnet with the V6 set alone, every V1 to V5 field null: the mainnet shape. */
const MAINNET = getChain("robinhood");
const ALONE: IndexedChain = (() => {
  // Without the V7 record mainnet carries since, so V6 is the only set.
  const noV7 = { factoryV7: null, implementationV7: null, deployBlockV7: null };
  const chain = { ...MAINNET, contracts: { ...MAINNET.contracts, ...v6, ...noV7 } };
  if (!isIndexable(chain)) throw new Error("the V6 only chain should be indexable");
  return chain;
})();

describe("factoriesFor with DropFactoryV6", () => {
  it("the live testnet entry follows DropFactoryV6 with DropV6 from block 140304587", () => {
    const live = factoriesFor(TESTNET);
    expect(live.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
      "DropFactoryV4",
      "DropFactoryV5",
      "DropFactoryV6",
      "DropFactoryV7",
    ]);
    expect(live[5]).toEqual({
      name: "DropFactoryV6",
      factory: getAddress("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba"),
      implementation: getAddress("0x5fbe17722728C8A34bF4763B83Eb699774133D1F"),
      startBlock: 140_304_587,
    });
  });

  it("V6 on top of V5: the sixth factory, DropV6 from deployBlockV6", () => {
    const factories = factoriesFor(ON_TOP);
    expect(factories.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
      "DropFactoryV4",
      "DropFactoryV5",
      "DropFactoryV6",
      "DropFactoryV7",
    ]);
    expect(factories[5]).toEqual({
      name: "DropFactoryV6",
      factory: F6,
      implementation: DROP_V6,
      startBlock: 140_000_000,
    });
  });

  it("V6 alone, the mainnet shape: DropFactoryV6 is the only factory", () => {
    expect(factoriesFor(ALONE)).toEqual([
      { name: "DropFactoryV6", factory: F6, implementation: DROP_V6, startBlock: 140_000_000 },
    ]);
  });
});

describe("the per factory check with DropFactoryV6", () => {
  const factories = factoriesFor(ON_TOP);
  const check = (args: { factory: Address; implementation: Address }) => {
    const approved = approvedImplementationFor(factories, args.factory);
    if (approved === null) return { verified: false, error: "unknown factory" };
    return verifyClone({
      drop: predictedCloneAddress({ ...args, salt: SALT }),
      factory: args.factory,
      implementation: args.implementation,
      approvedImplementation: approved,
      salt: SALT,
      deployedCode: cloneRuntimeCode(args.implementation),
    });
  };

  it("approves DropV6 for DropFactoryV6, whatever the address case", () => {
    expect(approvedImplementationFor(factories, F6.toLowerCase() as Address)).toBe(DROP_V6);
  });

  it("verifies a DropFactoryV6 clone of DropV6, code hash included", () => {
    expect(check({ factory: F6, implementation: DROP_V6 })).toEqual({
      verified: true,
      error: null,
      codeHashChecked: true,
    });
  });

  it("refuses a DropFactoryV6 event that names DropV5, and a DropFactoryV5 one that names DropV6", () => {
    expect(check({ factory: F6, implementation: DROP_V5 }).error).toContain("is not the approved");
    expect(check({ factory: F5, implementation: DROP_V6 }).error).toContain("is not the approved");
  });

  it("on a V6 only chain no older factory is approved", () => {
    expect(approvedImplementationFor(factoriesFor(ALONE), F5)).toBeNull();
  });
});
