import { describe, expect, it } from "vitest";

import {
  ChainRegistryError,
  chains,
  explorerAddressUrl,
  explorerTxUrl,
  findChainByChainId,
  getActiveChains,
  getChain,
  getDeployedChain,
  getDeployedChains,
  getDeployedProgramChains,
  hasFeeModelContracts,
  hasHandleContracts,
  hasRefundSafeContracts,
  hasTokenDropContracts,
  hasV6Contracts,
  hasV7Contracts,
  isDeployed,
  isProgramDeployed,
  isTestnetOnly,
  parseRegistry,
  registry,
  rpcUrlFor,
  rpcUrlsFor,
} from "../src/index.js";

/** The robinhood mainnet V7 record taken out again: the registry before. */
const NO_V7_RECORD = {
  factoryV7: null,
  implementationV7: null,
  binderRegistryV2: null,
  deployBlockV7: null,
} as const;

describe("registry", () => {
  it("parses chains.json at import", () => {
    expect(registry.version).toBe(1);
    expect(chains.length).toBeGreaterThan(0);
  });

  it("has unique chain keys", () => {
    const keys = chains.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never carries an rpc url, only an env var name", () => {
    for (const chain of chains) {
      for (const name of [chain.rpcEnv, chain.archiveRpcEnv, chain.fallbackRpcEnv]) {
        if (name === null) continue;
        expect(name).toMatch(/^[A-Z0-9_]+$/);
        expect(name).not.toContain("://");
      }
    }
  });
});

describe("getChain", () => {
  it("finds a chain by key", () => {
    expect(getChain("robinhood-testnet").chainId).toBe(46630);
  });

  it("throws on an unknown key and lists the valid ones", () => {
    expect(() => getChain("nope")).toThrow(ChainRegistryError);
    expect(() => getChain("nope")).toThrow(/robinhood-testnet/);
  });

  it("finds a chain by evm chain id", () => {
    expect(findChainByChainId(46630)?.key).toBe("robinhood-testnet");
    expect(findChainByChainId(999999)).toBeUndefined();
  });

  it("finds the solana clusters by the leaf chain id", () => {
    expect(findChainByChainId(101)?.key).toBe("solana");
    expect(findChainByChainId(103)?.key).toBe("solana-devnet");
  });

  it("orders the pills solana, robinhood, bnb, base, ethereum, ton", () => {
    const pills = chains
      .filter((c) => c.displayOrder !== null)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((c) => c.key);
    expect(pills).toEqual(["solana", "robinhood", "bnb", "base", "ethereum", "ton"]);
  });

  it("has base as an evm chain, coming soon, id 8453", () => {
    const base = getChain("base");
    expect(base.family).toBe("evm");
    expect(base.chainId).toBe(8453);
    expect(base.status).toBe("coming_soon");
    expect(base.contracts.factory).toBeNull();
  });
});

describe("getActiveChains", () => {
  it("returns only active chains", () => {
    for (const chain of getActiveChains()) {
      expect(chain.status).toBe("active");
    }
  });

  it("sorts by displayOrder and puts null order last", () => {
    const active = getActiveChains();
    const orders = active.map((c) => c.displayOrder);
    const withOrder = orders.filter((o): o is number => o !== null);
    expect([...withOrder].sort((a, b) => a - b)).toEqual(withOrder);
    const firstNull = orders.indexOf(null);
    if (firstNull !== -1) {
      expect(orders.slice(firstNull).every((o) => o === null)).toBe(true);
    }
  });

  it("keeps status and contracts apart: robinhood mainnet is active with no factory", () => {
    const mainnet = getChain("robinhood");
    expect(mainnet.status).toBe("active");
    expect(mainnet.contracts.factory).toBeNull();
    expect(isDeployed(mainnet)).toBe(false);
  });
});

describe("deployed chains", () => {
  it("robinhood testnet is the one deployed chain today", () => {
    const deployed = getDeployedChains().map((c) => c.key);
    expect(deployed).toEqual(["robinhood-testnet"]);
  });

  it("carries the live testnet addresses and the L2 deploy block", () => {
    const chain = getDeployedChain("robinhood-testnet");
    expect(chain.contracts.factory).toBe("0x09Ce0CE51a9b14d7F3426Db4Cb3a5b44A8a74F60");
    expect(chain.contracts.implementation).toBe("0xb8edEf0f9a295Fd386Bf3C12F84Be0f609546954");
    // L2 block of the factory deploy transaction, not `block.number`.
    expect(chain.contracts.deployBlock).toBe(115976053);
  });

  it("throws for a chain without a factory", () => {
    expect(() => getDeployedChain("robinhood")).toThrow(/no deployed factory/);
  });
});

describe("rpcUrlFor", () => {
  it("reads the env var the registry names", () => {
    const chain = getChain("robinhood-testnet");
    expect(rpcUrlFor(chain, { ROBINHOOD_TESTNET_RPC_URL: "https://example.invalid" })).toBe(
      "https://example.invalid",
    );
  });

  it("names the missing env var in the error", () => {
    const chain = getChain("robinhood-testnet");
    expect(() => rpcUrlFor(chain, {})).toThrow(/ROBINHOOD_TESTNET_RPC_URL/);
  });

  it("throws when the chain has no rpcEnv at all", () => {
    expect(() => rpcUrlFor(getChain("ton"), {})).toThrow(/no rpcEnv/);
  });

  it("names the solana env vars by the one scheme", () => {
    expect(getChain("solana").rpcEnv).toBe("SOLANA_MAINNET_RPC_URL");
    expect(getChain("solana-devnet").rpcEnv).toBe("SOLANA_DEVNET_RPC_URL");
  });
});

