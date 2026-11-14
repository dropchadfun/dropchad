/**
 * No testnet chain on a mainnet site, the api side. A mainnet site
 * is one where `CHAIN_KEY` or `SOLANA_CHAIN_KEY` names a mainnet chain. Then `chain=all` and no
 * `chain` leave out every testnet chain, the default pill is the first mainnet chain's, and
 * `/api/claims` lists no testnet claims. A testnet only api stays exactly as before.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  chainFilter,
  claimsChainAllowed,
  defaultPillKey,
  isMainnetSite,
} from "../src/chain/filter.js";
import { loadConfig } from "../src/config.js";
import { TEST_ENV } from "./harness.js";

const SRC = join(import.meta.dirname, "..", "src");
const MAINNET = { CHAIN_KEY: "robinhood-testnet", SOLANA_CHAIN_KEY: "solana" };
const TESTNET = { CHAIN_KEY: "robinhood-testnet", SOLANA_CHAIN_KEY: "solana-devnet" };

describe("a mainnet site", () => {
  it("is one where a configured chain is a mainnet chain", () => {
    expect(isMainnetSite(MAINNET)).toBe(true);
    expect(isMainnetSite(TESTNET)).toBe(false);
  });

  it("the default pill is the first configured mainnet chain's", () => {
    expect(defaultPillKey(MAINNET)).toBe("solana");
    expect(defaultPillKey(TESTNET)).toBe("robinhood");
  });
});

describe("the chain filter on a mainnet site", () => {
  it("all leaves out every testnet chain", () => {
    const all = chainFilter("all", { mainnetSite: true });
    expect(all?.keys).not.toBeNull();
    expect(all?.keys?.has("solana")).toBe(true);
    expect(all?.keys?.has("robinhood")).toBe(true);
    expect(all?.keys?.has("solana-devnet")).toBe(false);
    expect(all?.keys?.has("robinhood-testnet")).toBe(false);
  });

  it("a pill means its mainnet chain only", () => {
    expect([...(chainFilter("solana", { mainnetSite: true })?.keys ?? [])]).toEqual(["solana"]);
    expect([...(chainFilter("robinhood", { mainnetSite: true })?.keys ?? [])]).toEqual([
      "robinhood",
    ]);
  });

  it("on a testnet only api nothing changes", () => {
    expect(chainFilter("all")?.keys).toBeNull();
    expect(chainFilter("all", { mainnetSite: false })?.keys).toBeNull();
    expect([...(chainFilter("solana")?.keys ?? [])].sort()).toEqual(["solana", "solana-devnet"]);
  });
});

describe("the claims on a mainnet site", () => {
  it("testnet claims are left out, mainnet claims stay", () => {
    expect(claimsChainAllowed("robinhood-testnet", true)).toBe(false);
    expect(claimsChainAllowed("solana-devnet", true)).toBe(false);
    expect(claimsChainAllowed("solana", true)).toBe(true);
  });

  it("on a testnet only api every claim stays", () => {
    expect(claimsChainAllowed("robinhood-testnet", false)).toBe(true);
    expect(claimsChainAllowed("solana-devnet", false)).toBe(true);
  });
});

describe("the routes use the rule", () => {
  const read = (file: string) => readFileSync(join(SRC, file), "utf8");

  it("boards and trending default to the mainnet pill", () => {
    for (const file of ["routes/boards.ts", "routes/trending.ts"]) {
      const src = read(file);
      expect(src, file).toContain("defaultPillKey(config)");
      expect(src, file).not.toContain("pillKeyOf(config.CHAIN_KEY)");
    }
  });

  it("every list asks the filter with the mainnet site flag", () => {
    for (const file of [
      "routes/boards.ts",
      "routes/trending.ts",
      "routes/drops.ts",
      "routes/users.ts",
      "index.ts",
    ]) {
      expect(read(file), file).toContain("mainnetSite: isMainnetSite(config)");
    }
  });

  it("the claims route leaves out testnet claims", () => {
    expect(read("routes/claims.ts")).toContain("claimsChainAllowed(");
  });
});

describe("the api starts with Robinhood on testnet and Solana on mainnet", () => {
  it("the config loads, testnet rules on one chain and mainnet rules on the other", () => {
    const config = loadConfig({ ...TEST_ENV, ...MAINNET });
    expect(config.CHAIN_KEY).toBe("robinhood-testnet");
    expect(config.SOLANA_CHAIN_KEY).toBe("solana");
  });

  it("a raw Solana key on the mainnet chain still stops the start", () => {
    expect(() => loadConfig({ ...TEST_ENV, ...MAINNET, SOLANA_RELAYER_SECRET: "[1,2,3]" })).toThrow(
      /SOLANA_RELAYER_SECRET is set and SOLANA_CHAIN_KEY "solana" is a mainnet chain/,
    );
  });
});
