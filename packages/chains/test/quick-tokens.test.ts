/**
 * quick token chips. Each chain entry carries
 * `quickTokens`, a ticker and an exact address. A tap on the create page fills the token box;
 * the same check as a paste runs, so this list never lets a token past an allowlist.
 */
import { describe, expect, it } from "vitest";

import { chains, findQuickToken, getChain, parseRegistry } from "../src/index.js";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAINNET_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const TUSDC = "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C";

describe("the quick token list", () => {
  it("solana devnet: USDC, Circle's devnet mint", () => {
    expect(getChain("solana-devnet").quickTokens).toEqual([
      { symbol: "USDC", address: DEVNET_USDC, name: "USD Coin", logo: "/tokens/usdc.png" },
    ]);
  });

  it("robinhood testnet: tUSDC, the token on V4's allowlist", () => {
    expect(getChain("robinhood-testnet").quickTokens).toEqual([
      { symbol: "tUSDC", address: TUSDC, name: "Test USDC", logo: "/tokens/usdc.png" },
    ]);
  });

  it("solana mainnet: USDC then USDT, the freeze exception mints", () => {
    expect(getChain("solana").quickTokens).toEqual([
      { symbol: "USDC", address: MAINNET_USDC, name: "USD Coin", logo: "/tokens/usdc.png" },
      { symbol: "USDT", address: MAINNET_USDT, name: "Tether USD", logo: "/tokens/usdt.png" },
    ]);
  });

  it("robinhood mainnet: none until USDC or USDT exist there", () => {
    expect(getChain("robinhood").quickTokens).toEqual([]);
  });

  it("no USDT on any testnet", () => {
    for (const chain of chains.filter((c) => c.kind === "testnet")) {
      expect(chain.quickTokens.map((t) => t.symbol)).not.toContain("USDT");
    }
  });

  it("every other chain has none", () => {
    for (const key of ["bnb", "base", "ethereum", "ton"]) {
      expect(getChain(key).quickTokens).toEqual([]);
    }
  });
});

describe("parseRegistry checks quickTokens", () => {
  const evm = {
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
    quickTokens: [] as unknown[],
  };
  const svm = { ...evm, key: "s", family: "svm", chainId: 101, nativeSymbol: "SOL" };
  const doc = (chain: object) => ({ version: 1, chains: [chain] });

  it("accepts an exact address in the chain's format", () => {
    const chain = parseRegistry(
      doc({ ...evm, quickTokens: [{ symbol: "tUSDC", address: TUSDC, name: "N", logo: null }] }),
    ).chains[0];
    expect(chain?.quickTokens).toEqual([
      { symbol: "tUSDC", address: TUSDC, name: "N", logo: null },
    ]);
    const sol = parseRegistry(
      doc({
        ...svm,
        quickTokens: [{ symbol: "USDC", address: MAINNET_USDC, name: "N", logo: null }],
      }),
    ).chains[0];
    expect(sol?.quickTokens).toEqual([
      { symbol: "USDC", address: MAINNET_USDC, name: "N", logo: null },
    ]);
  });

  it("refuses a chain without the field", () => {
    const { quickTokens: _, ...without } = evm;
    expect(() => parseRegistry(doc(without))).toThrow(/quickTokens/);
  });

  it("refuses an address in the other chain's format", () => {
    expect(() =>
      parseRegistry(
        doc({
          ...evm,
          quickTokens: [{ symbol: "USDC", address: MAINNET_USDC, name: "N", logo: null }],
        }),
      ),
    ).toThrow(/address/);
    expect(() =>
      parseRegistry(
        doc({ ...svm, quickTokens: [{ symbol: "USDC", address: TUSDC, name: "N", logo: null }] }),
      ),
    ).toThrow(/address/);
  });

  it("refuses an empty or long ticker", () => {
    expect(() =>
      parseRegistry(
        doc({ ...evm, quickTokens: [{ symbol: "", address: TUSDC, name: "N", logo: null }] }),
      ),
    ).toThrow(/symbol/);
    expect(() =>
      parseRegistry(
        doc({
          ...evm,
          quickTokens: [{ symbol: "ELEVENCHARS", address: TUSDC, name: "N", logo: null }],
        }),
      ),
    ).toThrow(/symbol/);
  });

  it("refuses the same address twice", () => {
    const twice = [
      { symbol: "A", address: TUSDC, name: "N", logo: null },
      { symbol: "B", address: TUSDC, name: "N", logo: null },
    ];
    expect(() => parseRegistry(doc({ ...evm, quickTokens: twice }))).toThrow(/twice/);
  });
});

describe("findQuickToken, by chain and exact address only", () => {
  it("the chain's own entry, with its name and logo", () => {
    expect(findQuickToken("solana-devnet", DEVNET_USDC)?.name).toBe("USD Coin");
    expect(findQuickToken("solana", MAINNET_USDT)?.logo).toBe("/tokens/usdt.png");
  });

  it("an evm address matches in any letter case", () => {
    expect(findQuickToken("robinhood-testnet", TUSDC.toLowerCase())?.symbol).toBe("tUSDC");
  });

  it("the right address on another chain, or any other address: nothing", () => {
    expect(findQuickToken("solana", DEVNET_USDC)).toBeUndefined();
    expect(findQuickToken("solana-devnet", MAINNET_USDC)).toBeUndefined();
    expect(
      findQuickToken("solana-devnet", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
    ).toBeUndefined();
    expect(findQuickToken("nope", DEVNET_USDC)).toBeUndefined();
  });
});

describe("parseRegistry checks a quick token's name and logo", () => {
  const base = getChain("solana-devnet");
  const doc = (token: object) => ({
    version: 1,
    chains: [{ ...base, key: "s", kind: "mainnet", testnetOf: undefined, quickTokens: [token] }],
  });
  const ok = { symbol: "USDC", address: DEVNET_USDC, name: "USD Coin", logo: "/tokens/usdc.png" };

  it("accepts a name of 1 to 32 characters and a logo under /tokens/ or none", () => {
    expect(parseRegistry(doc(ok)).chains[0]?.quickTokens).toEqual([ok]);
    expect(parseRegistry(doc({ ...ok, logo: null })).chains[0]?.quickTokens[0]?.logo).toBeNull();
  });

  it("refuses a missing or long name", () => {
    expect(() => parseRegistry(doc({ ...ok, name: "" }))).toThrow(/name/);
    expect(() => parseRegistry(doc({ ...ok, name: "x".repeat(33) }))).toThrow(/name/);
  });

  it("refuses a logo that is not one of our own png files", () => {
    for (const logo of [
      "https://example.com/usdc.png",
      "/tokens/usdc.svg",
      "/tokens/../x.png",
      "tokens/usdc.png",
    ]) {
      expect(() => parseRegistry(doc({ ...ok, logo }))).toThrow(/logo/);
    }
  });
});