describe("rpcUrlsFor", () => {
  const chain = getChain("robinhood-testnet");

  it("names a fallback env var for robinhood testnet", () => {
    expect(chain.fallbackRpcEnv).toBe("ROBINHOOD_TESTNET_RPC_URL_FALLBACK");
  });

  it("returns the primary first, then the fallback when it is set", () => {
    expect(
      rpcUrlsFor(chain, {
        ROBINHOOD_TESTNET_RPC_URL: "https://primary.invalid",
        ROBINHOOD_TESTNET_RPC_URL_FALLBACK: "https://fallback.invalid",
      }),
    ).toEqual(["https://primary.invalid", "https://fallback.invalid"]);
  });

  it("returns the primary alone when the fallback is unset or empty", () => {
    const primary = { ROBINHOOD_TESTNET_RPC_URL: "https://primary.invalid" };
    expect(rpcUrlsFor(chain, primary)).toEqual(["https://primary.invalid"]);
    expect(rpcUrlsFor(chain, { ...primary, ROBINHOOD_TESTNET_RPC_URL_FALLBACK: "" })).toEqual([
      "https://primary.invalid",
    ]);
  });

  it("drops a fallback that is the primary again", () => {
    expect(
      rpcUrlsFor(chain, {
        ROBINHOOD_TESTNET_RPC_URL: "https://same.invalid",
        ROBINHOOD_TESTNET_RPC_URL_FALLBACK: "https://same.invalid",
      }),
    ).toEqual(["https://same.invalid"]);
  });

  it("still needs the primary: a fallback alone is a mistake", () => {
    expect(() =>
      rpcUrlsFor(chain, { ROBINHOOD_TESTNET_RPC_URL_FALLBACK: "https://fallback.invalid" }),
    ).toThrow(/ROBINHOOD_TESTNET_RPC_URL/);
  });
});

describe("explorer links", () => {
  it("builds an address link when the chain has an explorer", () => {
    expect(explorerAddressUrl(getChain("robinhood-testnet"), "0xabc")).toBe(
      "https://explorer.testnet.chain.robinhood.com/address/0xabc",
    );
  });

  it("returns null when the chain has no explorer yet", () => {
    expect(explorerAddressUrl(getChain("bnb"), "0xabc")).toBeNull();
  });

  it("appends the cluster query on solana devnet and nothing on mainnet", () => {
    const devnet = getChain("solana-devnet");
    expect(explorerAddressUrl(devnet, "G5wp")).toBe(
      "https://explorer.solana.com/address/G5wp?cluster=devnet",
    );
    expect(explorerTxUrl(devnet, "sig")).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
    expect(explorerAddressUrl(getChain("solana"), "G5wp")).toBe(
      "https://explorer.solana.com/address/G5wp",
    );
  });
});

describe("solana program entries", () => {
  it("carries the program id on both clusters and no factory", () => {
    for (const key of ["solana", "solana-devnet"]) {
      const chain = getChain(key);
      expect(chain.family).toBe("svm");
      expect(chain.contracts.program).toBe("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft");
      expect(chain.contracts.factory).toBeNull();
    }
    // Devnet, slot from `solana program show`.
    expect(getChain("solana-devnet").contracts.deploySlot).toBe(497517620);
    // Mainnet, slot 468986468.
    expect(getChain("solana").contracts.deploySlot).toBe(468986468);
  });

  it("is program deployed on devnet, active", () => {
    const devnet = getChain("solana-devnet");
    expect(devnet.status).toBe("active");
    expect(isProgramDeployed(devnet)).toBe(true);
    expect(getDeployedProgramChains().map((c) => c.key)).toEqual(["solana", "solana-devnet"]);
    // A program is not a factory. `getDeployedChains` is the factory list and stays EVM only.
    expect(isDeployed(devnet)).toBe(false);
    expect(getDeployedChains().map((c) => c.key)).toEqual(["robinhood-testnet"]);
  });

  it("solana mainnet is active with its program from the switch release", () => {
    const mainnet = getChain("solana");
    expect(mainnet.status).toBe("active");
    expect(isProgramDeployed(mainnet)).toBe(true);
  });

  it("devnet is the testnet of solana", () => {
    expect(getChain("solana-devnet").testnetOf).toBe("solana");
    expect(getChain("solana-devnet").displayOrder).toBeNull();
  });
});

