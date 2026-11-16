/**
 * No testnet chain on a mainnet site, with the `solana` registry
 * entry live: a pill counts only its mainnet chain; the Solana
 * pill means chain id 101 only. A pill counts its chain as deployed by the same
 * test as `liveMainnetKeys`, so the robinhood V7 record makes its pill live.
 */
import { describe, expect, it } from "vitest";

import { chains, type Chain } from "@dropchad/chains";

import { TESTNET_ONLY, chainPills, isLiveDeployed, liveMainnetKeys } from "@/lib/chains";

const pill = (key: string) => {
  const found = chainPills().find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`no pill ${key}`);
  return found;
};

describe("the pills on a mainnet site", () => {
  it("the site runs mainnet; with no api answer Solana is the one live mainnet chain", () => {
    expect(TESTNET_ONLY).toBe(false);
    expect(liveMainnetKeys()).toEqual(["solana"]);
  });

  it("the Solana pill is Solana mainnet only", () => {
    const solana = pill("solana");
    expect(solana.selectable).toBe(true);
    expect(solana.chainKey).toBe("solana");
    expect(solana.chainIds).toEqual([101]);
    expect(solana.quickTokens.map((token) => token.symbol)).toEqual(["USDC", "USDT", "USD1"]);
  });

  it("the Robinhood pill counts its V7 only mainnet record once the api lists it", () => {
    const listed = { listed: new Set(["robinhood"]), paused: new Set<string>() };
    const robinhood = chainPills({ view: listed }).find((entry) => entry.key === "robinhood");
    if (robinhood === undefined) throw new Error("no robinhood pill");
    expect(robinhood.selectable).toBe(true);
    expect(robinhood.chainKey).toBe("robinhood");
    expect(robinhood.chainIds).toEqual([4663]);
    expect(robinhood.quickTokens.map((token) => token.symbol)).toEqual(["USDG"]);
  });

  it("one helper: a selectable mainnet pill is exactly a live mainnet key", () => {
    const selectable = chainPills()
      .filter((entry) => entry.selectable)
      .map((entry) => entry.key)
      .sort();
    expect(selectable).toEqual([...liveMainnetKeys()].sort());
  });

  it("the helper counts V1, V6, V7 or a program, and nothing else", () => {
    const robinhood = chains.find((chain) => chain.key === "robinhood") as Chain;
    const none = {
      factoryV7: null,
      implementationV7: null,
      binderRegistryV2: null,
      deployBlockV7: null,
    };
    expect(isLiveDeployed(robinhood)).toBe(true);
    expect(isLiveDeployed({ ...robinhood, contracts: { ...robinhood.contracts, ...none } })).toBe(
      false,
    );
    expect(isLiveDeployed({ ...robinhood, status: "coming_soon" })).toBe(false);
    for (const key of ["bnb", "base", "ethereum", "ton"]) {
      expect(isLiveDeployed(chains.find((chain) => chain.key === key) as Chain), key).toBe(false);
    }
    expect(isLiveDeployed(chains.find((chain) => chain.key === "solana") as Chain)).toBe(true);
  });

  it("no pill carries a testnet chain id", () => {
    for (const entry of chainPills()) {
      expect(entry.chainIds, entry.key).not.toContain(103);
      expect(entry.chainIds, entry.key).not.toContain(46630);
    }
  });
});
