/**
 * `DropFactoryV3` in the indexer.
 * the third factory once all three V3 fields are recorded on top of V2
 * (`hasTokenDropContracts`), its drops must be clones of `DropV3`, and the approval stays per
 * factory. The live robinhood testnet entry carries the deployed V3 set; the other
 * tests here put made up V3 addresses on top of it, with the live V4 taken off, so they
 * test V3 alone.
 */
import { getDeployedChain, type DeployedChain } from "@dropchad/chains";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { approvedImplementationFor, factoriesFor } from "../src/factories.js";
import { cloneRuntimeCode, predictedCloneAddress, verifyClone } from "../src/verify-clone.js";

const LIVE = getDeployedChain("robinhood-testnet");

const V3 = {
  factoryV3: "0x00000000000000000000000000000000000000f3",
  implementationV3: "0x00000000000000000000000000000000000000e3",
  deployBlockV3: 140_000_000,
};

function withV3(chain: DeployedChain): DeployedChain {
  const contracts = { ...chain.contracts, ...V3 };
  return {
    ...chain,
    contracts: { ...contracts, factoryV4: null, implementationV4: null, deployBlockV4: null },
  };
}

const CHAIN = withV3(LIVE);
const FACTORIES = factoriesFor(CHAIN);
const F2 = getAddress(LIVE.contracts.factoryV2 as string);
const DROP_V2 = getAddress(LIVE.contracts.implementationV2 as string);
const F3 = getAddress(V3.factoryV3);
const DROP_V3 = getAddress(V3.implementationV3);
const SALT: Hex = keccak256("0x5678");

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

describe("factoriesFor with DropFactoryV3", () => {
  it("the live entry follows DropFactoryV3 with DropV3 from block 128705054", () => {
    const live = factoriesFor(LIVE);
    expect(live.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
      "DropFactoryV4",
    ]);
    expect(live[2]).toEqual({
      name: "DropFactoryV3",
      factory: getAddress("0xeCD5E1d71dbE6072bb595209E9a19E0A3bBFB384"),
      implementation: getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6"),
      startBlock: 128_705_054,
    });
  });

  it("adds DropFactoryV3 with DropV3 and its own start block once all three V3 fields are set", () => {
    expect(FACTORIES.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
    ]);
    expect(FACTORIES[2]).toEqual({
      name: "DropFactoryV3",
      factory: F3,
      implementation: DROP_V3,
      startBlock: V3.deployBlockV3,
    });
  });

  it("not with a V3 field missing", () => {
    const partial = {
      ...LIVE,
      contracts: { ...LIVE.contracts, ...V3, deployBlockV3: null },
    } as DeployedChain;
    expect(factoriesFor(partial).map((entry) => entry.name)).not.toContain("DropFactoryV3");
  });

  it("not without V2 under it: V3 only on top of V2", () => {
    const noV2 = {
      ...CHAIN,
      contracts: {
        ...CHAIN.contracts,
        factoryV2: null,
        implementationV2: null,
        binderRegistry: null,
        deployBlockV2: null,
      },
    } as DeployedChain;
    expect(factoriesFor(noV2).map((entry) => entry.name)).toEqual(["DropFactoryV1"]);
  });
});

describe("the per factory check with DropFactoryV3", () => {
  it("approves DropV3 for DropFactoryV3, whatever the address case", () => {
    expect(approvedImplementationFor(FACTORIES, V3.factoryV3.toLowerCase() as Address)).toBe(
      DROP_V3,
    );
  });

  it("verifies a DropFactoryV3 clone of DropV3, code hash included", () => {
    expect(check({ factory: F3, implementation: DROP_V3 })).toEqual({
      verified: true,
      error: null,
      codeHashChecked: true,
    });
  });

  it("refuses a DropFactoryV3 event that names DropV2", () => {
    const result = check({ factory: F3, implementation: DROP_V2 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });

  it("refuses a DropFactoryV2 event that names DropV3", () => {
    const result = check({ factory: F2, implementation: DROP_V3 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });
});
