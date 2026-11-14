/**
 * Which factories the indexer follows, and the implementation each one is
 * allowed to clone, all from `@dropchad/chains`: two factories
 * from handle mode on, each approved for its own implementation only.
 *
 * the registry carries the V2 set on robinhood testnet, so the
 * live entry follows both factories, and since `DropFactoryV3` too. A chain with the V2
 * fields `null` follows `DropFactoryV1` alone, exactly as before.
 */
import { getDeployedChain, type DeployedChain } from "@dropchad/chains";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { approvedImplementationFor, factoriesFor } from "../src/factories.js";

const LIVE = getDeployedChain("robinhood-testnet");

const V2 = {
  factoryV2: "0x00000000000000000000000000000000000000f2",
  implementationV2: "0x00000000000000000000000000000000000000e2",
  binderRegistry: "0x00000000000000000000000000000000000000b2",
  deployBlockV2: 130_000_000,
};

/** V6 is recorded since. Taken off in the shapes below, as the registry would. */
const NO_V6 = {
  factoryV6: null,
  implementationV6: null,
  binderRegistryV2: null,
  deployBlockV6: null,
};

/** Made up V2 addresses, and no V3, so only V1 and V2 are followed. V3 is `factories-v3.test.ts`. */
function withV2(chain: DeployedChain): DeployedChain {
  return {
    ...chain,
    contracts: {
      ...chain.contracts,
      ...V2,
      factoryV3: null,
      implementationV3: null,
      deployBlockV3: null,
      ...NO_V6,
    },
  };
}

/** The live entry with the V2 fields taken out: a chain before its handle mode deploy. */
function v1Only(chain: DeployedChain): DeployedChain {
  return {
    ...chain,
    contracts: {
      ...chain.contracts,
      ...NO_V6,
      factoryV2: null,
      implementationV2: null,
      binderRegistry: null,
      deployBlockV2: null,
    },
  };
}

describe("factoriesFor", () => {
  it("follows DropFactoryV1 alone while the V2 fields are null", () => {
    expect(factoriesFor(v1Only(LIVE))).toEqual([
      {
        name: "DropFactoryV1",
        factory: getAddress(LIVE.contracts.factory),
        implementation: getAddress(LIVE.contracts.implementation),
        startBlock: LIVE.contracts.deployBlock,
      },
    ]);
  });

  it("the live robinhood testnet entry follows V1, V2, V3, V4, V5 from 134603946, V6 from 140304587 and V7 from 142267213", () => {
    expect(factoriesFor(LIVE)).toEqual([
      {
        name: "DropFactoryV1",
        factory: getAddress("0x09Ce0CE51a9b14d7F3426Db4Cb3a5b44A8a74F60"),
        implementation: getAddress("0xb8edEf0f9a295Fd386Bf3C12F84Be0f609546954"),
        startBlock: 115_976_053,
      },
      {
        name: "DropFactoryV2",
        factory: getAddress("0xCC8eBfE09B5d1F8FE6f7D0A4ed257813dB58AC43"),
        implementation: getAddress("0x5D1156166B173c9854dB278Ba8B086405230945a"),
        startBlock: 126_718_666,
      },
      {
        name: "DropFactoryV3",
        factory: getAddress("0xeCD5E1d71dbE6072bb595209E9a19E0A3bBFB384"),
        implementation: getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6"),
        startBlock: 128_705_054,
      },
      {
        // The same DropV3 as V3.
        name: "DropFactoryV4",
        factory: getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4"),
        implementation: getAddress("0xBb01721BFF0F6312488eb2058e56B723c27189D6"),
        startBlock: 130_766_040,
      },
      {
        // The new DropV5.
        name: "DropFactoryV5",
        factory: getAddress("0xF01FF6f70482955078AF1cF774bd500E9276AFdc"),
        implementation: getAddress("0x39C2789dE00750a53987b140BE8b631965eBC933"),
        startBlock: 134_603_946,
      },
      {
        // The new DropV6 on BinderRegistryV2.
        name: "DropFactoryV6",
        factory: getAddress("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba"),
        implementation: getAddress("0x5fbe17722728C8A34bF4763B83Eb699774133D1F"),
        startBlock: 140_304_587,
      },
      {
        // DropV7, binding v2, on the same BinderRegistryV2.
        name: "DropFactoryV7",
        factory: getAddress("0x61147e60e8F264c760b88Dd38C002B5bdF47254f"),
        implementation: getAddress("0x9274c88d7431Ef7533309cCC77bB9c1AdEB16720"),
        startBlock: 142_267_213,
      },
    ]);
  });

  it("adds DropFactoryV2 with DropV2 and its own start block once all four V2 fields are set", () => {
    expect(factoriesFor(withV2(LIVE))).toEqual([
      {
        name: "DropFactoryV1",
        factory: getAddress(LIVE.contracts.factory),
        implementation: getAddress(LIVE.contracts.implementation),
        startBlock: LIVE.contracts.deployBlock,
      },
      {
        name: "DropFactoryV2",
        factory: getAddress(V2.factoryV2),
        implementation: getAddress(V2.implementationV2),
        startBlock: V2.deployBlockV2,
      },
    ]);
  });
});

describe("approvedImplementationFor", () => {
  const factories = factoriesFor(withV2(LIVE));

  it("gives each factory its own implementation, whatever the address case", () => {
    expect(approvedImplementationFor(factories, getAddress(LIVE.contracts.factory))).toBe(
      getAddress(LIVE.contracts.implementation),
    );
    expect(approvedImplementationFor(factories, V2.factoryV2.toLowerCase() as `0x${string}`)).toBe(
      getAddress(V2.implementationV2),
    );
  });

  it("gives nothing for a factory we do not know", () => {
    expect(
      approvedImplementationFor(factories, "0x00000000000000000000000000000000000000aa"),
    ).toBeNull();
  });
});
