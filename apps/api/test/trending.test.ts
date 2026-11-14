/**
 * The trending block: chad of the day, top coin and
 * just dropped, up to 3 items each. Chad of the day and top coin: the last 24 hours only, rolling,
 * no fall back, the board's counting: handle drops only, final claims only, people are
 * X ids. Just dropped: the newest funded handle drops, any coin, final only, no window.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { BoardProfile, CountedDrop } from "../src/boards/compute.js";
import { readTrending } from "../src/boards/trending-read.js";
import {
  newestCoin,
  trendingCards,
  trendingJson,
  type FundedDrop,
} from "../src/boards/trending.js";
import type { SvmIndexedDrop } from "../src/chain/svm/reader.js";
import { chainFilter, type ChainFilter } from "../src/chain/filter.js";
import type { SvmReader } from "../src/chain/svm/reader.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import type { TokenInfo } from "../src/drops/token-info.js";
import { createHarness, type Harness } from "./harness.js";

const NATIVE = "0x0000000000000000000000000000000000000000";
const TOKEN_A = "0x00000000000000000000000000000000000000a1";
const TOKEN_B = "0x00000000000000000000000000000000000000b2";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

// -------------------------------------------------------------------------------------------
// the pure part
// -------------------------------------------------------------------------------------------

const profile = (xUserId: string, handle: string): BoardProfile => ({
  xUserId,
  handle,
  displayName: handle,
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
  streams: [],
});

const tokenOf = (mint: string, symbol: string): TokenInfo => ({
  mint,
  symbol,
  name: symbol,
  decimals: 18,
  tokenProgram: "erc20",
  logoUrl: `/api/tokens/${mint}/logo?chain=robinhood`,
  launchpad: null,
  xUrl: null,
});

let next = 0;
interface Drop {
  readonly xUserId: string;
  readonly people: string[];
  readonly mint?: string;
  readonly ago?: number;
  readonly receivers?: number;
  readonly claimed?: bigint;
  readonly chainKey?: string;
  readonly priceUsd?: number;
  readonly decimals?: number;
}
const counted = (d: Drop): CountedDrop => ({
  address: `0x${(next += 1).toString(16).padStart(40, "0")}`,
  chainKey: d.chainKey ?? "robinhood-testnet",
  xUserId: d.xUserId,
  createdAt: SECONDS - (d.ago ?? HOUR),
  claimed: d.claimed ?? 5n,
  claimCount: d.people.length,
  people: d.people,
  priceUsd: d.priceUsd ?? null,
  mint: d.mint ?? null,
  token:
    d.mint === undefined
      ? null
      : {
          ...tokenOf(d.mint, d.mint === TOKEN_A ? "AAA" : "BBB"),
          decimals: d.decimals ?? 18,
        },
  receivers: d.receivers ?? d.people.length,
  total: 100n,
});

const ALL = chainFilter("all") as ChainFilter;
const OPTIONS = {
  filter: ALL,
  evmChainKeys: new Set(["robinhood-testnet", "robinhood"]),
  nowSeconds: SECONDS,
};
const byId = new Map(
  ["alice", "bob", "carol", "dave"].map((h, i) => [String(i + 1), profile(String(i + 1), h)]),
);
const cards = (list: CountedDrop[], fundedList: FundedDrop[] = []) =>
  trendingCards(list, fundedList, byId, OPTIONS);

interface Funded {
  readonly xUserId: string;
  /** Seconds since funding. */
  readonly fundedAgo: number;
  /** Seconds since creation; a minute before funding unless given. */
  readonly ago?: number;
  readonly mint?: string;
  readonly chainKey?: string;
  readonly receivers?: number;
  readonly total?: bigint;
  readonly address?: string;
}
const funded = (d: Funded): FundedDrop => ({
  address: d.address ?? `0x${(next += 1).toString(16).padStart(40, "0")}`,
  chainKey: d.chainKey ?? "robinhood-testnet",
  xUserId: d.xUserId,
  createdAt: SECONDS - (d.ago ?? d.fundedAgo + 60),
  fundedAt: SECONDS - d.fundedAgo,
  receivers: d.receivers ?? 2,
  total: d.total ?? 100n,
  token: d.mint === undefined ? null : tokenOf(d.mint, d.mint === TOKEN_A ? "AAA" : "BBB"),
});

