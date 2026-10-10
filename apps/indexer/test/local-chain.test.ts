/**
 * the local chain file for the anvil check, `src/local-chain.ts`. The
 * indexer follows one registry entry; for the anvil check that entry comes from a local file
 * named by `INDEXER_LOCAL_CHAIN` instead of `chains.json`, so no test chain ever sits in the real
 * registry. The file is the registry's own shape with one chain,
 * checked by the registry's own parser, and it must be anvil: chain id 31337.
 */
import { describe, expect, it } from "vitest";

import { factoriesFor } from "../src/factories.js";
import { indexedChain, localChainFrom } from "../src/local-chain.js";

/** Anvil, V1 and V2 at the addresses a fresh anvil gives the deploy scripts. Any address works. */
const anvilEntry = {
  key: "anvil",
  name: "Anvil",
  kind: "testnet",
  testnetOf: "anvil",
  family: "evm",
  chainId: 31337,
  status: "active",
  displayOrder: null,
  nativeSymbol: "ETH",
  explorer: null,
  explorerKind: null,
  explorerQuery: null,
  rpcEnv: "ANVIL_RPC_URL",
  archiveRpcEnv: null,
  fallbackRpcEnv: null,
  finalityDepth: null,
  contracts: {
    factory: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    implementation: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    deployBlock: 1,
    program: null,
    deploySlot: null,
    factoryV2: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    implementationV2: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    binderRegistry: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    deployBlockV2: 5,
    // the registry wants the V3 fields too, all three or none.
    factoryV3: null,
    implementationV3: null,
    deployBlockV3: null,
    // the V4 fields, all three or none.
    factoryV4: null,
    implementationV4: null,
    deployBlockV4: null,
  },
  launchpadFactories: [],
  quickTokens: [],
};

const file = (chains: unknown[]) => JSON.stringify({ version: 1, chains });
const withEntry = (patch: Record<string, unknown>) => file([{ ...anvilEntry, ...patch }]);

describe("localChainFrom", () => {
  it("reads one anvil chain with V1 and V2, and the factories follow both", () => {
    const chain = localChainFrom(file([anvilEntry]));
    expect(chain.key).toBe("anvil");
    expect(chain.chainId).toBe(31337);
    expect(chain.rpcEnv).toBe("ANVIL_RPC_URL");
    const factories = factoriesFor(chain);
    expect(factories.map((f) => f.name)).toEqual(["DropFactoryV1", "DropFactoryV2"]);
    expect(factories[1]?.startBlock).toBe(5);
  });

  it("refuses any chain id but 31337: never a real chain", () => {
    expect(() => localChainFrom(withEntry({ chainId: 46630 }))).toThrow(/31337/);
    expect(() => localChainFrom(withEntry({ chainId: 1 }))).toThrow(/31337/);
  });

  it("refuses a file with more or fewer than one chain", () => {
    expect(() => localChainFrom(file([anvilEntry, { ...anvilEntry, key: "anvil2" }]))).toThrow(
      /one chain/,
    );
    expect(() => localChainFrom(JSON.stringify({ version: 1, chains: [] }))).toThrow();
  });

  it("refuses a chain with no deployed V1 factory", () => {
    expect(() =>
      localChainFrom(
        withEntry({ contracts: { ...anvilEntry.contracts, factory: null, implementation: null } }),
      ),
    ).toThrow();
  });

  it("uses the registry's own checks: V2 is all four or none", () => {
    expect(() =>
      localChainFrom(withEntry({ contracts: { ...anvilEntry.contracts, binderRegistry: null } })),
    ).toThrow(/all four or none/);
  });

  it("refuses text that is not JSON, with a sentence", () => {
    expect(() => localChainFrom("not json")).toThrow(/INDEXER_LOCAL_CHAIN/);
  });
});

describe("indexedChain", () => {
  it("without a local file: the registry entry named by DROPCHAD_CHAIN, no file read", () => {
    const chain = indexedChain({ chainKey: "robinhood-testnet", localChainFile: undefined }, () => {
      throw new Error("must not read a file");
    });
    expect(chain.key).toBe("robinhood-testnet");
    expect(chain.chainId).toBe(46630);
  });

  it("with a local file: that chain, whatever DROPCHAD_CHAIN says", () => {
    const read: string[] = [];
    const chain = indexedChain(
      { chainKey: "robinhood-testnet", localChainFile: "C:/tmp/anvil.json" },
      (path) => {
        read.push(path);
        return file([anvilEntry]);
      },
    );
    expect(read).toEqual(["C:/tmp/anvil.json"]);
    expect(chain.key).toBe("anvil");
    expect(chain.chainId).toBe(31337);
  });
});
