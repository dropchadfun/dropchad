/**
 * the boards and tiles for token drops.
 * - a token amount is never added to a coin: `droppedTotal`, `biggestDrop`, `byChain.total` and
 *   the usd leave token drops out
 * - `drops made`, `payouts` and `people` on the tiles and the profile count token drops too;
 *   people once per chain, paid in a coin or a token
 * - the `dropped` line ends with the number of different tokens, by mint
 * - `best dropchad` (`fed`) and `dropper` count SOL and ETH drops only; `best token`
 *   (`project`) token drops only, no forced kind, `usd: 0`
 *
 * The drops are EVM rows from the indexer stub: the rule is the asset on our row, whatever the
 * chain. A token drop's `asset` is its token address.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  rankBoard,
  totalsByChad,
  type BoardProfile,
  type CountedDrop,
} from "../src/boards/compute.js";
import { chainFilter, type ChainFilter } from "../src/chain/filter.js";
import { tileStats } from "../src/drops/read.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import { createHarness, type Harness } from "./harness.js";

const NATIVE = "0x0000000000000000000000000000000000000000";
const TOKEN_A = "0x00000000000000000000000000000000000000a1";
const TOKEN_B = "0x00000000000000000000000000000000000000b2";
/** Huge on purpose: if a token amount ever leaks into a coin total, the number shows it. */
const TOKEN_CLAIMED = "7000000000000000000000";

// -------------------------------------------------------------------------------------------
// the pure part
// -------------------------------------------------------------------------------------------

const profile = (xUserId: string, handle: string, kind = "chad"): BoardProfile => ({
  xUserId,
  handle,
  displayName: handle,
  profileImageUrl: null,
  kind: kind as BoardProfile["kind"],
  tags: [],
  tagLockedUntil: null,
  badges: [],
});

const counted = (
  address: string,
  xUserId: string,
  people: string[],
  mint: string | null,
  claimed: bigint,
  priceUsd: number | null = null,
): CountedDrop => ({
  address,
  chainKey: "robinhood-testnet",
  xUserId,
  createdAt: 1_800_000_000,
  claimed,
  claimCount: people.length,
  people,
  priceUsd,
  mint,
});

const ALL = chainFilter("all") as ChainFilter;
const options = { filter: ALL, evmChainKeys: new Set(["robinhood-testnet"]) };

describe("totalsByChad with token drops", () => {
  const mixed = [
    counted("0x1", "1", ["10", "11"], null, 1_000n, 2_000),
    counted("0x2", "1", ["11", "12", "13"], TOKEN_A, BigInt(TOKEN_CLAIMED)),
  ];
  const byId = new Map([["1", profile("1", "alice")]]);

  it("all: counts every drop and person, but coins and usd from the native drop only", () => {
    const [row] = totalsByChad(mixed, byId, { ...options, assets: "all" });
    expect(row).toMatchObject({
      totalWei: 1_000n,
      biggestDropWei: 1_000n,
      dropCount: 2,
      claimCount: 5,
      // 10, 11, 12, 13: 11 is paid in both, one person inside one chain.
      uniqueReceivers: 4,
      tokens: 1,
    });
    expect(row?.usd).toBeCloseTo(2_000 * 1e-15);
    expect(row?.byChain[0]?.total).toBe(1_000n);
  });

  it("native: the token drop is not there at all", () => {
    const [row] = totalsByChad(mixed, byId, { ...options, assets: "native" });
    expect(row).toMatchObject({ dropCount: 1, claimCount: 2, uniqueReceivers: 2, tokens: 0 });
  });

  it("token: only the token drop, and no coin amount, no usd", () => {
    const [row] = totalsByChad(mixed, byId, { ...options, assets: "token" });
    expect(row).toMatchObject({
      totalWei: 0n,
      biggestDropWei: 0n,
      usd: 0,
      dropCount: 1,
      claimCount: 3,
      uniqueReceivers: 3,
      tokens: 1,
    });
    expect(row?.byChain[0]?.total).toBe(0n);
  });

  it("a chad with token drops only has no row on the native scope", () => {
    const rows = totalsByChad([counted("0x3", "1", ["10"], TOKEN_A, 5n)], byId, {
      ...options,
      assets: "native",
    });
    expect(rows).toEqual([]);
  });

  it("tokens counts different mints: two drops of one token are 1", () => {
    const [row] = totalsByChad(
      [
        counted("0x4", "1", ["10"], TOKEN_A, 5n),
        counted("0x5", "1", ["11"], TOKEN_A, 5n),
        counted("0x6", "1", ["12"], TOKEN_B, 5n),
      ],
      byId,
      { ...options, assets: "token" },
    );
    expect(row?.tokens).toBe(2);
  });
});

