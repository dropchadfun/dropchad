/**
 * Payouts: one payout is one final claim of a handle
 * drop, so one person paid in three drops is three payouts. `claimCount` on every board row and
 * each of its `byChain` entries, the chains added up, the same rule as people. The tiles show it
 * big; the boards still rank by people.
 */
import { describe, expect, it } from "vitest";

import {
  boardRowJson,
  rankBoard,
  totalsByChad,
  type BoardProfile,
  type CountedDrop,
} from "../src/boards/compute.js";
import { chainFilter, type ChainFilter } from "../src/chain/filter.js";

const bob: BoardProfile = {
  xUserId: "2",
  handle: "bob",
  displayName: "Bob",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
};

const drop = (
  address: string,
  chainKey: string,
  people: string[],
  claimed = 1_000n,
): CountedDrop => ({
  address,
  chainKey,
  xUserId: "2",
  createdAt: 1_800_000_000,
  claimed,
  claimCount: people.length,
  people,
  priceUsd: null,
});

// X id 1000 is paid twice on Robinhood and once more on Solana.
const counted = [
  drop("0xa", "robinhood-testnet", ["1000", "5000"]),
  drop("0xb", "robinhood-testnet", ["1000"]),
  drop("Sol1", "solana-devnet", ["1000"]),
];

const totals = (filter: ChainFilter, drops = counted) =>
  totalsByChad(drops, new Map([["2", bob]]), {
    filter,
    evmChainKeys: new Set(["robinhood-testnet"]),
  });

describe("payouts on the board rows", () => {
  it("every final claim is one payout, people stay once inside one chain", () => {
    const [row] = totals(chainFilter("all") as ChainFilter);
    // Robinhood: 3 payouts to 2 people. Solana: 1 payout to 1 person.
    expect(row?.claimCount).toBe(4);
    expect(row?.uniqueReceivers).toBe(3);
    expect(row?.byChain.map((c) => [c.chainKey, c.claimCount, c.uniqueReceivers]).sort()).toEqual([
      ["robinhood-testnet", 3, 2],
      ["solana-devnet", 1, 1],
    ]);
  });

  it("one chain counts that chain only", () => {
    const solanaOnly = counted.filter((d) => d.chainKey === "solana-devnet");
    const [row] = totals(chainFilter("solana") as ChainFilter, solanaOnly);
    expect(row?.claimCount).toBe(1);
  });

  it("the JSON carries claimCount on the row and on each chain", () => {
    const [ranked] = rankBoard(totals(chainFilter("all") as ChainFilter), "all", "uniqueReceivers");
    if (ranked === undefined) throw new Error("no row");
    const json = boardRowJson(ranked);
    expect(json.claimCount).toBe(4);
    expect(json.byChain.map((c) => c.claimCount).sort()).toEqual([1, 3]);
  });

  it("the boards still rank by people, not by payouts", () => {
    const carol: BoardProfile = { ...bob, xUserId: "3", handle: "carol" };
    // Carol: 1 person paid in 4 drops, 4 payouts. Bob: 3 people, 4 payouts too but more people.
    const carolDrops = ["c1", "c2", "c3", "c4"].map((a) => ({
      ...drop(a, "robinhood-testnet", ["9000"]),
      xUserId: "3",
    }));
    const rows = totalsByChad(
      [...counted, ...carolDrops],
      new Map([
        ["2", bob],
        ["3", carol],
      ]),
      {
        filter: chainFilter("all") as ChainFilter,
        evmChainKeys: new Set(["robinhood-testnet"]),
      },
    );
    const ranked = rankBoard(rows, "all", "uniqueReceivers");
    expect(ranked.map((r) => [r.profile.handle, r.uniqueReceivers, r.claimCount])).toEqual([
      ["bob", 3, 4],
      ["carol", 1, 4],
    ]);
  });
});