describe("chad of the day", () => {
  it("ranks by people paid, SOL and ETH drops only, top 3", () => {
    const { chad } = cards([
      counted({ xUserId: "1", people: ["a", "b"] }),
      counted({ xUserId: "2", people: ["c", "d", "e"] }),
      counted({ xUserId: "3", people: ["f"] }),
      counted({ xUserId: "4", people: ["g"] }),
      // A token drop is not on this card, however many people.
      counted({ xUserId: "1", people: ["h", "i", "j", "k"], mint: TOKEN_A }),
    ]);
    expect(chad.range).toBe("day");
    expect(chad.items.map((i) => i.profile.handle)).toEqual(["bob", "alice", "carol"]);
    expect(chad.items[1]?.people).toBe(2);
  });

  it("on a tie of people, the bigger usd value", () => {
    const { chad } = cards([
      // Bob: 1 person, 2 drops, no price.
      counted({ xUserId: "2", people: ["a"] }),
      counted({ xUserId: "2", people: ["a"] }),
      // Carol: 1 person, 1 drop, 1 ETH at 2000 usd.
      counted({ xUserId: "3", people: ["b"], claimed: 10n ** 18n, priceUsd: 2000 }),
      // Alice: 1 person, 1 drop, 1 SOL at 150 usd.
      counted({
        xUserId: "1",
        people: ["c"],
        claimed: 10n ** 9n,
        priceUsd: 150,
        chainKey: "solana-devnet",
      }),
      // Dave: 2 people, no price, still first.
      counted({ xUserId: "4", people: ["d", "e"] }),
    ]);
    expect(chad.items.map((i) => i.profile.handle)).toEqual(["dave", "carol", "alice"]);
  });

  it("on a tie of people and usd, more drops, then the lower X id", () => {
    const { chad } = cards([
      counted({ xUserId: "2", people: ["a"] }),
      counted({ xUserId: "2", people: ["a"] }),
      counted({ xUserId: "3", people: ["b"] }),
      counted({ xUserId: "1", people: ["c"] }),
    ]);
    expect(chad.items.map((i) => i.profile.handle)).toEqual(["bob", "alice", "carol"]);
  });

  it("names the chain with the most people paid and its claimed amount", () => {
    const { chad } = cards([
      counted({ xUserId: "1", people: ["a"], claimed: 7n, chainKey: "robinhood-testnet" }),
      counted({ xUserId: "1", people: ["b", "c"], claimed: 9n, chainKey: "solana-devnet" }),
    ]);
    expect(chad.items[0]).toMatchObject({
      people: 3,
      chainKey: "solana-devnet",
      amount: 9n,
    });
  });

  it("on a tie of people between chains, Solana first", () => {
    const { chad } = cards([
      counted({ xUserId: "1", people: ["a"], claimed: 7n, chainKey: "robinhood-testnet" }),
      counted({ xUserId: "1", people: ["b"], claimed: 9n, chainKey: "solana-devnet" }),
    ]);
    expect(chad.items[0]?.chainKey).toBe("solana-devnet");
  });

  it("lastDropAt is the newest counted drop", () => {
    const { chad } = cards([
      counted({ xUserId: "1", people: ["a"], ago: 5 * HOUR }),
      counted({ xUserId: "1", people: ["b"], ago: 2 * HOUR }),
    ]);
    expect(chad.items[0]?.lastDropAt).toBe(SECONDS - 2 * HOUR);
  });
});

describe("top coin", () => {
  it("one item is one sender with one coin; the same coin from two senders is two items", () => {
    const { coin } = cards([
      counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, ago: 3 * HOUR }),
      counted({ xUserId: "2", people: ["b", "c"], mint: TOKEN_A, ago: 2 * HOUR }),
      counted({ xUserId: "2", people: ["c"], mint: TOKEN_A, ago: HOUR }),
      // Never a SOL or ETH drop.
      counted({ xUserId: "4", people: ["e", "f", "g"] }),
    ]);
    expect(coin.items.map((i) => [i.sender.handle, i.token.mint])).toEqual([
      ["bob", TOKEN_A],
      ["alice", TOKEN_A],
    ]);
    // People are X ids over that sender's drops: `c` twice is one person.
    expect(coin.items[0]).toMatchObject({ drops: 2, people: 2 });
    expect(coin.items[0]).not.toHaveProperty("firstSender");
    expect(coin.items[0]).not.toHaveProperty("moreSenders");
  });

  it("ranks by people, then the bigger amount in whole coins, then the first made", () => {
    // 5 coins of a 6 decimal token beat 4 coins of an 18 decimal one, though fewer base units.
    const five = counted({
      xUserId: "1",
      people: ["a"],
      mint: TOKEN_A,
      claimed: 5_000_000n,
      decimals: 6,
      ago: HOUR,
    });
    const four = counted({ xUserId: "2", people: ["b"], mint: TOKEN_B, claimed: 4n * 10n ** 18n });
    const wide = counted({ xUserId: "3", people: ["c", "d"], mint: TOKEN_B, claimed: 1n });
    expect(cards([four, five, wide]).coin.items.map((i) => i.sender.handle)).toEqual([
      "carol",
      "alice",
      "bob",
    ]);
    // A tie of people and amount: the item whose first drop was made first.
    const later = counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, ago: HOUR });
    const earlier = counted({ xUserId: "2", people: ["b"], mint: TOKEN_A, ago: 3 * HOUR });
    expect(cards([later, earlier]).coin.items.map((i) => i.sender.handle)).toEqual([
      "bob",
      "alice",
    ]);
  });

  it("the sender, its own newest drop and its own total", () => {
    const old = counted({ xUserId: "2", people: ["a"], mint: TOKEN_A, ago: 9 * HOUR });
    const newest = counted({ xUserId: "2", people: ["b"], mint: TOKEN_A, ago: HOUR });
    const other = counted({ xUserId: "1", people: ["c"], mint: TOKEN_A, ago: 30 * 60 });
    const { coin } = cards([other, newest, old]);
    expect(coin.items[0]?.sender.handle).toBe("bob");
    expect(coin.items[0]?.newestDrop).toBe(newest.address);
    expect(coin.items[0]?.total).toBe(10n);
    expect(coin.items[0]?.chainKey).toBe("robinhood-testnet");
  });

  it("total: what its drops in the range paid out, claimed never funded", () => {
    const { coin } = cards([
      counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, claimed: 300n }),
      counted({ xUserId: "1", people: ["b"], mint: TOKEN_A, claimed: 200n }),
      // Last week: not in today's total.
      counted({ xUserId: "1", people: ["c"], mint: TOKEN_A, claimed: 9_000n, ago: 3 * DAY }),
    ]);
    expect(coin.range).toBe("day");
    // Each drop funded 100: the claims count, never what was funded.
    expect(coin.items[0]?.total).toBe(500n);
  });

  it("the same address on two chains is two coins", () => {
    const { coin } = cards([
      counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, chainKey: "robinhood-testnet" }),
      counted({ xUserId: "1", people: ["b"], mint: TOKEN_A, chainKey: "robinhood" }),
    ]);
    expect(coin.items).toHaveLength(2);
  });
});

