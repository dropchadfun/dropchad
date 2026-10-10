/**
 * `DropFactoryV4` in the indexer.
 * the fourth factory once all three V4 fields are recorded on top of V3
 * (`hasFeeModelContracts`), its drops must be clones of the same `DropV3` as V3's, and the
 * approval stays per factory. The live robinhood testnet entry carries the deployed
 * V4 set; the other tests here put a made up V4 factory on top of it.
 */
import { getDeployedChain, type DeployedChain } from "@dropchad/chains";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { approvedImplementationFor, factoriesFor } from "../src/factories.js";
import { cloneRuntimeCode, predictedCloneAddress, verifyClone } from "../src/verify-clone.js";

const LIVE = getDeployedChain("robinhood-testnet");

const V4 = {
  factoryV4: "0x00000000000000000000000000000000000000f4",
  // V4 clones the live DropV3.
  implementationV4: LIVE.contracts.implementationV3 as string,
  deployBlockV4: 150_000_000,
};

function withV4(chain: DeployedChain): DeployedChain {
  return { ...chain, contracts: { ...chain.contracts, ...V4 } };
}

const CHAIN = withV4(LIVE);
const FACTORIES = factoriesFor(CHAIN);
const F2 = getAddress(LIVE.contracts.factoryV2 as string);
const DROP_V2 = getAddress(LIVE.contracts.implementationV2 as string);
const F3 = getAddress(LIVE.contracts.factoryV3 as string);
const DROP_V3 = getAddress(LIVE.contracts.implementationV3 as string);
const F4 = getAddress(V4.factoryV4);
const SALT: Hex = keccak256("0x9abc");

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

describe("factoriesFor with DropFactoryV4", () => {
  it("the live entry follows DropFactoryV4 with the same DropV3 from block 130766040", () => {
    const live = factoriesFor(LIVE);
    expect(live.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
      "DropFactoryV4",
    ]);
    expect(live[3]).toEqual({
      name: "DropFactoryV4",
      factory: getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4"),
      implementation: getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6"),
      startBlock: 130_766_040,
    });
  });

  it("adds DropFactoryV4 with DropV3 and its own start block once all three V4 fields are set", () => {
    expect(FACTORIES.map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
      "DropFactoryV3",
      "DropFactoryV4",
    ]);
    expect(FACTORIES[3]).toEqual({
      name: "DropFactoryV4",
      factory: F4,
      implementation: DROP_V3,
      startBlock: V4.deployBlockV4,
    });
  });

  it("keeps the V1, V2 and V3 entries exactly as the live ones", () => {
    expect(FACTORIES.slice(0, 3)).toEqual(factoriesFor(LIVE).slice(0, 3));
  });

  it("not with a V4 field missing", () => {
    const partial = {
      ...LIVE,
      contracts: { ...LIVE.contracts, ...V4, deployBlockV4: null },
    } as DeployedChain;
    expect(factoriesFor(partial).map((entry) => entry.name)).not.toContain("DropFactoryV4");
  });

  it("not without V3 under it: V4 only on top of V3", () => {
    const noV3 = {
      ...CHAIN,
      contracts: {
        ...CHAIN.contracts,
        factoryV3: null,
        implementationV3: null,
        deployBlockV3: null,
      },
    } as DeployedChain;
    expect(factoriesFor(noV3).map((entry) => entry.name)).toEqual([
      "DropFactoryV1",
      "DropFactoryV2",
    ]);
  });
});

describe("the per factory check with DropFactoryV4", () => {
  it("approves DropV3 for DropFactoryV4, whatever the address case", () => {
    expect(approvedImplementationFor(FACTORIES, V4.factoryV4.toLowerCase() as Address)).toBe(
      DROP_V3,
    );
  });

  it("verifies a DropFactoryV4 clone of DropV3, code hash included", () => {
    expect(check({ factory: F4, implementation: DROP_V3 })).toEqual({
      verified: true,
      error: null,
      codeHashChecked: true,
    });
  });

  it("still verifies a DropFactoryV3 clone of DropV3 next to V4", () => {
    expect(check({ factory: F3, implementation: DROP_V3 }).verified).toBe(true);
  });

  it("refuses a DropFactoryV4 event that names DropV2", () => {
    const result = check({ factory: F4, implementation: DROP_V2 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });

  it("refuses a V4 clone address claimed under DropFactoryV3: the address binds the factory", () => {
    const v4Drop = predictedCloneAddress({ factory: F4, implementation: DROP_V3, salt: SALT });
    const result = check({ factory: F3, implementation: DROP_V3, drop: v4Drop });
    expect(result.verified).toBe(false);
  });

  it("refuses a DropFactoryV2 event that names DropV3", () => {
    const result = check({ factory: F2, implementation: DROP_V3 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });
});