describe("parseRegistry rejects broken documents", () => {
  const good = {
    version: 1,
    chains: [
      {
        key: "x",
        name: "X",
        kind: "mainnet",
        family: "evm",
        chainId: 1,
        status: "active",
        displayOrder: 1,
        nativeSymbol: "ETH",
        explorer: null,
        explorerKind: null,
        explorerQuery: null,
        rpcEnv: null,
        archiveRpcEnv: null,
        fallbackRpcEnv: null,
        finalityDepth: null,
        contracts: {
          factory: null,
          implementation: null,
          deployBlock: null,
          program: null,
          deploySlot: null,
          factoryV2: null,
          implementationV2: null,
          binderRegistry: null,
          deployBlockV2: null,
          factoryV3: null,
          implementationV3: null,
          deployBlockV3: null,
          factoryV4: null,
          implementationV4: null,
          deployBlockV4: null,
          factoryV5: null,
          implementationV5: null,
          deployBlockV5: null,
          factoryV6: null,
          implementationV6: null,
          binderRegistryV2: null,
          deployBlockV6: null,
          factoryV7: null,
          implementationV7: null,
          deployBlockV7: null,
        },
        launchpadFactories: [],
        quickTokens: [],
      },
    ],
  };

  it("accepts a minimal valid document", () => {
    expect(parseRegistry(good).chains).toHaveLength(1);
  });

  it("rejects a wrong version", () => {
    expect(() => parseRegistry({ ...good, version: 2 })).toThrow(/version/);
  });

  it("rejects an unknown status", () => {
    const bad = { ...good, chains: [{ ...good.chains[0], status: "maybe" }] };
    expect(() => parseRegistry(bad)).toThrow(/status/);
  });

  it("rejects an evm chain with no chainId", () => {
    const bad = { ...good, chains: [{ ...good.chains[0], chainId: null }] };
    expect(() => parseRegistry(bad)).toThrow(/chainId/);
  });

  it("rejects an svm chain with no leaf chain id", () => {
    const bad = { ...good, chains: [{ ...good.chains[0], family: "svm", chainId: null }] };
    expect(() => parseRegistry(bad)).toThrow(/needs the leaf chain id/);
  });

  it("the lookup table: the frozen mainnet table on solana, none on devnet", () => {
    expect(getChain("solana").contracts.lookupTable).toBe(
      "7W9coGsnBN7fNQaUmxmPDt7kBeRtAGhPsL1s5L7R6GQX",
    );
    expect(getChain("solana-devnet").contracts.lookupTable ?? null).toBeNull();
  });

  it("the lookup table is optional: absent reads as null, a string on an svm chain is kept", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const svm = { ...base, family: "svm" };
    expect(parseRegistry({ ...good, chains: [svm] }).chains[0]?.contracts.lookupTable).toBeNull();
    const withTable = {
      ...good,
      chains: [{ ...svm, contracts: { ...base.contracts, lookupTable: "TaBLE1111" } }],
    };
    expect(parseRegistry(withTable).chains[0]?.contracts.lookupTable).toBe("TaBLE1111");
  });

  it("rejects a lookup table on an evm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const bad = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, lookupTable: "TaBLE1111" } }],
    };
    expect(() => parseRegistry(bad)).toThrow(/lookup table/);
  });

  it("rejects a program on an evm chain and a factory on an svm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const withProgram = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, program: "x" } }],
    };
    expect(() => parseRegistry(withProgram)).toThrow(/program/);
    const withFactory = {
      ...good,
      chains: [{ ...base, family: "svm", contracts: { ...base.contracts, factory: "0xabc" } }],
    };
    expect(() => parseRegistry(withFactory)).toThrow(/no factory/);
  });

  // -- handle mode, the V2 set --------------------------------------------

  const v2 = {
    factoryV2: "0x0000000000000000000000000000000000000f02",
    implementationV2: "0x0000000000000000000000000000000000000d02",
    binderRegistry: "0x0000000000000000000000000000000000000b1d",
    deployBlockV2: 120_000_000,
  };

  it("accepts a full V2 set on an evm chain, and hasHandleContracts says so", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = { ...good, chains: [{ ...base, contracts: { ...base.contracts, ...v2 } }] };
    const chain = parseRegistry(doc).chains[0];
    expect(chain?.contracts.factoryV2).toBe(v2.factoryV2);
    expect(chain?.contracts.deployBlockV2).toBe(120_000_000);
    expect(chain !== undefined && hasHandleContracts(chain)).toBe(true);
  });

  it("rejects a V2 set with one field missing: all four or none", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    for (const key of Object.keys(v2)) {
      const partial = { ...base.contracts, ...v2, [key]: null };
      const doc = { ...good, chains: [{ ...base, contracts: partial }] };
      expect(() => parseRegistry(doc)).toThrow(/all four or none/);
    }
  });

  it("rejects a V2 field on an svm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, family: "svm", contracts: { ...base.contracts, ...v2 } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/evm only/);
  });

  it("rejects a document that leaves a V2 key out instead of writing null", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const { factoryV2: _dropped, ...rest } = base.contracts;
    const doc = { ...good, chains: [{ ...base, contracts: rest }] };
    expect(() => parseRegistry(doc)).toThrow(/factoryV2/);
  });

  // -- Robinhood token drops, the V3 set ----------------------

  const v3 = {
    factoryV3: "0x0000000000000000000000000000000000000f03",
    implementationV3: "0x0000000000000000000000000000000000000d03",
    deployBlockV3: 130_000_000,
  };

  it("accepts a full V3 set on top of V2, and hasTokenDropContracts says so", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = { ...good, chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3 } }] };
    const chain = parseRegistry(doc).chains[0];
    expect(chain?.contracts.factoryV3).toBe(v3.factoryV3);
    expect(chain?.contracts.deployBlockV3).toBe(130_000_000);
    expect(chain !== undefined && hasTokenDropContracts(chain)).toBe(true);
  });

  it("rejects a V3 set with one field missing: all three or none", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    for (const key of Object.keys(v3)) {
      const partial = { ...base.contracts, ...v2, ...v3, [key]: null };
      const doc = { ...good, chains: [{ ...base, contracts: partial }] };
      expect(() => parseRegistry(doc)).toThrow(/all three or none/);
    }
  });

  it("rejects a V3 set without the V2 set: V3 reads the live BinderRegistry", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = { ...good, chains: [{ ...base, contracts: { ...base.contracts, ...v3 } }] };
    expect(() => parseRegistry(doc)).toThrow(/V2 set/);
  });

  it("rejects a V3 field on an svm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, family: "svm", contracts: { ...base.contracts, ...v3 } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/evm only/);
  });

  it("rejects a document that leaves a V3 key out instead of writing null", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const { factoryV3: _dropped, ...rest } = base.contracts;
    const doc = { ...good, chains: [{ ...base, contracts: rest }] };
    expect(() => parseRegistry(doc)).toThrow(/factoryV3/);
  });

  // -- the new fee on Robinhood, the V4 set ----------

  // V4 clones the same DropV3 as V3, so implementationV4 is implementationV3.
  const v4 = {
    factoryV4: "0x0000000000000000000000000000000000000f04",
    implementationV4: v3.implementationV3,
    deployBlockV4: 140_000_000,
  };

  it("accepts a full V4 set on top of V3, and hasFeeModelContracts says so", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...v4 } }],
    };
    const chain = parseRegistry(doc).chains[0];
    expect(chain?.contracts.factoryV4).toBe(v4.factoryV4);
    expect(chain?.contracts.implementationV4).toBe(v3.implementationV3);
    expect(chain?.contracts.deployBlockV4).toBe(140_000_000);
    expect(chain !== undefined && hasFeeModelContracts(chain)).toBe(true);
    // V3 stays recorded under V4: its drops keep working.
    expect(chain !== undefined && hasTokenDropContracts(chain)).toBe(true);
  });

  it("hasFeeModelContracts is false with the V3 set alone", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = { ...good, chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3 } }] };
    const chain = parseRegistry(doc).chains[0];
    expect(chain !== undefined && hasFeeModelContracts(chain)).toBe(false);
  });

  it("rejects a V4 set with one field missing: all three or none", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    for (const key of Object.keys(v4)) {
      const partial = { ...base.contracts, ...v2, ...v3, ...v4, [key]: null };
      const doc = { ...good, chains: [{ ...base, contracts: partial }] };
      expect(() => parseRegistry(doc), key).toThrow(/factoryV4, implementationV4, deployBlockV4/);
    }
  });

  it("rejects a V4 set without the V3 set: V4 clones the V3 DropV3", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = { ...good, chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v4 } }] };
    expect(() => parseRegistry(doc)).toThrow(/V3 set/);
  });

  it("rejects an implementationV4 that is not implementationV3", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const other = { ...v4, implementationV4: "0x0000000000000000000000000000000000000d04" };
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...other } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/implementationV4 must equal implementationV3/);
  });

  it("accepts implementationV4 in another letter case than implementationV3", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const lower = {
      ...v4,
      implementationV4: v3.implementationV3.toUpperCase().replace("0X", "0x"),
    };
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...lower } }],
    };
    expect(parseRegistry(doc).chains).toHaveLength(1);
  });

  it("rejects a V4 field on an svm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, family: "svm", contracts: { ...base.contracts, ...v4 } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/evm only/);
  });

  it("rejects a document that leaves a V4 key out instead of writing null", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const { factoryV4: _dropped, ...rest } = base.contracts;
    const doc = { ...good, chains: [{ ...base, contracts: rest }] };
    expect(() => parseRegistry(doc)).toThrow(/factoryV4/);
  });

  // -- the safe ETH return and the refund check on Robinhood, the V5 set ---

  // V5 clones a new DropV5, never the V3 DropV3.
  const v5 = {
    factoryV5: "0x0000000000000000000000000000000000000f05",
    implementationV5: "0x0000000000000000000000000000000000000d05",
    deployBlockV5: 150_000_000,
  };

  it("accepts a full V5 set on top of V4, and hasRefundSafeContracts says so", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...v4, ...v5 } }],
    };
    const chain = parseRegistry(doc).chains[0];
    expect(chain?.contracts.factoryV5).toBe(v5.factoryV5);
    expect(chain?.contracts.implementationV5).toBe(v5.implementationV5);
    expect(chain?.contracts.deployBlockV5).toBe(150_000_000);
    expect(chain !== undefined && hasRefundSafeContracts(chain)).toBe(true);
    // V4 and V3 stay recorded under V5: their drops keep working.
    expect(chain !== undefined && hasFeeModelContracts(chain)).toBe(true);
    expect(chain !== undefined && hasTokenDropContracts(chain)).toBe(true);
  });

  it("hasRefundSafeContracts is false with the V4 set alone", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...v4 } }],
    };
    const chain = parseRegistry(doc).chains[0];
    expect(chain !== undefined && hasRefundSafeContracts(chain)).toBe(false);
  });

  it("rejects a V5 set with one field missing: all three or none", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    for (const key of Object.keys(v5)) {
      const partial = { ...base.contracts, ...v2, ...v3, ...v4, ...v5, [key]: null };
      const doc = { ...good, chains: [{ ...base, contracts: partial }] };
      expect(() => parseRegistry(doc), key).toThrow(/factoryV5, implementationV5, deployBlockV5/);
    }
  });

  it("rejects a V5 set without the V4 set: V5 takes over from V4", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...v5 } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/V4 set/);
  });

  it("rejects an implementationV5 that is the V3 DropV3: V5 clones the new DropV5", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const same = { ...v5, implementationV5: v3.implementationV3.toUpperCase().replace("0X", "0x") };
    const doc = {
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v2, ...v3, ...v4, ...same } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/implementationV5 must not be implementationV3/);
  });

  it("rejects a V5 field on an svm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, family: "svm", contracts: { ...base.contracts, ...v5 } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/evm only/);
  });

  it("rejects a document that leaves a V5 key out instead of writing null", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const { factoryV5: _dropped, ...rest } = base.contracts;
    const doc = { ...good, chains: [{ ...base, contracts: rest }] };
    expect(() => parseRegistry(doc)).toThrow(/factoryV5/);
  });

  // -- The V6 set round -------------------------------------------------

  // V6 clones a new DropV6 and reads a new BinderRegistryV2.
  const v6 = {
    factoryV6: "0x0000000000000000000000000000000000000f06",
    implementationV6: "0x0000000000000000000000000000000000000d06",
    binderRegistryV2: "0x0000000000000000000000000000000000000b02",
    deployBlockV6: 160_000_000,
  };
  const v1 = {
    factory: "0x0000000000000000000000000000000000000f01",
    implementation: "0x0000000000000000000000000000000000000d01",
    deployBlock: 100_000_000,
  };

  it("accepts a full V6 set on top of V5, the testnet shape, and hasV6Contracts says so", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [
        { ...base, contracts: { ...base.contracts, ...v1, ...v2, ...v3, ...v4, ...v5, ...v6 } },
      ],
    };
    const chain = parseRegistry(doc).chains[0];
    expect(chain?.contracts.factoryV6).toBe(v6.factoryV6);
    expect(chain?.contracts.implementationV6).toBe(v6.implementationV6);
    expect(chain?.contracts.binderRegistryV2).toBe(v6.binderRegistryV2);
    expect(chain?.contracts.deployBlockV6).toBe(160_000_000);
    expect(chain !== undefined && hasV6Contracts(chain)).toBe(true);
    // V5 stays recorded under V6: its drops keep working.
    expect(chain !== undefined && hasRefundSafeContracts(chain)).toBe(true);
  });

  it("accepts the V6 set alone, every V1 to V5 field null, the mainnet shape", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = { ...good, chains: [{ ...base, contracts: { ...base.contracts, ...v6 } }] };
    const chain = parseRegistry(doc).chains[0];
    expect(chain !== undefined && hasV6Contracts(chain)).toBe(true);
    // isDeployed stays the V1 check; the api and the indexer take V6 alone.
    expect(chain !== undefined && isDeployed(chain)).toBe(false);
  });

  it("rejects a V6 set with one field missing: all four or none", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    for (const key of Object.keys(v6)) {
      const partial = { ...base.contracts, ...v6, [key]: null };
      const doc = { ...good, chains: [{ ...base, contracts: partial }] };
      expect(() => parseRegistry(doc), key).toThrow(
        /factoryV6, implementationV6, binderRegistryV2, deployBlockV6/,
      );
    }
  });

  it("rejects a V6 set on part of the older stack: on top of V5, or alone", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const cases = [
      ["V1 only", { ...v1 }],
      ["V1 and V2", { ...v1, ...v2 }],
      ["V1 to V4", { ...v1, ...v2, ...v3, ...v4 }],
    ] as const;
    for (const [what, older] of cases) {
      const doc = {
        ...good,
        chains: [{ ...base, contracts: { ...base.contracts, ...older, ...v6 } }],
      };
      expect(() => parseRegistry(doc), what).toThrow(
        /V6 fields need the V5 set, or no older field/,
      );
    }
  });

  it("rejects an implementationV6 that is an older implementation, in any letter case", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const all = { ...v1, ...v2, ...v3, ...v4, ...v5 };
    for (const old of [
      all.implementation,
      all.implementationV2,
      all.implementationV3,
      all.implementationV5,
    ]) {
      const same = { ...v6, implementationV6: old.toUpperCase().replace("0X", "0x") };
      const doc = {
        ...good,
        chains: [{ ...base, contracts: { ...base.contracts, ...all, ...same } }],
      };
      expect(() => parseRegistry(doc), old).toThrow(/implementationV6 must not be an older/);
    }
  });

  it("rejects a factoryV6 that is an older factory", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const all = { ...v1, ...v2, ...v3, ...v4, ...v5 };
    for (const old of [all.factory, all.factoryV2, all.factoryV3, all.factoryV4, all.factoryV5]) {
      const doc = {
        ...good,
        chains: [{ ...base, contracts: { ...base.contracts, ...all, ...v6, factoryV6: old } }],
      };
      expect(() => parseRegistry(doc), old).toThrow(/factoryV6 must not be an older/);
    }
  });

  it("rejects a binderRegistryV2 that is the old binderRegistry", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const all = { ...v1, ...v2, ...v3, ...v4, ...v5 };
    const doc = {
      ...good,
      chains: [
        {
          ...base,
          contracts: { ...base.contracts, ...all, ...v6, binderRegistryV2: all.binderRegistry },
        },
      ],
    };
    expect(() => parseRegistry(doc)).toThrow(/binderRegistryV2 must not be binderRegistry/);
  });

  it("rejects a V6 field on an svm chain", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const doc = {
      ...good,
      chains: [{ ...base, family: "svm", contracts: { ...base.contracts, ...v6 } }],
    };
    expect(() => parseRegistry(doc)).toThrow(/evm only/);
  });

  it("rejects a document that leaves a V6 key out instead of writing null", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    for (const key of Object.keys(v6)) {
      const rest: Record<string, unknown> = { ...base.contracts };
      delete rest[key];
      const doc = { ...good, chains: [{ ...base, contracts: rest }] };
      expect(() => parseRegistry(doc), key).toThrow(new RegExp(key));
    }
  });

  it("hasV6Contracts is false with no V6 set, and on a chain that is not active", () => {
    const base = good.chains[0] as (typeof good.chains)[number];
    const none = parseRegistry({
      ...good,
      chains: [{ ...base, contracts: { ...base.contracts, ...v1, ...v2, ...v3, ...v4, ...v5 } }],
    }).chains[0];
    expect(none !== undefined && hasV6Contracts(none)).toBe(false);
    const soon = parseRegistry({
      ...good,
      chains: [{ ...base, status: "coming_soon", contracts: { ...base.contracts, ...v6 } }],
    }).chains[0];
    expect(soon !== undefined && hasV6Contracts(soon)).toBe(false);
  });

  it("rejects an explorerQuery that carries its own question mark", () => {
    const bad = { ...good, chains: [{ ...good.chains[0], explorerQuery: "?cluster=devnet" }] };
    expect(() => parseRegistry(bad)).toThrow(/explorerQuery/);
  });

  it("rejects a duplicate key", () => {
    const bad = { ...good, chains: [good.chains[0], good.chains[0]] };
    expect(() => parseRegistry(bad)).toThrow(/duplicate/);
  });

  it("rejects a testnet with no testnetOf", () => {
    const bad = { ...good, chains: [{ ...good.chains[0], kind: "testnet" }] };
    expect(() => parseRegistry(bad)).toThrow(/testnetOf/);
  });

  it("rejects a testnetOf pointing at nothing", () => {
    const bad = {
      ...good,
      chains: [{ ...good.chains[0], kind: "testnet", testnetOf: "ghost" }],
    };
    expect(() => parseRegistry(bad)).toThrow(/not found/);
  });
});