describe("top coin never counts a stablecoin", () => {
  const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
  const TUSDC = "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C";

  it("a quick token of its chain, by exact address, is never a top coin", () => {
    const usdc = counted({
      xUserId: "1",
      people: ["a", "b", "c"],
      mint: DEVNET_USDC,
      chainKey: "solana-devnet",
    });
    // The EVM address in another case is the same token.
    const tusdc = counted({ xUserId: "2", people: ["d", "e"], mint: TUSDC.toLowerCase() });
    const meme = counted({ xUserId: "3", people: ["f"], mint: TOKEN_A });
    const { coin } = cards([usdc, usdc, tusdc, tusdc, meme]);
    expect(coin.items.map((i) => i.token.mint)).toEqual([TOKEN_A]);
  });

  it("the same address on a chain where it is no quick token still counts", () => {
    const { coin } = cards([
      counted({ xUserId: "1", people: ["a"], mint: DEVNET_USDC, chainKey: "solana" }),
    ]);
    expect(coin.items).toHaveLength(1);
  });

  it("a token called USDC at another address counts like any coin", () => {
    const fake = {
      ...counted({ xUserId: "1", people: ["a"], mint: TOKEN_B }),
      token: { ...tokenOf(TOKEN_B, "USDC"), name: "USD Coin" },
    };
    expect(cards([fake]).coin.items.map((i) => i.token.mint)).toEqual([TOKEN_B]);
  });

  it("USD1 on solana mainnet is a stablecoin too, never a top coin", () => {
    const usd1 = counted({
      xUserId: "1",
      people: ["a", "b"],
      mint: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
      chainKey: "solana",
    });
    const meme = counted({ xUserId: "2", people: ["c"], mint: TOKEN_A });
    expect(cards([usd1, meme]).coin.items.map((i) => i.token.mint)).toEqual([TOKEN_A]);
  });

  it("a stablecoin drop alone leaves top coin empty", () => {
    const usdc = counted({
      xUserId: "1",
      people: ["a"],
      mint: DEVNET_USDC,
      chainKey: "solana-devnet",
      receivers: 40,
    });
    expect(cards([usdc]).coin).toEqual({ range: "day", items: [] });
  });
});

describe("just dropped", () => {
  const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

  it("any coin: SOL, ETH, a stablecoin and a token, the newest funding first, top 3", () => {
    const sol = funded({ xUserId: "1", fundedAgo: 4 * 60, chainKey: "solana-devnet" });
    const eth = funded({ xUserId: "2", fundedAgo: 3 * 60 });
    const usdc = funded({
      xUserId: "3",
      fundedAgo: 2 * 60,
      mint: DEVNET_USDC,
      chainKey: "solana-devnet",
    });
    const meme = funded({ xUserId: "4", fundedAgo: 60, mint: TOKEN_A });
    const { drop } = cards([], [sol, eth, usdc, meme]);
    expect(drop.items.map((i) => i.address)).toEqual([meme.address, usdc.address, eth.address]);
    expect(drop.items[0]?.token?.mint).toBe(TOKEN_A);
  });

  it("ranks by the funding time, not the creation time", () => {
    // Made first, funded last.
    const slow = funded({ xUserId: "1", fundedAgo: 60, ago: 5 * HOUR });
    const quick = funded({ xUserId: "2", fundedAgo: 10 * 60, ago: 11 * 60 });
    expect(cards([], [quick, slow]).drop.items.map((i) => i.address)).toEqual([
      slow.address,
      quick.address,
    ]);
  });

  it("on a tie of funding time, the newest creation, then the lower address", () => {
    const older = funded({ xUserId: "1", fundedAgo: 60, ago: 3 * HOUR });
    const newer = funded({ xUserId: "2", fundedAgo: 60, ago: HOUR });
    expect(cards([], [older, newer]).drop.items.map((i) => i.address)).toEqual([
      newer.address,
      older.address,
    ]);
    const high = funded({ xUserId: "1", fundedAgo: 60, ago: HOUR, address: addr(0xf2) });
    const low = funded({ xUserId: "2", fundedAgo: 60, ago: HOUR, address: addr(0xf1) });
    expect(cards([], [high, low]).drop.items.map((i) => i.address)).toEqual([
      low.address,
      high.address,
    ]);
  });

  it("no time window: a drop funded 30 days ago still shows", () => {
    const old = funded({ xUserId: "1", fundedAgo: 30 * DAY });
    expect(cards([], [old]).drop.items.map((i) => i.address)).toEqual([old.address]);
  });

  it("a sender with no profile counts nowhere", () => {
    const stranger = funded({ xUserId: "99", fundedAgo: 60 });
    const known = funded({ xUserId: "1", fundedAgo: 2 * 60 });
    expect(cards([], [stranger, known]).drop.items.map((i) => i.address)).toEqual([known.address]);
  });

  it("an item: the sender, receivers, the full total, the unit and fundedAt; no claims", () => {
    const one = funded({ xUserId: "2", fundedAgo: 2 * 60, receivers: 40, total: 7n * 10n ** 18n });
    const { drop } = cards([], [one]);
    expect(drop.items[0]).toEqual({
      address: one.address,
      chainKey: "robinhood-testnet",
      sender: byId.get("2"),
      receivers: 40,
      total: 7n * 10n ** 18n,
      token: null,
      fundedAt: SECONDS - 2 * 60,
    });
    expect(drop).not.toHaveProperty("range");
  });

  it("claimed drops alone never fill it", () => {
    const { drop } = cards([counted({ xUserId: "1", people: ["a"] })]);
    expect(drop).toEqual({ items: [] });
  });
});