describe("tileStats with token drops", () => {
  const scope = { evmChainKey: "robinhood-testnet", solanaChainKey: null, solanaAvailable: true };

  it("counts token drops in drops, payouts and people, never in the coin or the usd", () => {
    const stats = tileStats(
      [
        counted("0x1", "1", ["10", "11"], null, 1_000n, 2_000),
        counted("0x2", "2", ["11", "12"], TOKEN_A, BigInt(TOKEN_CLAIMED)),
        counted("0x3", "3", ["13"], TOKEN_A, BigInt(TOKEN_CLAIMED)),
        counted("0x4", "3", ["14"], TOKEN_B, BigInt(TOKEN_CLAIMED)),
      ],
      ALL,
      scope,
    );
    expect(stats.dropCount).toBe(4);
    expect(stats.claimCount).toBe(6);
    expect(stats.uniqueReceivers).toBe(5);
    expect(stats.droppedTotalWei).toBe("1000");
    expect(stats.totals[0]?.droppedTotal).toBe("1000");
    expect(stats.usd).toBeCloseTo(0);
    // The coin, then the number of different tokens: A and B.
    expect(stats.dropped).toEqual([
      { kind: "coin", symbol: "ETH", decimals: 18, amount: "1000" },
      { kind: "tokens", count: 2 },
    ]);
  });

  it("no token drop, no token item", () => {
    const stats = tileStats([counted("0x1", "1", ["10"], null, 1_000n)], ALL, scope);
    expect(stats.dropped).toEqual([{ kind: "coin", symbol: "ETH", decimals: 18, amount: "1000" }]);
  });
});

describe("rankBoard keeps working on a scope", () => {
  it("best token ranks by people paid with tokens, then drops", () => {
    const byId = new Map([
      ["1", profile("1", "alice")],
      ["2", profile("2", "bob")],
    ]);
    const rows = totalsByChad(
      [
        counted("0x1", "1", ["10"], TOKEN_A, 5n),
        counted("0x2", "2", ["11", "12"], TOKEN_A, 5n),
        counted("0x3", "1", ["20", "21", "22"], null, 5n),
      ],
      byId,
      { ...options, assets: "token" },
    );
    expect(rankBoard(rows, "all", "uniqueReceivers").map((r) => r.profile.handle)).toEqual([
      "bob",
      "alice",
    ]);
  });
});

// -------------------------------------------------------------------------------------------
// the routes
// -------------------------------------------------------------------------------------------

let harness: Harness;