describe("handle mode contracts, recorded", () => {
  it("robinhood testnet carries the V2 set", () => {
    const c = getChain("robinhood-testnet").contracts;
    expect(c.factoryV2).toBe("0xCC8eBfE09B5d1F8FE6f7D0A4ed257813dB58AC43");
    expect(c.implementationV2).toBe("0x5D1156166B173c9854dB278Ba8B086405230945a");
    expect(c.binderRegistry).toBe("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");
    // The L2 block of the DropFactoryV2 deploy, the V2 start block, not the registry's 126718638.
    expect(c.deployBlockV2).toBe(126_718_666);
  });

  it("hasHandleContracts is true on robinhood testnet only", () => {
    for (const chain of chains) {
      expect(hasHandleContracts(chain), chain.key).toBe(chain.key === "robinhood-testnet");
    }
  });

  it("every other chain carries the four V2 fields as null", () => {
    for (const chain of chains.filter((c) => c.key !== "robinhood-testnet")) {
      expect(chain.contracts.factoryV2, chain.key).toBeNull();
      expect(chain.contracts.implementationV2, chain.key).toBeNull();
      expect(chain.contracts.binderRegistry, chain.key).toBeNull();
      expect(chain.contracts.deployBlockV2, chain.key).toBeNull();
    }
  });

  it("the V1 addresses of robinhood testnet are untouched", () => {
    const c = getChain("robinhood-testnet").contracts;
    expect(c.factory).toBe("0x09Ce0CE51a9b14d7F3426Db4Cb3a5b44A8a74F60");
    expect(c.implementation).toBe("0xb8edEf0f9a295Fd386Bf3C12F84Be0f609546954");
    expect(c.deployBlock).toBe(115_976_053);
  });
});

