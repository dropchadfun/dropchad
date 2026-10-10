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
  hasTokenDropContracts,
  isDeployed,
  isProgramDeployed,
  isTestnetOnly,
  parseRegistry,
  registry,
  rpcUrlFor,
  rpcUrlsFor,
} from "../src/index.js";

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
    expect(getChain("solana").contracts.deploySlot).toBeNull();
  });

  it("is program deployed on devnet, active", () => {
    const devnet = getChain("solana-devnet");
    expect(devnet.status).toBe("active");
    expect(isProgramDeployed(devnet)).toBe(true);
    expect(getDeployedProgramChains().map((c) => c.key)).toEqual(["solana-devnet"]);
    // A program is not a factory. `getDeployedChains` is the factory list and stays EVM only.
    expect(isDeployed(devnet)).toBe(false);
    expect(getDeployedChains().map((c) => c.key)).toEqual(["robinhood-testnet"]);
  });

  it("keeps solana mainnet coming soon until the audit", () => {
    const mainnet = getChain("solana");
    expect(mainnet.status).toBe("coming_soon");
    expect(isProgramDeployed(mainnet)).toBe(false);
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

describe("isTestnetOnly", () => {
  it("is true today: no mainnet carries a factory or a program", () => {
    expect(isTestnetOnly()).toBe(true);
  });

  it("flips the day a mainnet gets a deployed factory, and stays true for an active mainnet without one", () => {
    // robinhood mainnet is active with no factory: that is not running on a mainnet.
    expect(isTestnetOnly(chains)).toBe(true);
    const withMainnet = chains.map((chain) =>
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
    const withSolana = chains.map((chain) =>
      chain.key === "solana"
        ? { ...chain, status: "active" as const, contracts: { ...chain.contracts, deploySlot: 1 } }
        : chain,
    );
    expect(isTestnetOnly(withSolana)).toBe(false);
  });
});
