/**
 * The chain rail's selection. Several chains can be on at once; `all` is every
 * chain. A filter can never end up with nothing selected.
 */
import { describe, expect, it } from "vitest";

import { ALL, boardChainOf, isAll, isOn, selectedChainIds, toggleChain } from "@/lib/chain-filter";
import type { ChainPill } from "@/lib/chains";

const pill = (key: string, selectable: boolean, chainIds: number[]): ChainPill => ({
  key,
  name: key,
  nativeSymbol: "X",
  logo: `/chains/${key}.svg`,
  tileColor: "black",
  markScale: 1,
  quickTokens: [],
  selectable,
  chainIds,
  family: "evm",
  decimals: 18,
  chainKey: selectable ? `${key}-testnet` : null,
});

const pills = [
  pill("robinhood", true, [46630]),
  pill("solana", true, [103]),
  pill("bnb", false, []),
  pill("ethereum", false, []),
];

describe("chain filter", () => {
  it("starts on all: every live chain is on", () => {
    expect(isAll(ALL)).toBe(true);
    expect(isOn(ALL, "robinhood")).toBe(true);
    expect(isOn(ALL, "solana")).toBe(true);
    expect(isOn(ALL, "bnb")).toBe(true);
  });

  it("turning one chain off from all leaves the others on", () => {
    const only = toggleChain(ALL, "robinhood", pills);
    expect(isAll(only)).toBe(false);
    expect(isOn(only, "robinhood")).toBe(false);
    expect(isOn(only, "solana")).toBe(true);
  });

  it("turning a chain on and off toggles, and turning every live chain on is all again", () => {
    const solanaOnly = toggleChain(ALL, "robinhood", pills);
    const back = toggleChain(solanaOnly, "robinhood", pills);
    expect(isAll(back)).toBe(true);
  });

  it("never ends with nothing on: turning the last chain off goes back to all", () => {
    const solanaOnly = toggleChain(ALL, "robinhood", pills);
    const nothing = toggleChain(solanaOnly, "solana", pills);
    expect(isAll(nothing)).toBe(true);
  });

  it("a chain that is not live cannot be toggled", () => {
    expect(toggleChain(ALL, "bnb", pills)).toBe(ALL);
    const solanaOnly = toggleChain(ALL, "robinhood", pills);
    expect(toggleChain(solanaOnly, "bnb", pills)).toBe(solanaOnly);
  });

  it("the chain ids to filter rows by follow the selection", () => {
    expect(selectedChainIds(ALL, pills)).toBeNull();
    const solanaOnly = toggleChain(ALL, "robinhood", pills);
    expect([...(selectedChainIds(solanaOnly, pills) ?? [])]).toEqual([103]);
  });

  it("the board asks for one chain when exactly one is on, else all", () => {
    expect(boardChainOf(ALL)).toBe("all");
    const solanaOnly = toggleChain(ALL, "robinhood", pills);
    expect(boardChainOf(solanaOnly)).toBe("solana");
    expect(boardChainOf(new Set(["robinhood", "solana"]))).toBe("all");
  });
});
