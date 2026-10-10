/**
 * the per factory implementation check the design and
 * `verifyClone` is unchanged; what changes is the pair it is given: the factory
 * that emitted `DropCreated`, and the implementation the registry approves **for that factory**.
 * A `DropFactoryV1` drop must be a clone of `DropV1`, a `DropFactoryV2` drop a clone of `DropV2`.
 */
import { getDeployedChain } from "@dropchad/chains";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { approvedImplementationFor, factoriesFor } from "../src/factories.js";
import { cloneRuntimeCode, predictedCloneAddress, verifyClone } from "../src/verify-clone.js";

const LIVE = getDeployedChain("robinhood-testnet");
const CHAIN = {
  ...LIVE,
  contracts: {
    ...LIVE.contracts,
    factoryV2: "0x00000000000000000000000000000000000000f2",
    implementationV2: "0x00000000000000000000000000000000000000e2",
    binderRegistry: "0x00000000000000000000000000000000000000b2",
    deployBlockV2: 130_000_000,
  },
};
const FACTORIES = factoriesFor(CHAIN);
const V1 = getAddress(LIVE.contracts.factory);
const DROP_V1 = getAddress(LIVE.contracts.implementation);
const V2 = getAddress(CHAIN.contracts.factoryV2);
const DROP_V2 = getAddress(CHAIN.contracts.implementationV2);
const SALT: Hex = keccak256("0x1234");

/** What the indexer does for one `DropCreated`: the emitting factory decides the approved impl. */
function check(args: { factory: Address; implementation: Address; drop?: Address }) {
  const approved = approvedImplementationFor(FACTORIES, args.factory);
  if (approved === null) return { verified: false, error: "unknown factory" };
  const drop =
    args.drop ??
    predictedCloneAddress({
      factory: args.factory,
      implementation: args.implementation,
      salt: SALT,
    });
  return verifyClone({
    drop,
    factory: args.factory,
    implementation: args.implementation,
    approvedImplementation: approved,
    salt: SALT,
    deployedCode: cloneRuntimeCode(args.implementation),
  });
}

describe("the per factory implementation check", () => {
  it("verifies a DropFactoryV2 clone of DropV2, code hash included", () => {
    expect(check({ factory: V2, implementation: DROP_V2 })).toEqual({
      verified: true,
      error: null,
      codeHashChecked: true,
    });
  });

  it("still verifies a DropFactoryV1 clone of DropV1", () => {
    expect(check({ factory: V1, implementation: DROP_V1 }).verified).toBe(true);
  });

  it("refuses a DropFactoryV2 event that names DropV1", () => {
    const result = check({ factory: V2, implementation: DROP_V1 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });

  it("refuses a DropFactoryV1 event that names DropV2", () => {
    const result = check({ factory: V1, implementation: DROP_V2 });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the approved");
  });

  it("refuses a V2 clone address presented as a V1 factory drop", () => {
    const v2Clone = predictedCloneAddress({ factory: V2, implementation: DROP_V2, salt: SALT });
    const result = check({ factory: V1, implementation: DROP_V1, drop: v2Clone });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("is not the CREATE2 clone");
  });

  it("refuses a factory the registry does not name", () => {
    expect(
      check({ factory: "0x00000000000000000000000000000000000000aa", implementation: DROP_V2 })
        .verified,
    ).toBe(false);
  });
});