describe("the ranges and the shared rules", () => {
  it("keeps 3 items per card at most", () => {
    const list = ["1", "2", "3", "4"].map((x) => counted({ xUserId: x, people: [x] }));
    const fundedList = ["1", "2", "3", "4"].map((x) => funded({ xUserId: x, fundedAgo: 60 }));
    const result = cards(list, fundedList);
    expect(result.chad.items).toHaveLength(3);
    expect(result.drop.items).toHaveLength(3);
  });

  it("top coin keeps up to 3 coins, best first, like the other cards", () => {
    const mints = ["a1", "a2", "a3", "a4"].map((m) => `0x${m.padStart(40, "0")}`);
    const list = mints.flatMap((mint, i) =>
      Array.from({ length: 4 - i }, (_, n) =>
        counted({ xUserId: "1", people: [`${String(i)}-${String(n)}`], mint }),
      ),
    );
    expect(cards(list).coin.items.map((i) => i.token.mint)).toEqual(mints.slice(0, 3));
  });

  it("no card falls back to the week", () => {
    const result = cards([
      counted({ xUserId: "1", people: ["a"], ago: HOUR }),
      counted({ xUserId: "2", people: ["b"], mint: TOKEN_A, ago: 3 * DAY }),
    ]);
    expect(result.chad.range).toBe("day");
    // The last 24 hours have no token drop: the coin card is empty, never the week.
    expect(result.coin).toEqual({ range: "day", items: [] });
  });

  it("a card with something today never mixes in the week", () => {
    const result = cards([
      counted({ xUserId: "1", people: ["a"], ago: HOUR, receivers: 2 }),
      counted({ xUserId: "2", people: ["b"], ago: 3 * DAY, receivers: 50 }),
    ]);
    expect(result.chad.range).toBe("day");
    expect(result.chad.items.map((i) => i.profile.handle)).toEqual(["alice"]);
  });

  it("the day is the last 24 hours, rolling, by creation time", () => {
    const old = cards([counted({ xUserId: "1", people: ["a"], ago: DAY + 1 })]);
    for (const card of [old.chad, old.coin]) {
      expect(card).toEqual({ range: "day", items: [] });
    }
    expect(cards([counted({ xUserId: "1", people: ["a"], ago: DAY })]).chad.items).toHaveLength(1);
  });

  it("nothing in the last 24 hours: the day range and no items", () => {
    const result = cards([]);
    for (const card of [result.chad, result.coin]) {
      expect(card).toEqual({ range: "day", items: [] });
    }
    expect(result.drop).toEqual({ items: [] });
  });

  it("a drop with no final claim, or a sender with no profile, counts nowhere", () => {
    const unclaimed = { ...counted({ xUserId: "1", people: [], receivers: 40 }), claimCount: 0 };
    const stranger = counted({ xUserId: "99", people: ["a"], receivers: 30, mint: TOKEN_A });
    const result = cards([unclaimed, stranger]);
    expect(result.chad.items).toEqual([]);
    expect(result.coin.items).toEqual([]);
    expect(result.drop.items).toEqual([]);
  });

  it("trendingJson sends amounts as decimal strings", () => {
    const json = trendingJson(
      cards(
        [counted({ xUserId: "1", people: ["a"], claimed: 12n, receivers: 2 })],
        [funded({ xUserId: "1", fundedAgo: 60, total: 100n })],
      ),
    );
    expect(json.chad.items[0]?.amount).toBe("12");
    expect(json.drop.items[0]?.total).toBe("100");
    const coins = trendingJson(
      cards([counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, claimed: 12n })]),
    );
    expect(coins.coin.items[0]?.total).toBe("12");
  });
});

