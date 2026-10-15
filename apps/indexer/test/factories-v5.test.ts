/**
 * `DropFactoryV5` in the indexer.
 * the fifth factory once all three V5 fields are recorded on top of V4
 * (`hasRefundSafeContracts`), its drops must be clones of `DropV5`, never the V3 `DropV3`, and
 * the approval stays per factory. The live robinhood testnet entry carries the deployed V5 set.
 */
import { getDeployedChain } from "@dropchad/chains";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { approvedImplementationFor, factoriesFor } from "../src/factories.js";
import { cloneRuntimeCode, predictedCloneAddress, verifyClone } from "../src/verify-clone.js";

const LIVE = getDeployedChain("robinhood-testnet");
const FACTORIES = factoriesFor(LIVE);
const F4 = getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4");
const DROP_V3 = getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6");
const F5 = getAddress("0xF01FF6f70482955078AF1cF774bd500E9276AFdc");
const DROP_V5 = getAddress("0x39C2789dE00750a53987b140BE8b631965eBC933");
const SALT: Hex = keccak256("0x9abd");

function check(args: { factory: Address; implementation: Address; drop?: Address }) {
  const approved = approvedImplementationFor(FACTORIES, args.factory);
  if (approved === null) return { verified: false, error: "unknown factory" };
  return verifyClone({
    drop:
      args.drop ??
      predictedCloneAddress({
        factory: args.factory,
        implementation: args.implementation,
        salt: SALT,
      }),
    factory: args.factory,
    implementation: args.implementation,
    approvedImplementation: approved,
    salt: SALT,
    deployedCode: cloneRuntimeCode(args.implementation),
  });
}

describe("factoriesFor with DropFactoryV5", () => {
  it("the live entry follows DropFactoryV5 with DropV5 from block 134603946", () => {
    expect(FACTORIES.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
      "DropFactoryV4",
      "DropFactoryV5",
    ]);
    expect(FACTORIES[4]).toEqual({
      name: "DropFactoryV5",
      factory: F5,
      implementation: DROP_V5,
      startBlock: 134_603_946,
    });
  });

  it("keeps DropFactoryV4 with the same DropV3 next to it: V4 drops keep counting", () => {
    expect(FACTORIES[3]).toEqual({
      name: "DropFactoryV4",
      factory: F4,
      implementation: DROP_V3,
      startBlock: 130_766_040,
    });
  });

  it("not with a V5 field missing", () => {
    const partial = { ...LIVE, contracts: { ...LIVE.contracts, deployBlockV5: null } };
    expect(factoriesFor(partial).map((entry) => entry.name)).not.toContain("DropFactoryV5");
  });

  it("not without V4 under it: V5 only on top of V4", () => {
    const noV4 = {
      ...LIVE,
      contracts: {
        ...LIVE.contracts,
        factoryV4: null,
        implementationV4: null,
        deployBlockV4: null,
      },
    };
    expect(factoriesFor(noV4).map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
    ]);
  });
});

describe("the per factory check with DropFactoryV5", () => {
  it("approves DropV5 for DropFactoryV5, whatever the address case", () => {
    expect(approvedImplementationFor(FACTORIES, F5.toLowerCase() as Address)).toBe(DROP_V5);
  });

  it("verifies a DropFactoryV5 clone of DropV5, code hash included", () => {
    expect(check({ factory: F5, implementation: DROP_V5 })).toEqual({
      verified: true,
      error: null,
      codeHashChecked: true,
    });
  });

  it("refuses a DropFactoryV5 event that names the V3 DropV3", () => {
    const result = check({ factory: F5, implementation: DROP_V3 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });

  it("refuses a DropFactoryV4 event that names DropV5", () => {
    const result = check({ factory: F4, implementation: DROP_V5 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });

  it("refuses a V5 clone address claimed under DropFactoryV4: the address binds the factory", () => {
    const v5Drop = predictedCloneAddress({ factory: F5, implementation: DROP_V5, salt: SALT });
    expect(check({ factory: F4, implementation: DROP_V3, drop: v5Drop }).verified).toBe(false);
  });
});
