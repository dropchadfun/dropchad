/**
 * The top token on a `best token` row: the chad's token that paid the most people; on a tie,
 * more drops of
 * that token, then the token dropped first. `tokens` stays the number of mints, for the web's
 * `+N`. The ranking does not change. `fed` and `dropper` rows carry `topToken: null`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boardRowJson,
  rankBoard,
  totalsByChad,
  type BoardProfile,
  type CountedDrop,
} from "../src/boards/compute.js";
import { chainFilter, type ChainFilter } from "../src/chain/filter.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import type { TokenInfo } from "../src/drops/token-info.js";
import { createHarness, type Harness } from "./harness.js";

const NATIVE = "0x0000000000000000000000000000000000000000";
const TOKEN_A = "0x00000000000000000000000000000000000000a1";
const TOKEN_B = "0x00000000000000000000000000000000000000b2";
const TOKEN_C = "0x00000000000000000000000000000000000000c3";

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

const tokenOf = (mint: string, symbol: string | null): TokenInfo => ({
  mint,
  symbol,
  name: symbol,
  decimals: 18,
  tokenProgram: "erc20",
  logoUrl: `/api/tokens/${mint}/logo?chain=robinhood`,
  launchpad: null,
});

const SYMBOLS: Record<string, string> = { [TOKEN_A]: "AAA", [TOKEN_B]: "BBB", [TOKEN_C]: "CCC" };

let next = 0;
const counted = (
  xUserId: string,
  people: string[],
  mint: string | null,
  createdAt = 1_800_000_000,
): CountedDrop => ({
  address: `0x${(next += 1).toString(16)}`,
  chainKey: "robinhood-testnet",
  xUserId,
  createdAt,
  claimed: 5n,
  claimCount: people.length,
  people,
  priceUsd: null,
  mint,
  token: mint === null ? null : tokenOf(mint, SYMBOLS[mint] ?? null),
});

const ALL = chainFilter("all") as ChainFilter;
const options = { filter: ALL, evmChainKeys: new Set(["robinhood-testnet"]) };
const byId = new Map([
  ["1", profile("1", "alice")],
  ["2", profile("2", "bob")],
]);

function only(drops: CountedDrop[], assets: "token" | "native" | "all" = "token") {
  const rows = totalsByChad(drops, byId, { ...options, assets });
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("topToken, the token that paid the most people", () => {
  it("picks the token with the most people, not the most drops", () => {
    const row = only([
      counted("1", ["10", "11"], TOKEN_A),
      counted("1", ["10", "11"], TOKEN_A),
      counted("1", ["20", "21", "22"], TOKEN_B),
    ]);
    expect(row.topToken?.mint).toBe(TOKEN_B);
    expect(row.topToken?.symbol).toBe("BBB");
  });

  it("counts people once per token: X ids, never claims", () => {
    // A: 10, 11, 12 over two drops = 3 people (11 twice counts once). B: 20, 21 = 2 people.
    const row = only([
      counted("1", ["10", "11"], TOKEN_A),
      counted("1", ["11", "12"], TOKEN_A),
      counted("1", ["20", "21"], TOKEN_B),
    ]);
    expect(row.topToken?.mint).toBe(TOKEN_A);
  });

  it("on a tie of people, more drops of that token wins", () => {
    const row = only([
      counted("1", ["20", "21"], TOKEN_B),
      counted("1", ["10"], TOKEN_A),
      counted("1", ["11"], TOKEN_A),
    ]);
    expect(row.topToken?.mint).toBe(TOKEN_A);
  });

  it("on a tie of people and drops, the token dropped first wins", () => {
    const row = only([
      counted("1", ["10"], TOKEN_A, 1_800_000_500),
      counted("1", ["20"], TOKEN_B, 1_800_000_100),
    ]);
    expect(row.topToken?.mint).toBe(TOKEN_B);
  });

  it("keeps tokens as the number of mints, for the web's +N", () => {
    const row = only([
      counted("1", ["10", "11", "12"], TOKEN_A),
      counted("1", ["20"], TOKEN_B),
      counted("1", ["30"], TOKEN_C),
    ]);
    expect(row.tokens).toBe(3);
    expect(row.topToken?.mint).toBe(TOKEN_A);
  });

  it("carries the token's fields: mint, ticker, name, decimals, program, our logo route", () => {
    const row = only([counted("1", ["10"], TOKEN_A)]);
    expect(row.topToken).toEqual(tokenOf(TOKEN_A, "AAA"));
  });

  it("is null on the native scope, best dropchad and dropper", () => {
    const row = only([counted("1", ["10"], null), counted("1", ["20", "21"], TOKEN_A)], "native");
    expect(row.topToken).toBeNull();
  });

  it("does not change the ranking: still people, then drops", () => {
    const rows = totalsByChad(
      [
        // alice: one token, 3 people. bob: two tokens, 2 people in all.
        counted("1", ["10", "11", "12"], TOKEN_A),
        counted("2", ["20"], TOKEN_B),
        counted("2", ["21"], TOKEN_C),
      ],
      byId,
      { ...options, assets: "token" },
    );
    expect(rankBoard(rows, "all", "uniqueReceivers").map((r) => r.profile.handle)).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("boardRowJson sends topToken and tokens", () => {
    const [row] = rankBoard(
      [only([counted("1", ["10"], TOKEN_A), counted("1", ["20"], TOKEN_B, 1_800_000_900)])],
      "all",
      "uniqueReceivers",
    );
    const json = boardRowJson(row!);
    expect(json.topToken).toEqual(tokenOf(TOKEN_A, "AAA"));
    expect(json.tokens).toBe(2);
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

interface Seed {
  readonly address: string;
  readonly xUserId: string;
  readonly n: number;
  readonly asset: string;
  readonly symbol: string | null;
  readonly people: string[];
}

/**
 * alice: a native drop to 9001, a token A (`AAA`) drop to 9002, a token B (no ticker) drop to
 * 9003, 9004. Her top token is B, 2 people; `tokens` is 2.
 */