const NOW = new Date("2026-09-12T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const DAY = 24 * 60 * 60;
const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

interface Seed {
  readonly address: string;
  readonly xUserId: string;
  readonly n: number;
  readonly asset: string;
  readonly people: string[];
  readonly claimed: string;
  readonly ageDays: number;
  readonly priceUsd?: string;
}

/**
 * - alice (kol): a native drop to 9001, 9002, and two drops of token A, to 9001 and to 9003, 9004
 * - bob (chad): a native drop to 9101
 * - carol (project): a native drop to 9201; on no token board
 * - dave (chad): a token B drop, 30 days ago, to 9301
 */
const SEEDS: Seed[] = [
  {
    address: addr(0x101),
    xUserId: "1",
    n: 1,
    asset: NATIVE,
    people: ["9001", "9002"],
    claimed: "300000000000000",
    ageDays: 1,
    priceUsd: "3000",
  },
  {
    address: addr(0x102),
    xUserId: "1",
    n: 2,
    asset: TOKEN_A,
    people: ["9001"],
    claimed: TOKEN_CLAIMED,
    ageDays: 1,
  },
  {
    address: addr(0x103),
    xUserId: "1",
    n: 3,
    asset: TOKEN_A,
    people: ["9003", "9004"],
    claimed: TOKEN_CLAIMED,
    ageDays: 2,
  },
  {
    address: addr(0x201),
    xUserId: "2",
    n: 4,
    asset: NATIVE,
    people: ["9101"],
    claimed: "100000000000000",
    ageDays: 1,
  },
  {
    address: addr(0x301),
    xUserId: "3",
    n: 5,
    asset: NATIVE,
    people: ["9201"],
    claimed: "100000000000000",
    ageDays: 1,
  },
  {
    address: addr(0x401),
    xUserId: "4",
    n: 6,
    asset: TOKEN_B,
    people: ["9301"],
    claimed: TOKEN_CLAIMED,
    ageDays: 30,
  },
];

const INDEXED = SEEDS.map((s) => ({
  address: s.address,
  creatorCommitment: commitment(s.n),
  createdAt: String(SECONDS - s.ageDays * DAY),
  claimedFinalWei: s.claimed,
  claimedCountFinal: s.people.length,
  recipients: s.people.map((_, i) => addr(0xe000 + i)),
  claimedIndexes: s.people.map((_, i) => i),
}));

async function seed(): Promise<void> {
  const db = harness.deps.db;
  await db.insert(profiles).values([
    { xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null, kind: "kol" },
    { xUserId: "2", handle: "bob", displayName: "Bob", profileImageUrl: null },
    { xUserId: "3", handle: "carol", displayName: "Carol", profileImageUrl: null, kind: "project" },
    { xUserId: "4", handle: "dave", displayName: "Dave", profileImageUrl: null },
  ]);
  await db.insert(drops).values(
    SEEDS.map((s) => ({
      address: s.address,
      mode: "handle" as const,
      priceUsd: s.priceUsd ?? null,
      pricedAt: s.priceUsd === undefined ? null : NOW,
      chainId: 46630,
      chainKey: "robinhood-testnet",
      xUserId: s.xUserId,
      nonce: BigInt(s.n),
      creatorCommitment: commitment(s.n),
      salt: `0x${"22".repeat(32)}`,
      asset: s.asset,
      merkleRoot: `0x${"33".repeat(32)}`,
      manifestHash: `0x${"44".repeat(32)}`,
      manifestJson: "{}",
      totalEntitlements: s.claimed,
      feeAmount: "0",
      grossRequired: s.claimed,
      leafCount: s.people.length,
      refundRecipient: "0x000000000000000000000000000000000000dEaD",
      fundingDeadline: 1_800_000_000n,
      claimPeriod: 2_592_000,
      state: "finished",
      paidCount: s.people.length,
      createTxHash: `0x${"55".repeat(32)}`,
      createdAt: new Date(NOW.getTime() - s.ageDays * DAY * 1000),
    })),
  );
  await db.insert(dropHandleLeaves).values(
    SEEDS.flatMap((s) =>
      s.people.map((xUserId, leafIndex) => ({
        dropAddress: s.address,
        leafIndex,
        xUserId,
        amount: "1",
      })),
    ),
  );
}

interface Row {
  profile: { handle: string };
  totalWei: string;
  usd: number;
  dropCount: number;
  uniqueReceivers: number;
  claimCount: number;
  biggestDropWei: string;
}

async function board(query: string): Promise<Row[]> {
  const response = await harness.app.request(`/api/boards${query}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { rows: Row[] }).rows;
}

describe("the routes with token drops", () => {
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: INDEXED } });
    harness.setNow(NOW);
    await seed();
  });
  afterEach(() => harness.close());

  it("best dropchad: native drops only; dave is not there, alice counts her SOL drop alone", async () => {
    const rows = await board("?range=all");
    expect(rows.map((r) => r.profile.handle).sort()).toEqual(["alice", "bob", "carol"]);
    const alice = rows.find((r) => r.profile.handle === "alice");
    expect(alice).toMatchObject({
      totalWei: "300000000000000",
      biggestDropWei: "300000000000000",
      dropCount: 1,
      claimCount: 2,
      uniqueReceivers: 2,
    });
  });

  it("the usd board leaves token drops out too", async () => {
    const rows = await board("?range=all&board=dropper");
    expect(rows.map((r) => r.profile.handle)).not.toContain("dave");
  });

  it("best token: token drops only, ranked by people, usd 0, no forced kind", async () => {
    const rows = await board("?range=all&board=project");
    // alice: 3 people in 2 token drops; dave: 1. carol, kind project, dropped no token.
    expect(rows.map((r) => [r.profile.handle, r.uniqueReceivers, r.dropCount])).toEqual([
      ["alice", 3, 2],
      ["dave", 1, 1],
    ]);
    for (const r of rows) {
      expect(r.usd).toBe(0);
      expect(r.totalWei).toBe("0");
      expect(r.biggestDropWei).toBe("0");
    }
  });

  it("best token: the kind query narrows it like best dropchad", async () => {
    const rows = await board("?range=all&board=project&kind=kol");
    expect(rows.map((r) => r.profile.handle)).toEqual(["alice"]);
  });

  it("best token: the ranges hold, dave's 30 day old drop is not in this week", async () => {
    const rows = await board("?range=week&board=project");
    expect(rows.map((r) => r.profile.handle)).toEqual(["alice"]);
  });

  it("GET /api/stats: token drops in drops, payouts and people, never in the coin; 2 tokens", async () => {
    const response = await harness.app.request("/api/stats?chain=all");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dropCount: number;
      claimCount: number;
      uniqueReceivers: number;
      droppedTotalWei: string;
      usd: number;
      dropped: unknown[];
    };
    expect(body.dropCount).toBe(6);
    expect(body.claimCount).toBe(8);
    // 9001 is paid in alice's coin drop and in her token drop: one person on this chain.
    expect(body.uniqueReceivers).toBe(7);
    expect(body.droppedTotalWei).toBe("500000000000000");
    expect(body.usd).toBe(0.9);
    expect(body.dropped).toEqual([
      { kind: "coin", symbol: "ETH", decimals: 18, amount: "500000000000000" },
      { kind: "tokens", count: 2 },
    ]);
  });

  it("GET /api/users/:handle: the profile counts the token drops, the coin line ends with 1 token", async () => {
    const response = await harness.app.request("/api/users/alice");
    expect(response.status).toBe(200);
    const { totals } = (await response.json()) as {
      totals: {
        totalWei: string;
        dropCount: number;
        claimCount: number;
        uniqueReceivers: number;
        usd: number;
        biggestDropWei: string;
        byChain: { total: string }[];
        dropped: unknown[];
      };
    };
    expect(totals).toMatchObject({
      totalWei: "300000000000000",
      biggestDropWei: "300000000000000",
      dropCount: 3,
      claimCount: 5,
      // 9001, 9002, 9003, 9004.
      uniqueReceivers: 4,
      usd: 0.9,
    });
    expect(totals.byChain[0]?.total).toBe("300000000000000");
    expect(totals.dropped).toEqual([
      { kind: "coin", symbol: "ETH", decimals: 18, amount: "300000000000000" },
      { kind: "tokens", count: 1 },
    ]);
  });
});