describe("Robinhood token drops, V3 recorded on robinhood testnet only", () => {
  it("robinhood testnet carries the deployed V3 set, so hasTokenDropContracts is true there", () => {
    const chain = getChain("robinhood-testnet");
    expect(chain.contracts.factoryV3).toBe("0xeCD5E1d71dbE6072bb595209E9a19E0A3bBFB384");
    expect(chain.contracts.implementationV3).toBe("0xBb01721BFF0F6312488eb2058e56B723c27189D6");
    expect(chain.contracts.deployBlockV3).toBe(128_705_054);
    expect(hasTokenDropContracts(chain)).toBe(true);
  });

  it("every other chain carries the three V3 fields as null, so hasTokenDropContracts is false", () => {
    for (const chain of chains.filter((c) => c.key !== "robinhood-testnet")) {
      expect(chain.contracts.factoryV3, chain.key).toBeNull();
      expect(chain.contracts.implementationV3, chain.key).toBeNull();
      expect(chain.contracts.deployBlockV3, chain.key).toBeNull();
      expect(hasTokenDropContracts(chain), chain.key).toBe(false);
    }
  });
});

describe("the new fee on Robinhood, V4 recorded on robinhood testnet only", () => {
  it("robinhood testnet carries the deployed V4 set on top of V3, so hasFeeModelContracts is true", () => {
    const chain = getChain("robinhood-testnet");
    expect(chain.contracts.factoryV4).toBe("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4");
    // The same DropV3 as V3: V4 drops are clones of the same code.
    expect(chain.contracts.implementationV4).toBe("0xBb01721BFF0F6312488eb2058e56B723c27189D6");
    expect(chain.contracts.implementationV4).toBe(chain.contracts.implementationV3);
    expect(chain.contracts.deployBlockV4).toBe(130_766_040);
    expect(hasFeeModelContracts(chain)).toBe(true);
    // V3 stays recorded: the indexer keeps following its drops.
    expect(hasTokenDropContracts(chain)).toBe(true);
    expect(chain.contracts.factoryV3).toBe("0xeCD5E1d71dbE6072bb595209E9a19E0A3bBFB384");
  });

  it("every other chain carries the three V4 fields as null, so hasFeeModelContracts is false", () => {
    for (const chain of chains.filter((c) => c.key !== "robinhood-testnet")) {
      expect(chain.contracts.factoryV4, chain.key).toBeNull();
      expect(chain.contracts.implementationV4, chain.key).toBeNull();
      expect(chain.contracts.deployBlockV4, chain.key).toBeNull();
      expect(hasFeeModelContracts(chain), chain.key).toBe(false);
    }
  });
});

