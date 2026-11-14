/**
 * `DropFactoryV7` in the indexer: the
 * seventh factory once the V7 set is recorded (`hasV7Contracts`), its drops must be clones of
 * `DropV7`, the approval stays per factory, and a chain with the V7 set alone (the mainnet shape)
 * is followed with `DropFactoryV7` only. The live robinhood testnet entry carries the deployed V7
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

const F7 = getAddress("0x00000000000000000000000000000000000000f7");
const DROP_V7 = getAddress("0x00000000000000000000000000000000000000d7");
const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
const F6 = getAddress("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba");
const DROP_V6 = getAddress("0x5fbe17722728C8A34bF4763B83Eb699774133D1F");
const SALT: Hex = keccak256("0x9abe");
const v7 = { factoryV7: F7, implementationV7: DROP_V7, deployBlockV7: 150_000_000 };

/** Robinhood testnet with V7 recorded on top of its V6: the testnet shape. */
const TESTNET = getDeployedChain("robinhood-testnet");
const ON_TOP = { ...TESTNET, contracts: { ...TESTNET.contracts, ...v7 } };
/** Robinhood mainnet with the V7 set alone and `binderRegistryV2`: the mainnet shape. */
const MAINNET = getChain("robinhood");
const ALONE: IndexedChain = (() => {
  const chain = {
    ...MAINNET,
    contracts: { ...MAINNET.contracts, ...v7, binderRegistryV2: REGISTRY_V2 },
  };
  if (!isIndexable(chain)) throw new Error("the V7 only chain should be indexable");
  return chain;
})();

describe("factoriesFor with DropFactoryV7", () => {
  it("the live testnet entry follows DropFactoryV7 with DropV7 from block 142267213", () => {
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
    expect(live[6]).toEqual({
      name: "DropFactoryV7",
      factory: getAddress("0x61147e60e8F264c760b88Dd38C002B5bdF47254f"),
      implementation: getAddress("0x9274c88d7431Ef7533309cCC77bB9c1AdEB16720"),
      startBlock: 142_267_213,
    });
  });

  it("V7 on top of V6: the seventh factory, DropV7 from deployBlockV7", () => {
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
    expect(factories[6]).toEqual({
      name: "DropFactoryV7",
      factory: F7,
      implementation: DROP_V7,
      startBlock: 150_000_000,
    });
  });

  it("V7 alone, the mainnet shape: DropFactoryV7 is the only factory", () => {
    expect(factoriesFor(ALONE)).toEqual([
      { name: "DropFactoryV7", factory: F7, implementation: DROP_V7, startBlock: 150_000_000 },
    ]);
  });
});

describe("the per factory check with DropFactoryV7", () => {
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

  it("approves DropV7 for DropFactoryV7, whatever the address case", () => {
    expect(approvedImplementationFor(factories, F7.toLowerCase() as Address)).toBe(DROP_V7);
  });

  it("verifies a DropFactoryV7 clone of DropV7, code hash included", () => {
    expect(check({ factory: F7, implementation: DROP_V7 })).toEqual({
      verified: true,
      error: null,
      codeHashChecked: true,
    });
  });

  it("refuses a DropFactoryV7 event naming DropV6, and a DropFactoryV6 event naming DropV7", () => {
    expect(check({ factory: F7, implementation: DROP_V6 }).error).toContain("is not the approved");
    expect(check({ factory: F6, implementation: DROP_V7 }).error).toContain("is not the approved");
  });

  it("on a V7 only chain no older factory is approved", () => {
    expect(approvedImplementationFor(factoriesFor(ALONE), F6)).toBeNull();
  });
});
