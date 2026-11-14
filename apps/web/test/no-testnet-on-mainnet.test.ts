/**
 * No testnet chain on a mainnet site, with the `solana` registry
 * entry live: a pill counts only its mainnet chain. Robinhood is
 * shown but cannot be chosen while it runs on testnet; the Solana pill means chain id 101 only.
 */
import { describe, expect, it } from "vitest";

import { TESTNET_ONLY, chainPills, liveMainnetKeys } from "@/lib/chains";

const pill = (key: string) => {
  const found = chainPills().find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`no pill ${key}`);
  return found;
};

describe("the pills on a mainnet site", () => {
  it("the site runs mainnet, Solana is the one live mainnet chain", () => {
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

  it("the Robinhood pill is shown but cannot be chosen while Robinhood runs on testnet", () => {
    const robinhood = pill("robinhood");
    expect(robinhood.selectable).toBe(false);
    expect(robinhood.chainKey).toBeNull();
    expect(robinhood.chainIds).toEqual([]);
    expect(robinhood.quickTokens).toEqual([]);
  });

  it("no pill carries a testnet chain id", () => {
    for (const entry of chainPills()) {
      expect(entry.chainIds, entry.key).not.toContain(103);
      expect(entry.chainIds, entry.key).not.toContain(46630);
    }
  });
});