const SEEDS: Seed[] = [
  { address: addr(0x101), xUserId: "1", n: 1, asset: NATIVE, symbol: null, people: ["9001"] },
  { address: addr(0x102), xUserId: "1", n: 2, asset: TOKEN_A, symbol: "AAA", people: ["9002"] },
  {
    address: addr(0x103),
    xUserId: "1",
    n: 3,
    asset: TOKEN_B,
    symbol: null,
    people: ["9003", "9004"],
  },
];

const INDEXED = SEEDS.map((s) => ({
  address: s.address,
  creatorCommitment: commitment(s.n),
  createdAt: String(SECONDS - DAY),
  claimedFinalWei: "1000",
  claimedCountFinal: s.people.length,
  recipients: s.people.map((_, i) => addr(0xe000 + i)),
  claimedIndexes: s.people.map((_, i) => i),
}));

async function seed(): Promise<void> {
  const db = harness.deps.db;
  await db
    .insert(profiles)
    .values([{ xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null }]);
  await db.insert(drops).values(
    SEEDS.map((s) => {
      const token = s.asset !== NATIVE;
      return {
        address: s.address,
        mode: "handle" as const,
        priceUsd: null,
        pricedAt: null,
        chainId: 46630,
        chainKey: "robinhood-testnet",
        xUserId: s.xUserId,
        nonce: BigInt(s.n),
        creatorCommitment: commitment(s.n),
        salt: `0x${"22".repeat(32)}`,
        asset: s.asset,
        tokenProgram: token ? "erc20" : null,
        tokenDecimals: token ? 18 : null,
        tokenName: s.symbol,
        tokenSymbol: s.symbol,
        merkleRoot: `0x${"33".repeat(32)}`,
        manifestHash: `0x${"44".repeat(32)}`,
        manifestJson: "{}",
        totalEntitlements: "1000",
        feeAmount: "0",
        grossRequired: "1000",
        leafCount: s.people.length,
        refundRecipient: "0x000000000000000000000000000000000000dEaD",
        fundingDeadline: 1_800_000_000n,
        claimPeriod: 2_592_000,
        state: "finished",
        paidCount: s.people.length,
        createTxHash: `0x${"55".repeat(32)}`,
        createdAt: new Date(NOW.getTime() - DAY * 1000),
      };
    }),
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
  tokens: number;
  topToken: { mint: string; symbol: string | null; logoUrl: string } | null;
}

async function board(query: string): Promise<Row[]> {
  const response = await harness.app.request(`/api/boards${query}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { rows: Row[] }).rows;
}

describe("GET /api/boards and the top token", () => {
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: INDEXED } });
    harness.setNow(NOW);
    await seed();
  });
  afterEach(() => harness.close());

  it("best token: each row has its top token and the number of tokens", async () => {
    const [alice] = await board("?range=all&board=project");
    expect(alice?.profile.handle).toBe("alice");
    expect(alice?.tokens).toBe(2);
    expect(alice?.topToken).toMatchObject({
      mint: TOKEN_B,
      symbol: null,
      logoUrl: `/api/tokens/${TOKEN_B}/logo?chain=robinhood`,
    });
  });

  it("best dropchad: no top token", async () => {
    const [alice] = await board("?range=all");
    expect(alice?.profile.handle).toBe("alice");
    expect(alice?.topToken).toBeNull();
  });
});