describe("top coin, the newest coin drop", () => {
  it("the newest counted token drop ever, by creation time, one drop as one item", () => {
    const older = counted({ xUserId: "1", people: ["a", "b"], mint: TOKEN_A, ago: 5 * DAY });
    const newest = counted({
      xUserId: "2",
      people: ["c", "d", "e"],
      mint: TOKEN_B,
      ago: 3 * DAY,
      claimed: 7n,
    });
    const sameCoinOlder = counted({ xUserId: "2", people: ["f"], mint: TOKEN_B, ago: 4 * DAY });
    expect(newestCoin([older, sameCoinOlder, newest], byId)).toEqual({
      token: newest.token,
      chainKey: "robinhood-testnet",
      // That drop only, never the sender's other drops of the coin.
      drops: 1,
      people: 3,
      sender: byId.get("2"),
      newestDrop: newest.address,
      total: 7n,
      createdAt: SECONDS - 3 * DAY,
    });
  });

  it("the card's rules: never a SOL or ETH drop, a stablecoin, no claim or no profile", () => {
    // tUSDC, a quick token of the testnet.
    const TUSDC = "0x61cb4e7be9a366fda2d4c528b817cc426a039c3c";
    const ok = counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, ago: 9 * DAY });
    const native = counted({ xUserId: "1", people: ["a"], ago: 2 * DAY });
    const stable = counted({ xUserId: "1", people: ["a"], mint: TUSDC, ago: 2 * DAY });
    const unclaimed = {
      ...counted({ xUserId: "1", people: [], mint: TOKEN_A, ago: 2 * DAY }),
      claimCount: 0,
    };
    const stranger = counted({ xUserId: "99", people: ["a"], mint: TOKEN_A, ago: 2 * DAY });
    expect(newestCoin([ok, native, stable, unclaimed, stranger], byId)?.newestDrop).toBe(
      ok.address,
    );
    expect(newestCoin([native, stable, unclaimed, stranger], byId)).toBeNull();
    expect(newestCoin([], byId)).toBeNull();
  });

  it("on a tie of creation time, the lower address", () => {
    const a = counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, ago: 2 * DAY });
    const b = counted({ xUserId: "2", people: ["b"], mint: TOKEN_B, ago: 2 * DAY });
    const [low, high] = [a, b].sort((x, y) => (x.address < y.address ? -1 : 1));
    expect(newestCoin([high as CountedDrop, low as CountedDrop], byId)?.newestDrop).toBe(
      low?.address,
    );
  });

  it("the 24 hour cards never set it; trendingJson sends null, or the total as a string", () => {
    const today = cards([counted({ xUserId: "1", people: ["a"], mint: TOKEN_A })]);
    expect(trendingJson(today).coin.newest).toBeNull();
    expect(trendingJson(cards([])).coin).toEqual({ range: "day", items: [], newest: null });
    const old = counted({ xUserId: "1", people: ["a"], mint: TOKEN_A, ago: 3 * DAY, claimed: 12n });
    const json = trendingJson({
      ...cards([]),
      coin: { range: "day", items: [], newest: newestCoin([old], byId) },
    });
    expect(json.coin.newest?.total).toBe("12");
    expect(json.coin.newest?.createdAt).toBe(SECONDS - 3 * DAY);
  });
});

// -------------------------------------------------------------------------------------------
// the route
// -------------------------------------------------------------------------------------------

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

interface Seed {
  readonly n: number;
  readonly xUserId: string;
  readonly asset: string;
  readonly mode?: "handle" | "address";
  readonly ago: number;
  readonly leafCount: number;
  /** The X ids of the claimed leaves, leaf 0 upwards. */
  readonly paid: string[];
  readonly total: string;
  readonly claimed: string;
  /** The usd price frozen at activation, if any. */
  readonly price?: string;
  /** Our worker's state; `finished` unless given. */
  readonly state?: string;
  /** Seconds since the chain's funding time; a minute after creation unless given, `null` none. */
  readonly fundedAgo?: number | null;
  /** The indexer's status finality, `final` unless given. */
  readonly statusFinality?: "seen" | "final";
  readonly verified?: boolean;
  /** The commitment the chain names, ours unless given. */
  readonly chainCommitment?: string;
  /** A Solana drop: its chain key and address. */
  readonly chainKey?: string;
  readonly address?: string;
}

const seedAddress = (s: Seed) => s.address ?? addr(0x100 + s.n);
const fundedAt = (s: Seed) => (s.fundedAgo === null ? null : SECONDS - (s.fundedAgo ?? s.ago - 60));

/**
 * The day: alice a coin drop to 3, 2 paid, priced; bob a coin drop to 5, 1 paid, and a token A drop
 * to 2, both paid; carol a multisend to 50, all paid (never counts); dave a coin drop to 10,
 * nobody paid (never counts). The week: carol a token A drop to 4, 1 paid.
 */
const SEEDS: Seed[] = [
  {
    n: 1,
    xUserId: "1",
    asset: NATIVE,
    ago: HOUR,
    leafCount: 3,
    paid: ["91", "92"],
    total: "3000",
    claimed: "2000",
    price: "1000",
  },
  {
    n: 2,
    xUserId: "2",
    asset: NATIVE,
    ago: 2 * HOUR,
    leafCount: 5,
    paid: ["93"],
    total: "5000",
    claimed: "1000",
  },
  {
    n: 3,
    xUserId: "2",
    asset: TOKEN_A,
    ago: 3 * HOUR,
    leafCount: 2,
    paid: ["94", "95"],
    total: "20",
    claimed: "20",
  },
  {
    n: 4,
    xUserId: "3",
    asset: NATIVE,
    mode: "address",
    ago: HOUR,
    leafCount: 50,
    paid: Array.from({ length: 50 }, (_, i) => String(200 + i)),
    total: "50",
    claimed: "50",
  },
  {
    n: 5,
    xUserId: "4",
    asset: NATIVE,
    ago: HOUR,
    leafCount: 10,
    paid: [],
    total: "10",
    claimed: "0",
  },
  {
    n: 6,
    xUserId: "3",
    asset: TOKEN_A,
    ago: 3 * DAY,
    leafCount: 4,
    paid: ["96"],
    total: "40",
    claimed: "10",
  },
];

