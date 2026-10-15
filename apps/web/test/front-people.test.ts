/**
 * The `people paid` tile on the front page. People are counted per chain,
 * one X account counts once inside one chain. With
 * every chain on, the tile adds up each chain's count, so one X account paid on two chains is two
 * there. With one chain picked it is that chain's count. `peoplePaid` in
 * `components/front/people.ts`.
 */
import { describe, expect, it } from "vitest";

import { payoutsPaid, peoplePaid } from "@/components/front/people";
import type { Stats } from "@/lib/api";
import { ALL } from "@/lib/chain-filter";
import type { ChainPill } from "@/lib/chains";

const pills = [
  { key: "robinhood", chainIds: [46630], selectable: true },
  { key: "solana", chainIds: [], selectable: true },
] as unknown as ChainPill[];

// One X account was paid on both chains: 3 on Robinhood, 2 on Solana. The 4 here is the old one
// set over all chains; the tile no longer uses it and says 5.
const stats = {
  uniqueReceivers: 4,
  totals: [
    { chainKey: "robinhood-testnet", uniqueReceivers: 3 },
    { chainKey: "solana-devnet", uniqueReceivers: 2 },
  ],
} as unknown as Stats;

describe("peoplePaid", () => {
  it("every chain on: each chain's count added up", () => {
    expect(peoplePaid(stats, ALL, pills)).toBe(5);
  });

  it("one chain picked: that chain's count", () => {
    expect(peoplePaid(stats, new Set(["robinhood"]), pills)).toBe(3);
    expect(peoplePaid(stats, new Set(["solana"]), pills)).toBe(2);
  });

  it("a picked chain with no row counts zero", () => {
    const onlyRobinhood = {
      uniqueReceivers: 3,
      totals: [{ chainKey: "robinhood-testnet", uniqueReceivers: 3 }],
    } as unknown as Stats;
    expect(peoplePaid(onlyRobinhood, new Set(["solana"]), pills)).toBe(0);
  });

  it("no stats yet: null, so the tile stays a skeleton", () => {
    expect(peoplePaid(null, ALL, pills)).toBeNull();
  });
});

describe("payoutsPaid", () => {
  // Every final claim is one payout. 5 on Robinhood, 2 on Solana.
  const withClaims = {
    uniqueReceivers: 4,
    claimCount: 7,
    totals: [
      { chainKey: "robinhood-testnet", uniqueReceivers: 3, claimCount: 5 },
      { chainKey: "solana-devnet", uniqueReceivers: 2, claimCount: 2 },
    ],
  } as unknown as Stats;

  it("every chain on: each chain's payouts added up", () => {
    expect(payoutsPaid(withClaims, ALL, pills)).toBe(7);
  });

  it("one chain picked: that chain's payouts only", () => {
    expect(payoutsPaid(withClaims, new Set(["robinhood"]), pills)).toBe(5);
    expect(payoutsPaid(withClaims, new Set(["solana"]), pills)).toBe(2);
  });

  it("no stats yet: null, so the tile stays a skeleton", () => {
    expect(payoutsPaid(null, ALL, pills)).toBeNull();
  });
});
