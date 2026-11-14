/**
 * The boards
 * - pages of 10: `page`, `pageSize` and `total` in the answer, no cut at 50, the rank counts
 *   across pages, a page past the end is the last page, a bad `page` is `400 invalid_query`
 * - the usd board `dropper`: SOL and ETH at the frozen price, plus the stablecoin quick tokens
 *   `USDC`, `USDT` and `USDG`, and `tUSDC` on robinhood testnet, by exact address on
 *   that chain at 1 usd per whole token; never another token, never into a coin amount,
 *   `tokens: 0` and `topToken: null`
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assetScopeFor,
  rankBoard,
  totalsByChad,
  type BoardProfile,
  type CountedDrop,
} from "../src/boards/compute.js";
import { chainFilter, type ChainFilter } from "../src/chain/filter.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import type { TokenInfo } from "../src/drops/token-info.js";
import { createHarness, type Harness } from "./harness.js";

/** The quick tokens of `packages/chains`. */
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAINNET_USD1 = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";
const TESTNET_USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const TESTNET_TUSDC = "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C";
const OTHER_TOKEN = "0x00000000000000000000000000000000000000a1";

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

const token = (mint: string, symbol: string | null, decimals: number): TokenInfo => ({
  mint,
  symbol,
  name: symbol,
  decimals,
  tokenProgram: "program",
  logoUrl: `/api/tokens/${mint}/logo?chain=solana`,
  launchpad: null,
  xUrl: null,
});

const drop = (
  address: string,
  chainKey: string,
  people: string[],
  claimed: bigint,
  asset: { mint: string; symbol: string | null; decimals: number } | null,
  priceUsd: number | null = null,
): CountedDrop => ({
  address,
  chainKey,
  xUserId: "1",
  createdAt: 1_800_000_000,
  claimed,
  claimCount: people.length,
  people,
  priceUsd,
  mint: asset?.mint ?? null,
  token: asset === null ? null : token(asset.mint, asset.symbol, asset.decimals),
});

const ALL = chainFilter("all") as ChainFilter;
const options = {
  filter: ALL,
  evmChainKeys: new Set(["robinhood-testnet"]),
  assets: assetScopeFor("dropper"),
};
const byId = new Map([["1", profile("1", "alice")]]);

describe("the usd board counts the stablecoins at 1 usd", () => {
  it("SOL at its frozen price plus devnet USDC at 1 usd per whole token", () => {
    const [row] = totalsByChad(
      [
        drop("a1", "solana-devnet", ["10"], 2_000_000_000n, null, 100),
        drop("a2", "solana-devnet", ["11", "12"], 250_000_000n, {
          mint: DEVNET_USDC,
          symbol: null,
          decimals: 6,
        }),
      ],
      byId,
      options,
    );
    // 2 SOL at 100 = 200, plus 250 USDC = 250.
    expect(row?.usd).toBe(450);
    // The stablecoin drop counts as a drop, with its people and its payouts.
    expect(row?.dropCount).toBe(2);
    expect(row?.uniqueReceivers).toBe(3);
    expect(row?.claimCount).toBe(3);
    // A token amount is never added to a coin.
    const devnet = row?.byChain.find((chain) => chain.chainKey === "solana-devnet");
    expect(devnet?.total).toBe(2_000_000_000n);
    expect(devnet?.biggestDrop).toBe(2_000_000_000n);
    expect(devnet?.usd).toBe(450);
    expect(row?.tokens).toBe(0);
    expect(row?.topToken).toBeNull();
  });

  it("USDG on robinhood testnet, matched by its exact address in any case", () => {
    const [row] = totalsByChad(
      [
        drop("b1", "robinhood-testnet", ["10"], 12_500_000n, {
          mint: TESTNET_USDG.toLowerCase(),
          symbol: "USDG",
          decimals: 6,
        }),
      ],
      byId,
      options,
    );
    expect(row?.usd).toBe(12.5);
    expect(row?.totalWei).toBe(0n);
  });

  it("tUSDC on robinhood testnet stands in for USDC there: 1 usd", () => {
    const [row] = totalsByChad(
      [
        drop("t1", "robinhood-testnet", ["10"], 40_000_000n, {
          mint: TESTNET_TUSDC,
          symbol: "tUSDC",
          decimals: 6,
        }),
      ],
      byId,
      options,
    );
    expect(row?.usd).toBe(40);
    expect(row?.totalWei).toBe(0n);
  });

  it("USD1 on solana mainnet at 1 usd per whole token", () => {
    const [row] = totalsByChad(
      [
        drop("u1", "solana", ["10"], 30_000_000n, {
          mint: MAINNET_USD1,
          symbol: "USD1",
          decimals: 6,
        }),
      ],
      byId,
      options,
    );
    expect(row?.usd).toBe(30);
    expect(row?.totalWei).toBe(0n);
  });

  it("never another token: a token that calls itself USDC, a quick address on another chain", () => {
    const rows = totalsByChad(
      [
        drop("c2", "robinhood-testnet", ["11"], 5_000_000n, {
          mint: OTHER_TOKEN,
          symbol: "USDC",
          decimals: 6,
        }),
        drop("c3", "solana-devnet", ["12"], 5_000_000n, {
          mint: MAINNET_USDC,
          symbol: "USDC",
          decimals: 6,
        }),
      ],
      byId,
      options,
    );
    // None of them counts: no usd, no drop, no row.
    expect(rows).toEqual([]);
  });

  it("best dropchad still counts SOL and ETH only, the stablecoin drop is not there", () => {
    const [row] = totalsByChad(
      [
        drop("d1", "solana-devnet", ["10"], 1_000_000_000n, null, 100),
        drop("d2", "solana-devnet", ["11", "12"], 9_000_000n, {
          mint: DEVNET_USDC,
          symbol: null,
          decimals: 6,
        }),
      ],
      byId,
      { ...options, assets: assetScopeFor("fed") },
    );
    expect(row?.usd).toBe(100);
    expect(row?.dropCount).toBe(1);
    expect(row?.uniqueReceivers).toBe(1);
  });

  it("ranks by that usd", () => {
    const two = new Map([
      ["1", profile("1", "alice")],
      ["2", profile("2", "bob")],
    ]);
    const rows = rankBoard(
      totalsByChad(
        [
          drop("e1", "solana-devnet", ["10", "11", "12"], 100_000_000n, null, 100),
          {
            ...drop("e2", "solana-devnet", ["13"], 50_000_000n, {
              mint: DEVNET_USDC,
              symbol: null,
              decimals: 6,
            }),
            xUserId: "2",
          },
        ],
        two,
        options,
      ),
      "all",
      "usd",
    );
    // alice 0.1 SOL at 100 = 10 usd for 3 people; bob 50 USDC for 1 person.
    expect(rows.map((row) => [row.profile.handle, row.usd, row.rank])).toEqual([
      ["bob", 50, 1],
      ["alice", 10, 2],
    ]);
  });
});