describe("the safe ETH return and the refund check, V5 recorded on robinhood testnet only", () => {
  it("robinhood testnet carries the deployed V5 set on top of V4, so hasRefundSafeContracts is true", () => {
    const chain = getChain("robinhood-testnet");
    expect(chain.contracts.factoryV5).toBe("0xF01FF6f70482955078AF1cF774bd500E9276AFdc");
    expect(chain.contracts.implementationV5).toBe("0x39C2789dE00750a53987b140BE8b631965eBC933");
    expect(chain.contracts.deployBlockV5).toBe(134_603_946);
    expect(hasRefundSafeContracts(chain)).toBe(true);
    // V4 stays recorded: the indexer keeps following its drops.
    expect(hasFeeModelContracts(chain)).toBe(true);
    expect(chain.contracts.factoryV4).toBe("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4");
  });

  it("every other chain carries the three V5 fields as null, so hasRefundSafeContracts is false", () => {
    for (const chain of chains.filter((c) => c.key !== "robinhood-testnet")) {
      expect(chain.contracts.factoryV5, chain.key).toBeNull();
      expect(chain.contracts.implementationV5, chain.key).toBeNull();
      expect(chain.contracts.deployBlockV5, chain.key).toBeNull();
      expect(hasRefundSafeContracts(chain), chain.key).toBe(false);
    }
  });
});

describe("the V6 set, recorded on robinhood testnet only", () => {
  it("robinhood testnet carries the deployed V6 set on top of V5, so hasV6Contracts is true", () => {
    const chain = getChain("robinhood-testnet");
    expect(chain.contracts.factoryV6).toBe("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba");
    expect(chain.contracts.implementationV6).toBe("0x5fbe17722728C8A34bF4763B83Eb699774133D1F");
    expect(chain.contracts.binderRegistryV2).toBe("0x3AFad174a45B82B3A0418D2f39c640C86d76Ea20");
    // The L2 block of the DropFactoryV6 deploy, not the L1 block the script logs.
    expect(chain.contracts.deployBlockV6).toBe(140_304_587);
    expect(hasV6Contracts(chain)).toBe(true);
    // V5 and the old registry stay recorded: the indexer keeps following their drops.
    expect(hasRefundSafeContracts(chain)).toBe(true);
    expect(chain.contracts.binderRegistry).toBe("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");
  });

  it("every other chain carries the four V6 fields as null, so hasV6Contracts is false", () => {
    for (const chain of chains.filter((c) => c.key !== "robinhood-testnet")) {
      expect(chain.contracts.factoryV6, chain.key).toBeNull();
      expect(chain.contracts.implementationV6, chain.key).toBeNull();
      // robinhood carries binderRegistryV2 for its V7 set alone since.
      if (chain.key !== "robinhood") expect(chain.contracts.binderRegistryV2, chain.key).toBeNull();
      expect(chain.contracts.deployBlockV6, chain.key).toBeNull();
      expect(hasV6Contracts(chain), chain.key).toBe(false);
    }
  });
});