const indexed = (seeds: readonly Seed[]) =>
  seeds.map((s) => ({
    address: addr(0x100 + s.n),
    creatorCommitment: commitment(s.n),
    createdAt: String(SECONDS - s.ago),
    claimedFinalWei: s.claimed,
    claimedCountFinal: s.paid.length,
    recipients: s.paid.map((_, i) => addr(0xe000 + i)),
    claimedIndexes: s.paid.map((_, i) => i),
  }));

/** What the indexer's `getDrop` answers per EVM drop: its funding time and finality. */
const chainSide = (seeds: readonly Seed[]) =>
  Object.fromEntries(
    seeds
      .filter((s) => s.chainKey === undefined)
      .map((s) => [
        addr(0x100 + s.n),
        {
          address: addr(0x100 + s.n),
          status: fundedAt(s) === null ? "Created" : "Active",
          creatorCommitment: s.chainCommitment ?? commitment(s.n),
          activatedAt: fundedAt(s) === null ? null : String(fundedAt(s)),
          createdAt: String(SECONDS - s.ago),
          verified: s.verified ?? true,
          finality: "final",
          statusFinality: s.statusFinality ?? "final",
        },
      ]),
  );

async function seed(h: Harness, seeds: readonly Seed[]): Promise<void> {
  const db = h.deps.db;
  await db.insert(profiles).values(
    ["alice", "bob", "carol", "dave"].map((handle, i) => ({
      xUserId: String(i + 1),
      handle,
      displayName: handle.toUpperCase(),
      profileImageUrl: null,
    })),
  );
  await db.insert(drops).values(
    seeds.map((s) => {
      const token = s.asset !== NATIVE;
      return {
        address: seedAddress(s),
        mode: s.mode ?? ("handle" as const),
        priceUsd: s.price ?? null,
        pricedAt: s.price === undefined ? null : NOW,
        chainId: s.chainKey === undefined ? 46630 : 103,
        chainKey: s.chainKey ?? "robinhood-testnet",
        xUserId: s.xUserId,
        nonce: BigInt(s.n),
        creatorCommitment: commitment(s.n),
        salt: `0x${"22".repeat(32)}`,
        asset: s.asset,
        tokenProgram: token ? "erc20" : null,
        tokenDecimals: token ? 18 : null,
        tokenName: token ? "Token A" : null,
        tokenSymbol: token ? "AAA" : null,
        merkleRoot: `0x${"33".repeat(32)}`,
        manifestHash: `0x${"44".repeat(32)}`,
        manifestJson: "{}",
        totalEntitlements: s.total,
        feeAmount: "0",
        grossRequired: s.total,
        leafCount: s.leafCount,
        refundRecipient: "0x000000000000000000000000000000000000dEaD",
        fundingDeadline: 1_800_000_000n,
        claimPeriod: 2_592_000,
        state: s.state ?? "finished",
        paidCount: s.paid.length,
        createTxHash: `0x${"55".repeat(32)}`,
        createdAt: new Date((SECONDS - s.ago) * 1000),
      };
    }),
  );
  const leaves = seeds
    .filter((s) => (s.mode ?? "handle") === "handle")
    .flatMap((s) =>
      Array.from({ length: s.leafCount }, (_, leafIndex) => ({
        dropAddress: seedAddress(s),
        leafIndex,
        xUserId: s.paid[leafIndex] ?? `unpaid-${String(s.n)}-${String(leafIndex)}`,
        amount: "1",
      })),
    );
  await db.insert(dropHandleLeaves).values(leaves);
}

interface Card<T> {
  range: "day";
  items: T[];
}
interface Body {
  chain: string;
  finality: string;
  available: boolean;
  chad: Card<{
    profile: { handle: string };
    people: number;
    drops: number;
    lastDropAt: number;
    chainKey: string;
    amount: string;
  }>;
  coin: Card<{
    token: { mint: string; symbol: string | null };
    chainKey: string;
    drops: number;
    people: number;
    sender: { handle: string };
    newestDrop: string;
    total: string;
  }> & {
    newest: {
      token: { mint: string };
      chainKey: string;
      drops: number;
      people: number;
      sender: { handle: string };
      newestDrop: string;
      total: string;
      createdAt: number;
    } | null;
  };
  drop: {
    items: {
      address: string;
      chainKey: string;
      sender: { handle: string };
      receivers: number;
      total: string;
      token: { mint: string } | null;
      fundedAt: number;
    }[];
  };
}

async function world(seeds: readonly Seed[] = SEEDS): Promise<Harness> {
  const h = await createHarness({
    indexer: { boardDrops: indexed(seeds), dropsByAddress: chainSide(seeds) },
  });
  h.setNow(NOW);
  await seed(h, seeds);
  harness = h;
  return h;
}