// -------------------------------------------------------------------------------------------
// the route
// -------------------------------------------------------------------------------------------

let harness: Harness;

const NOW = new Date("2026-09-12T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const DAY = 24 * 60 * 60;
const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

/** One of our `drops` rows: a handle drop on robinhood testnet. */
const row = (n: number, xUserId: string, asset = "0x0000000000000000000000000000000000000000") => ({
  address: addr(n),
  mode: "handle" as const,
  priceUsd: "2000",
  pricedAt: new Date(NOW.getTime() - DAY * 1000),
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId,
  nonce: BigInt(n),
  creatorCommitment: commitment(n),
  salt: `0x${"22".repeat(32)}`,
  asset,
  merkleRoot: `0x${"33".repeat(32)}`,
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: "{}",
  totalEntitlements: "1000000000000000",
  feeAmount: "0",
  grossRequired: "1000000000000000",
  leafCount: 1,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: 1_800_000_000n,
  claimPeriod: 2_592_000,
  state: "finished",
  paidCount: 1,
  createTxHash: `0x${"55".repeat(32)}`,
  title: `drop ${String(n)}`,
  createdAt: new Date(NOW.getTime() - DAY * 1000),
  ...(asset === "0x0000000000000000000000000000000000000000"
    ? {}
    : { tokenProgram: "erc20", tokenDecimals: 6, tokenSymbol: "USDG", tokenName: "Global Dollar" }),
});

/**
 * `count` chads, one drop each, made yesterday. Chad `n` pays `count + 1 - n` people, so the
 * order on every people board is chad 1, chad 2, … and the rank is the chad's number.
 */
function chads(count: number) {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const people = (n: number) => count + 1 - n;
  const indexed = numbers.map((n) => ({
    address: addr(0x1000 + n),
    creatorCommitment: commitment(0x1000 + n),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "1000000000000000",
    claimedCountFinal: people(n),
    recipients: Array.from({ length: people(n) }, (_, i) => addr(0x9000 + i)),
    claimedIndexes: Array.from({ length: people(n) }, (_, i) => i),
  }));
  async function seed(): Promise<void> {
    const db = harness.deps.db;
    await db.insert(profiles).values(
      numbers.map((n) => ({
        xUserId: String(n),
        handle: `chad${String(n)}`,
        displayName: `chad ${String(n)}`,
        profileImageUrl: null,
      })),
    );
    await db.insert(drops).values(numbers.map((n) => row(0x1000 + n, String(n))));
    await db.insert(dropHandleLeaves).values(
      numbers.flatMap((n) =>
        Array.from({ length: people(n) }, (_, leafIndex) => ({
          dropAddress: addr(0x1000 + n),
          leafIndex,
          xUserId: `${String(n)}-${String(leafIndex)}`,
          amount: "1",
        })),
      ),
    );
  }
  return { indexed, seed };
}

interface PageBody {
  board: string;
  rankedBy: string;
  page: number;
  pageSize: number;
  total: number;
  rows: { rank: number; usd: number; profile: { handle: string } }[];
}

async function board(query: string): Promise<PageBody> {
  const response = await harness.app.request(`/api/boards${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as PageBody;
}

describe("GET /api/boards pages of 10", () => {
  const set = chads(23);
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: set.indexed } });
    harness.setNow(NOW);
    await set.seed();
  });
  afterEach(() => harness.close());

  it("page 1 is the default: 10 rows, ranks 1 to 10, and the total", async () => {
    const body = await board("?range=all");
    expect(body).toMatchObject({ page: 1, pageSize: 10, total: 23 });
    expect(body.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.rows[0]?.profile.handle).toBe("chad1");
  });

  it("the rank keeps counting: page 2 is 11 to 20, page 3 is 21 to 23", async () => {
    const two = await board("?range=all&page=2");
    expect(two).toMatchObject({ page: 2, pageSize: 10, total: 23 });
    expect(two.rows.map((r) => r.rank)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(two.rows[0]?.profile.handle).toBe("chad11");
    const three = await board("?range=all&page=3");
    expect(three.rows.map((r) => r.rank)).toEqual([21, 22, 23]);
  });

  it("a page past the end answers the last page, never an empty one", async () => {
    const body = await board("?range=all&page=9");
    expect(body.page).toBe(3);
    expect(body.rows.map((r) => r.rank)).toEqual([21, 22, 23]);
  });

  it("a page that is not a whole number from 1 is 400 invalid_query", async () => {
    for (const page of ["0", "-1", "abc", "1.5", ""]) {
      const response = await harness.app.request(`/api/boards?range=all&page=${page}`);
      expect(response.status, page).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_query" });
    }
  });

  it("every board and every range has pages", async () => {
    for (const range of ["day", "week", "all"]) {
      for (const type of ["fed", "dropper", "project"]) {
        const body = await board(`?range=${range}&board=${type}&page=2`);
        expect(body.pageSize, `${range} ${type}`).toBe(10);
        // `best token` has no token drop here: one empty page, the total 0.
        if (type === "project") {
          expect(body, `${range} ${type}`).toMatchObject({ page: 1, total: 0, rows: [] });
        } else {
          expect(body, `${range} ${type}`).toMatchObject({ page: 2, total: 23 });
          expect(body.rows.map((r) => r.rank)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
        }
      }
    }
  });
});

describe("GET /api/boards has no cut at 50", () => {
  const set = chads(55);
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: set.indexed } });
    harness.setNow(NOW);
    await set.seed();
  });
  afterEach(() => harness.close());

  it("55 chads: the total is 55, page 6 holds ranks 51 to 55", async () => {
    const body = await board("?range=all&page=6");
    expect(body).toMatchObject({ page: 6, total: 55 });
    expect(body.rows.map((r) => r.rank)).toEqual([51, 52, 53, 54, 55]);
  });
});

describe("GET /api/boards?board=dropper counts USDG at 1 usd", () => {
  const indexed = [1, 2].map((n) => ({
    address: addr(0x2000 + n),
    creatorCommitment: commitment(0x2000 + n),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: n === 1 ? "1000000000000000" : "75000000",
    claimedCountFinal: 1,
    recipients: [addr(0x9100 + n)],
    claimedIndexes: [0],
  }));
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: indexed } });
    harness.setNow(NOW);
    const db = harness.deps.db;
    await db.insert(profiles).values([
      { xUserId: "1", handle: "alice", displayName: "alice", profileImageUrl: null },
      { xUserId: "2", handle: "bob", displayName: "bob", profileImageUrl: null },
    ]);
    // alice: 0.001 ETH at 2000 = 2 usd. bob: 75 USDG, 6 decimals, = 75 usd.
    await db.insert(drops).values([row(0x2001, "1"), row(0x2002, "2", TESTNET_USDG)]);
    await db.insert(dropHandleLeaves).values([
      { dropAddress: addr(0x2001), leafIndex: 0, xUserId: "a-0", amount: "1" },
      { dropAddress: addr(0x2002), leafIndex: 0, xUserId: "b-0", amount: "1" },
    ]);
  });
  afterEach(() => harness.close());

  it("ranks bob's USDG drop at 75 usd over alice's ETH at 2 usd", async () => {
    const body = await board("?range=all&board=dropper");
    expect(body.rankedBy).toBe("usd");
    expect(body.rows.map((r) => [r.profile.handle, r.usd])).toEqual([
      ["bob", 75],
      ["alice", 2],
    ]);
  });

  it("best dropchad still leaves the USDG drop out", async () => {
    const body = await board("?range=all&board=fed");
    expect(body.rows.map((r) => r.profile.handle)).toEqual(["alice"]);
  });
});