describe("isTestnetOnly", () => {
  it("is false from the switch release: solana mainnet carries its program", () => {
    expect(isTestnetOnly()).toBe(false);
  });

  /**
   * The registry as it was before the switch: solana mainnet coming soon, no slot, and robinhood
   * mainnet without its V7 record.
   */
  const beforeSwitch = chains.map((chain) =>
    chain.key === "solana"
      ? {
          ...chain,
          status: "coming_soon" as const,
          contracts: { ...chain.contracts, deploySlot: null },
        }
      : chain.key === "robinhood"
        ? { ...chain, contracts: { ...chain.contracts, ...NO_V7_RECORD } }
        : chain,
  );

  it("flips the day a mainnet gets a deployed factory, and stays true for an active mainnet without one", () => {
    // robinhood mainnet is active with no factory: that is not running on a mainnet.
    expect(isTestnetOnly(beforeSwitch)).toBe(true);
    const withMainnet = beforeSwitch.map((chain) =>
      chain.key === "robinhood"
        ? {
            ...chain,
            contracts: {
              ...chain.contracts,
              factory: "0x0000000000000000000000000000000000000001",
              implementation: "0x0000000000000000000000000000000000000002",
              deployBlock: 1,
            },
          }
        : chain,
    );
    expect(isTestnetOnly(withMainnet)).toBe(false);
  });

  it("flips for a mainnet program too", () => {
    const withSolana = beforeSwitch.map((chain) =>
      chain.key === "solana"
        ? { ...chain, status: "active" as const, contracts: { ...chain.contracts, deploySlot: 1 } }
        : chain,
    );
    expect(isTestnetOnly(withSolana)).toBe(false);
  });

  // round: V6 alone counts as deployed, so the H2 beta texts show on mainnet day.
  const v6 = {
    factoryV6: "0x0000000000000000000000000000000000000f06",
    implementationV6: "0x0000000000000000000000000000000000000d06",
    binderRegistryV2: "0x0000000000000000000000000000000000000b02",
    deployBlockV6: 1,
  };

  it("flips for a mainnet with the V6 set alone", () => {
    const withV6 = chains.map((chain) =>
      chain.key === "robinhood" ? { ...chain, contracts: { ...chain.contracts, ...v6 } } : chain,
    );
    expect(isTestnetOnly(withV6)).toBe(false);
  });

  it("stays true for a testnet with the V6 set", () => {
    const withV6 = beforeSwitch.map((chain) =>
      chain.key === "robinhood-testnet"
        ? { ...chain, contracts: { ...chain.contracts, ...v6 } }
        : chain,
    );
    expect(isTestnetOnly(withV6)).toBe(true);
  });
});

// -- The V7 set -------------------------------------------------------------