async function trending(h: Harness, query = "?chain=all"): Promise<Body> {
  const response = await h.app.request(`/api/trending${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Body;
}

describe("GET /api/trending", () => {
  it("answers final rows for the chain asked", async () => {
    const body = await trending(await world());
    expect(body).toMatchObject({ chain: "all", finality: "final", available: true });
  });

  it("chad of the day: people paid, handle drops only, a multisend and an unclaimed drop never", async () => {
    const { chad } = await trending(await world());
    expect(chad.range).toBe("day");
    expect(chad.items.map((i) => i.profile.handle)).toEqual(["alice", "bob"]);
    expect(chad.items[0]).toMatchObject({
      people: 2,
      drops: 1,
      lastDropAt: SECONDS - HOUR,
      chainKey: "robinhood-testnet",
      amount: "2000",
    });
  });

  it("top coin: today's token drops only, the newest drop for the link", async () => {
    const { coin } = await trending(await world());
    expect(coin.range).toBe("day");
    expect(coin.items).toHaveLength(1);
    expect(coin.items[0]).toMatchObject({
      token: { mint: TOKEN_A, symbol: "AAA" },
      chainKey: "robinhood-testnet",
      drops: 1,
      people: 2,
      sender: { handle: "bob" },
      total: "20",
    });
    expect(coin.items[0]?.newestDrop.toLowerCase()).toBe(addr(0x103));
  });

  it("just dropped: the newest funding first, an unclaimed drop too, a multisend never", async () => {
    const { drop } = await trending(await world());
    expect(drop).not.toHaveProperty("range");
    // Alice and dave were funded at the same time and made at the same time: the lower address.
    // Dave's drop has no claim and still shows; carol's multisend never does.
    expect(drop.items.map((i) => i.address.toLowerCase())).toEqual([
      addr(0x101),
      addr(0x105),
      addr(0x102),
    ]);
    expect(drop.items[0]).toEqual({
      address: addr(0x101),
      chainKey: "robinhood-testnet",
      sender: expect.objectContaining({ handle: "alice" }) as unknown,
      receivers: 3,
      total: "3000",
      token: null,
      fundedAt: SECONDS - HOUR + 60,
    });
  });

  it("just dropped: a token drop and a drop older than 24 hours still show", async () => {
    const { drop } = await trending(await world(SEEDS.filter((s) => s.n === 3 || s.n === 6)));
    expect(drop.items.map((i) => i.address.toLowerCase())).toEqual([addr(0x103), addr(0x106)]);
    expect(drop.items[0]?.token?.mint).toBe(TOKEN_A);
  });

  it("just dropped: never a drop still waiting for money", async () => {
    const base = { xUserId: "1", asset: NATIVE, leafCount: 1, paid: [], total: "1", claimed: "0" };
    const { drop } = await trending(
      await world([
        // The worker never saw funding.
        { ...base, n: 1, ago: 60, state: "created", fundedAgo: null },
        // The worker saw the money, the chain has no funding time yet.
        { ...base, n: 2, ago: 60, state: "funded", fundedAgo: null },
        // Nobody funded it in time.
        { ...base, n: 3, ago: 60, state: "funding_expired", fundedAgo: null },
        // Funded, live.
        { ...base, n: 4, ago: 2 * HOUR, state: "active" },
      ]),
    );
    expect(drop.items.map((i) => i.address.toLowerCase())).toEqual([addr(0x104)]);
  });

  it("just dropped: the worker's state decides what is read, a created row is never read", async () => {
    const base = { xUserId: "1", asset: NATIVE, leafCount: 1, paid: [], total: "1", claimed: "0" };
    // The chain says funded, our row still says created: not read, not shown.
    const { drop } = await trending(await world([{ ...base, n: 1, ago: 60, state: "created" }]));
    expect(drop).toEqual({ items: [] });
  });

  it("just dropped: final only, a verified clone with our commitment only", async () => {
    const base = { xUserId: "1", asset: NATIVE, leafCount: 1, paid: [], total: "1", claimed: "0" };
    const { drop } = await trending(
      await world([
        { ...base, n: 1, ago: 60, statusFinality: "seen" },
        { ...base, n: 2, ago: 60, verified: false },
        { ...base, n: 3, ago: 60, chainCommitment: commitment(99) },
        { ...base, n: 4, ago: 2 * HOUR },
      ]),
    );
    expect(drop.items.map((i) => i.address.toLowerCase())).toEqual([addr(0x104)]);
  });

  it("just dropped: only the newest 20 drops by creation are read", async () => {
    const base = { xUserId: "1", asset: NATIVE, leafCount: 1, paid: [], total: "1", claimed: "0" };
    const seeds: Seed[] = Array.from({ length: 21 }, (_, i) => ({
      ...base,
      n: i + 1,
      ago: (i + 2) * HOUR,
    }));
    // The oldest made, funded last: the 21st by creation, so never read.
    const late = { ...seeds[20], fundedAgo: 30 } as Seed;
    const { drop } = await trending(await world([...seeds.slice(0, 20), late]));
    expect(drop.items.map((i) => i.address.toLowerCase())).toEqual([
      addr(0x101),
      addr(0x102),
      addr(0x103),
    ]);
  });

  it("just dropped: no funded drop at all, no items", async () => {
    const { drop } = await trending(await world(SEEDS.map((s) => ({ ...s, fundedAgo: null }))));
    expect(drop).toEqual({ items: [] });
  });

  it("a drop older than 24 hours counts on no 24 hour card, no week fall back", async () => {
    const body = await trending(await world(SEEDS.filter((s) => s.n === 6)));
    expect(body.chad).toEqual({ range: "day", items: [] });
    expect(body.coin.range).toBe("day");
    expect(body.coin.items).toEqual([]);
  });

  it("top coin, nothing today: newest is the newest token drop ever", async () => {
    const body = await trending(await world(SEEDS.filter((s) => s.n === 6)));
    expect(body.coin.newest).toMatchObject({
      token: { mint: TOKEN_A },
      chainKey: "robinhood-testnet",
      drops: 1,
      people: 1,
      sender: { handle: "carol" },
      total: "10",
      createdAt: SECONDS - 3 * DAY,
    });
    expect(body.coin.newest?.newestDrop.toLowerCase()).toBe(addr(0x106));
  });

  it("top coin with an item today: newest is null, the card as before", async () => {
    const { coin } = await trending(await world());
    expect(coin.items).toHaveLength(1);
    expect(coin.newest).toBeNull();
  });

  it("top coin, no counted token drop ever: newest is null", async () => {
    const { coin } = await trending(await world(SEEDS.filter((s) => s.asset === NATIVE)));
    expect(coin).toEqual({ range: "day", items: [], newest: null });
  });

  it("the Telegram read never reads newest", async () => {
    const h = await world(SEEDS.filter((s) => s.n === 6));
    const cards = await readTrending(
      {
        db: h.deps.db,
        indexer: h.deps.indexer,
        now: h.deps.now,
        indexerChainKey: h.deps.config.CHAIN_KEY,
      },
      ALL,
    );
    expect(cards.coin.items).toEqual([]);
    expect(cards.coin.newest ?? null).toBeNull();
  });

  it("an unknown chain is 400 invalid_query", async () => {
    const response = await (await world()).app.request("/api/trending?chain=nope");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
  });

  it("the indexer down is 503 indexer_unavailable", async () => {
    const h = await createHarness({ indexer: { down: true } });
    harness = h;
    const response = await h.app.request("/api/trending?chain=all");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "indexer_unavailable" });
  });

  it("a Solana read that fails is 200, available false, empty cards", async () => {
    const failing = {
      chainKey: "solana-devnet",
      chainId: 0,
      boardDrops: () => Promise.reject(new Error("getMultipleAccounts: http 429")),
    } as unknown as SvmReader;
    const h = await createHarness({ indexer: { boardDrops: [] }, solanaReader: failing });
    harness = h;
    const body = await trending(h);
    expect(body.available).toBe(false);
    for (const card of [body.chad, body.coin, body.drop]) expect(card.items).toEqual([]);
  });

  const SOL_FUNDED = "So1Funded1111111111111111111111111111111111";
  const SOL_WAITING = "So1Waiting111111111111111111111111111111111";
  const solanaSeeds: Seed[] = [
    {
      n: 7,
      xUserId: "2",
      asset: NATIVE,
      ago: 10 * 60,
      leafCount: 2,
      paid: [],
      total: "5",
      claimed: "0",
    },
    {
      n: 8,
      xUserId: "3",
      asset: NATIVE,
      ago: 60,
      leafCount: 1,
      paid: [],
      total: "1",
      claimed: "0",
    },
  ].map((s, i) => ({
    ...s,
    chainKey: "solana-devnet",
    address: i === 0 ? SOL_FUNDED : SOL_WAITING,
    state: "active",
  }));

  it("just dropped: a Solana drop read at finalized, a funding time only", async () => {
    const commitments: string[] = [];
    const reader = {
      chainKey: "solana-devnet",
      chainId: 103,
      boardDrops: () => Promise.resolve([]),
      indexedDrops: (rows: readonly { address: string }[], level: string) => {
        commitments.push(level);
        return Promise.resolve(
          rows.map(
            (row) =>
              ({
                address: row.address,
                chainKey: "solana-devnet",
                creatorCommitment: commitment(row.address === SOL_FUNDED ? 7 : 8),
                activatedAt: row.address === SOL_FUNDED ? String(SECONDS - 5 * 60) : null,
                createdAt: String(SECONDS - 10 * 60),
                verified: true,
                finality: "final",
                statusFinality: "final",
              }) as unknown as SvmIndexedDrop,
          ),
        );
      },
    } as unknown as SvmReader;
    const h = await createHarness({ indexer: { boardDrops: [] }, solanaReader: reader });
    h.setNow(NOW);
    harness = h;
    await seed(h, solanaSeeds);
    const { drop } = await trending(h);
    expect(commitments).toEqual(["finalized"]);
    expect(drop.items).toEqual([
      expect.objectContaining({
        address: SOL_FUNDED,
        chainKey: "solana-devnet",
        receivers: 2,
        total: "5",
        fundedAt: SECONDS - 5 * 60,
      }),
    ]);
  });

  it("just dropped: a Solana funding read that fails is 200, available false, empty cards", async () => {
    const reader = {
      chainKey: "solana-devnet",
      chainId: 103,
      boardDrops: () => Promise.resolve([]),
      indexedDrops: () => Promise.reject(new Error("getMultipleAccounts: http 429")),
    } as unknown as SvmReader;
    const h = await createHarness({ indexer: { boardDrops: [] }, solanaReader: reader });
    h.setNow(NOW);
    harness = h;
    await seed(h, solanaSeeds);
    const body = await trending(h);
    expect(body.available).toBe(false);
    for (const card of [body.chad, body.coin, body.drop]) expect(card.items).toEqual([]);
  });
});