describe("the V7 set", () => {
  // The parsed robinhood testnet record: V1 to V6 recorded, the testnet shape. Its mainnet comes
  // second in the document, so `testnetOf` resolves; `chains[0]` is the chain under test.
  const live = getChain("robinhood-testnet");
  const base = {
    ...live,
    contracts: { ...live.contracts, factoryV7: null, implementationV7: null, deployBlockV7: null },
  };
  const mainnet = getChain("robinhood");
  const doc = (contracts: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    version: 1,
    chains: [{ ...base, ...extra, contracts: { ...base.contracts, ...contracts } }, mainnet],
  });

  // V7 clones a new DropV7 and reads BinderRegistryV2.5.
  const v7 = {
    factoryV7: "0x0000000000000000000000000000000000000f07",
    implementationV7: "0x0000000000000000000000000000000000000d07",
    deployBlockV7: 170_000_000,
  };
  const older = {
    factory: null,
    implementation: null,
    deployBlock: null,
    factoryV2: null,
    implementationV2: null,
    binderRegistry: null,
    deployBlockV2: null,
    factoryV3: null,
    implementationV3: null,
    deployBlockV3: null,
    factoryV4: null,
    implementationV4: null,
    deployBlockV4: null,
    factoryV5: null,
    implementationV5: null,
    deployBlockV5: null,
    factoryV6: null,
    implementationV6: null,
    deployBlockV6: null,
  };

  it("accepts the V7 set on top of the V6 set, the testnet shape, and hasV7Contracts says so", () => {
    const chain = parseRegistry(doc(v7)).chains[0];
    expect(chain?.contracts.factoryV7).toBe(v7.factoryV7);
    expect(chain?.contracts.implementationV7).toBe(v7.implementationV7);
    expect(chain?.contracts.deployBlockV7).toBe(170_000_000);
    expect(chain !== undefined && hasV7Contracts(chain)).toBe(true);
    // V6 stays recorded under V7: its drops keep working.
    expect(chain !== undefined && hasV6Contracts(chain)).toBe(true);
  });

  it("accepts the V7 set alone with binderRegistryV2, every V1 to V6 field null, the mainnet shape", () => {
    const chain = parseRegistry(doc({ ...older, ...v7 })).chains[0];
    expect(chain !== undefined && hasV7Contracts(chain)).toBe(true);
    expect(chain !== undefined && hasV6Contracts(chain)).toBe(false);
    expect(chain?.contracts.binderRegistryV2).toBe(base.contracts.binderRegistryV2);
  });

  it("rejects a V7 set with one field missing: all three or none", () => {
    for (const key of Object.keys(v7)) {
      expect(() => parseRegistry(doc({ ...v7, [key]: null })), key).toThrow(
        /factoryV7, implementationV7, deployBlockV7: all three or none/,
      );
    }
  });

  it("rejects a V7 set without binderRegistryV2", () => {
    expect(() => parseRegistry(doc({ ...older, binderRegistryV2: null, ...v7 }))).toThrow(
      /V7 set needs binderRegistryV2/,
    );
  });

  it("rejects a V7 set on part of the older stack: on top of V6, or alone", () => {
    const cases = [
      ["V1 to V5, no V6", { factoryV6: null, implementationV6: null, deployBlockV6: null }],
      [
        "V1 only",
        {
          ...older,
          factory: base.contracts.factory,
          implementation: base.contracts.implementation,
          deployBlock: base.contracts.deployBlock,
        },
      ],
    ] as const;
    for (const [what, fields] of cases) {
      expect(() => parseRegistry(doc({ ...fields, ...v7 })), what).toThrow(
        /V7 fields need the V6 set, or no older field/,
      );
    }
  });

  it("rejects an implementationV7 that is an older implementation, in any letter case", () => {
    const c = base.contracts;
    for (const old of [
      c.implementation,
      c.implementationV2,
      c.implementationV3,
      c.implementationV5,
      c.implementationV6,
    ]) {
      if (old === null) continue;
      const same = { ...v7, implementationV7: old.toUpperCase().replace("0X", "0x") };
      expect(() => parseRegistry(doc(same)), old).toThrow(/implementationV7 must not be an older/);
    }
  });

  it("rejects a factoryV7 that is an older factory", () => {
    const c = base.contracts;
    for (const old of [
      c.factory,
      c.factoryV2,
      c.factoryV3,
      c.factoryV4,
      c.factoryV5,
      c.factoryV6,
    ]) {
      if (old === null) continue;
      expect(() => parseRegistry(doc({ ...v7, factoryV7: old })), old).toThrow(
        /factoryV7 must not be an older/,
      );
    }
  });

  it("rejects a V7 field on an svm chain", () => {
    const svm = chains.find((c) => c.family === "svm") as (typeof chains)[number];
    const bad = { version: 1, chains: [{ ...svm, contracts: { ...svm.contracts, ...v7 } }] };
    expect(() => parseRegistry(bad)).toThrow(/evm only/);
  });

  it("rejects a document that leaves a V7 key out instead of writing null", () => {
    for (const key of Object.keys(v7)) {
      const rest: Record<string, unknown> = { ...base.contracts };
      delete rest[key];
      const bad = { version: 1, chains: [{ ...base, contracts: rest }, mainnet] };
      expect(() => parseRegistry(bad), key).toThrow(new RegExp(key));
    }
  });

  it("hasV7Contracts is false with no V7 set, and on a chain that is not active", () => {
    const none = parseRegistry(doc({})).chains[0];
    expect(none !== undefined && hasV7Contracts(none)).toBe(false);
    const soon = parseRegistry(doc(v7, { status: "coming_soon" })).chains[0];
    expect(soon !== undefined && hasV7Contracts(soon)).toBe(false);
  });

  it("robinhood testnet carries the deployed V7 set on top of V6, so hasV7Contracts is true", () => {
    const chain = getChain("robinhood-testnet");
    expect(chain.contracts.factoryV7).toBe("0x61147e60e8F264c760b88Dd38C002B5bdF47254f");
    expect(chain.contracts.implementationV7).toBe("0x9274c88d7431Ef7533309cCC77bB9c1AdEB16720");
    // The L2 block of the DropFactoryV7 deploy, not the L1 block the script writes.
    expect(chain.contracts.deployBlockV7).toBe(142_267_213);
    expect(hasV7Contracts(chain)).toBe(true);
    // V6 and its registry stay recorded: DropV7 reads the same BinderRegistryV2.
    expect(hasV6Contracts(chain)).toBe(true);
    expect(chain.contracts.binderRegistryV2).toBe("0x3AFad174a45B82B3A0418D2f39c640C86d76Ea20");
  });

  it("every other chain carries the three V7 fields as null, so hasV7Contracts is false", () => {
    // robinhood carries V7 alone since, robinhood-mainnet-record.test.ts.
    const others = chains.filter((c) => c.key !== "robinhood-testnet" && c.key !== "robinhood");
    for (const chain of others) {
      expect(chain.contracts.factoryV7, chain.key).toBeNull();
      expect(chain.contracts.implementationV7, chain.key).toBeNull();
      expect(chain.contracts.deployBlockV7, chain.key).toBeNull();
      expect(hasV7Contracts(chain), chain.key).toBe(false);
    }
  });

  it("isTestnetOnly flips for a mainnet with the V7 set alone, and stays true for a testnet with it", () => {
    const v7Alone = {
      ...older,
      ...v7,
      binderRegistryV2: "0x0000000000000000000000000000000000000b02",
    };
    const withMainnet = chains.map((chain) =>
      chain.key === "robinhood"
        ? { ...chain, contracts: { ...chain.contracts, ...v7Alone } }
        : chain,
    );
    expect(isTestnetOnly(withMainnet)).toBe(false);
    // From the registry as it was before the switch: solana mainnet coming soon, no slot.
    const beforeSwitch = chains.map((chain) =>
      chain.key === "solana"
        ? {
            ...chain,
            status: "coming_soon" as const,
            contracts: { ...chain.contracts, deploySlot: null },
          }
        : chain.key === "robinhood"
          ? { ...chain, contracts: { ...chain.contracts, ...NO_V7_RECORD } }
          : chain,
    );
    const withTestnet = beforeSwitch.map((chain) =>
      chain.key === "robinhood-testnet"
        ? { ...chain, contracts: { ...chain.contracts, ...v7 } }
        : chain,
    );
    expect(isTestnetOnly(withTestnet)).toBe(true);
  });
});
