/**
 * only handle drops count.
 *
 * - A multisend, `mode = 'address'`, is on no board, adds nothing to a profile or a tile, and is
 *   not on the profile wall. Its own page keeps working, the rain stream included (,
 *   the web decides). It has no share card.
 * - A handle drop counts **people**, the X ids behind the claimed leaves: the indexer's final
 *   `claimedIndexes` read through `drop_handle_leaves`. Never the paid wallets.
 * - The EVM handle claims come from the indexer only. the indexer sends no
 *   `claimedIndexes`, so an EVM handle drop counts zero. Never from
 *   `handle_bindings`.
 * - The front page tiles are built from the same rows as the boards, never from the indexer's
 *   `/stats`, which counts every drop.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import type { BoardDrop } from "../src/indexer/client.js";
import { createHarness, type Harness } from "./harness.js";

let harness: Harness;

const NOW = new Date("2026-09-12T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const DAY = 24 * 60 * 60;

const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

// alice: two handle drops and one multisend. bob: one handle drop the indexer cannot place yet.
const H1 = addr(0x101);
const H2 = addr(0x102);
const MULTISEND = addr(0x103);
const BOB_V2 = addr(0x201);

const INDEXED: BoardDrop[] = [
  // X ids 9001 and 9002 claimed, to two wallets.
  {
    address: H1,
    creatorCommitment: commitment(1),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "300000000000000",
    claimedCountFinal: 2,
    recipients: [addr(0xa1), addr(0xa2)],
    claimedIndexes: [0, 1],
  },
  // X id 9001 again, to a third wallet. The same person, counted once.
  {
    address: H2,
    creatorCommitment: commitment(2),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "100000000000000",
    claimedCountFinal: 1,
    recipients: [addr(0xa3)],
    claimedIndexes: [0],
  },
  // Five wallets paid 0.005 ETH. A multisend: worth nothing on a board.
  {
    address: MULTISEND,
    creatorCommitment: commitment(3),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "5000000000000000",
    claimedCountFinal: 5,
    recipients: [addr(0xb1), addr(0xb2), addr(0xb3), addr(0xb4), addr(0xb5)],
    claimedIndexes: [0, 1, 2, 3, 4],
  },
  // A handle drop as the indexer answers: claims summed, no `claimedIndexes`.
  {
    address: BOB_V2,
    creatorCommitment: commitment(4),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "7000000000000000",
    claimedCountFinal: 2,
    recipients: [addr(0xc1), addr(0xc2)],
  },
];

const row = (
  address: string,
  xUserId: string,
  c: string,
  mode: "address" | "handle",
  leafCount: number,
) => ({
  address,
  mode,
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId,
  nonce: BigInt(address.slice(-1)),
  creatorCommitment: c,
  salt: `0x${"22".repeat(32)}`,
  asset: "0x0000000000000000000000000000000000000000",
  merkleRoot: `0x${"33".repeat(32)}`,
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: "{}",
  totalEntitlements: "10000000000000000",
  feeAmount: "0",
  grossRequired: "10000000000000000",
  leafCount,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: 1_800_000_000n,
  claimPeriod: 2_592_000,
  state: "active",
  paidCount: 0,
  createTxHash: `0x${"55".repeat(32)}`,
  priceUsd: "3000",
  pricedAt: NOW,
  createdAt: new Date(NOW.getTime() - DAY * 1000),
});

const leaves = (address: string, xIds: string[]) =>
  xIds.map((xUserId, leafIndex) => ({
    dropAddress: address,
    leafIndex,
    xUserId,
    amount: "100000000000000",
  }));

async function seed(): Promise<void> {
  const db = harness.deps.db;
  await db.insert(profiles).values([
    { xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null },
    { xUserId: "2", handle: "bob", displayName: "Bob", profileImageUrl: null },
  ]);
  await db
    .insert(drops)
    .values([
      row(H1, "1", commitment(1), "handle", 2),
      row(H2, "1", commitment(2), "handle", 2),
      row(MULTISEND, "1", commitment(3), "address", 5),
      row(BOB_V2, "2", commitment(4), "handle", 2),
    ]);
  await db
    .insert(dropHandleLeaves)
    .values([
      ...leaves(H1, ["9001", "9002"]),
      ...leaves(H2, ["9001", "9003"]),
      ...leaves(BOB_V2, ["9201", "9202"]),
    ]);
}

interface BoardBody {
  rows: {
    profile: { handle: string };
    totalWei: string;
    usd: number;
    dropCount: number;
    uniqueReceivers: number;
  }[];
}

async function json<T>(path: string): Promise<T> {
  const response = await harness.app.request(path);
  expect(response.status, path).toBe(200);
  return (await response.json()) as T;
}

beforeEach(async () => {
  harness = await createHarness({
    indexer: {
      boardDrops: INDEXED,
      // The indexer's own `/stats` counts every drop, multisend included. The tiles must not.
      stats: {
        droppedTotalWei: "12400000000000000",
        dropCount: 4,
        uniqueReceivers: 10,
        claimCount: 10,
        finality: "final",
      },
    },
  });
  harness.setNow(NOW);
  await seed();
});
afterEach(() => harness.close());

describe("boards count handle drops only", () => {
  it("a multisend is on no board, whatever it paid", async () => {
    for (const board of ["fed", "dropper", "project"]) {
      const body = await json<BoardBody>(`/api/boards?range=all&chain=all&board=${board}`);
      expect(
        body.rows.some((r) => r.totalWei === "5400000000000000" || r.dropCount === 3),
        board,
      ).toBe(false);
    }
    const fed = await json<BoardBody>("/api/boards?range=all&chain=all");
    expect(fed.rows.map((r) => [r.profile.handle, r.dropCount, r.totalWei])).toEqual([
      ["alice", 2, "400000000000000"],
    ]);
  });

  it("people are X ids: one X id paid to two wallets in two drops is one person", async () => {
    const fed = await json<BoardBody>("/api/boards?range=all&chain=all");
    // 9001 in both drops and 9002 once. Three wallets were paid; two people.
    expect(fed.rows[0]?.uniqueReceivers).toBe(2);
  });

  it("an EVM handle drop without claimedIndexes counts zero, until the indexer sends them", async () => {
    for (const board of ["fed", "dropper", "project"]) {
      const body = await json<BoardBody>(`/api/boards?range=all&chain=all&board=${board}`);
      expect(
        body.rows.map((r) => r.profile.handle),
        board,
      ).not.toContain("bob");
    }
  });

  it("usd counts the handle drops only", async () => {
    const body = await json<BoardBody>("/api/boards?range=all&chain=all&board=dropper");
    // 0.0004 ETH at 3000 is 1.20. The multisend's 0.005 ETH would be 15.00 more.
    expect(body.rows.map((r) => [r.profile.handle, r.usd])).toEqual([["alice", 1.2]]);
  });
});

describe("the profile counts handle drops only", () => {
  interface UserBody {
    totals: { dropCount: number; uniqueReceivers: number; totalWei: string; usd: number };
    drops: { address: string; mode: string }[];
  }

  it("totals leave the multisend out", async () => {
    const body = await json<UserBody>("/api/users/alice");
    expect(body.totals).toMatchObject({
      dropCount: 2,
      uniqueReceivers: 2,
      totalWei: "400000000000000",
      usd: 1.2,
    });
  });

  it("the wall shows handle drops only, each with its mode", async () => {
    const body = await json<UserBody>("/api/users/alice");
    expect(body.drops.map((d) => d.address).sort()).toEqual([H1, H2]);
    expect(body.drops.every((d) => d.mode === "handle")).toBe(true);
  });

  it("bob's handle drop is on his wall, and counts zero", async () => {
    const body = await json<UserBody>("/api/users/bob");
    expect(body.drops.map((d) => d.address)).toEqual([BOB_V2]);
    expect(body.totals).toMatchObject({ dropCount: 0, uniqueReceivers: 0, totalWei: "0" });
  });
});

describe("the front page tiles count handle drops only", () => {
  interface StatsBody {
    droppedTotalWei: string;
    dropCount: number;
    uniqueReceivers: number;
    claimCount: number;
    usd: number;
    dropped: unknown[];
    totals: { chainKey: string; droppedTotal: string; dropCount: number; claimCount: number }[];
  }

  it("builds the tiles from the board rows, never from the indexer's /stats", async () => {
    for (const chain of ["all", "robinhood"]) {
      const body = await json<StatsBody>(`/api/stats?chain=${chain}`);
      expect(body, chain).toMatchObject({
        droppedTotalWei: "400000000000000",
        dropCount: 2,
        uniqueReceivers: 2,
        // Three leaves claimed: two in the first drop, one in the second.
        claimCount: 3,
        usd: 1.2,
      });
      expect(body.dropped, chain).toEqual([
        { kind: "coin", symbol: "ETH", decimals: 18, amount: "400000000000000" },
      ]);
      expect(
        body.totals.find((t) => t.chainKey === "robinhood-testnet"),
        chain,
      ).toMatchObject({
        droppedTotal: "400000000000000",
        dropCount: 2,
        claimCount: 3,
      });
    }
  });

  it("still answers 503 when the indexer is down", async () => {
    const down = await createHarness({ indexer: { down: true } });
    try {
      const response = await down.app.request("/api/stats");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "indexer_unavailable" });
    } finally {
      await down.close();
    }
  });
});

describe("the drop page says the mode, and a multisend keeps its page", () => {
  it("GET /api/drops/:address carries the mode", async () => {
    const handle = await json<{ ours: { data: { mode: string } } }>(`/api/drops/${H1}`);
    expect(handle.ours.data.mode).toBe("handle");
    const multisend = await json<{ ours: { data: { mode: string } } }>(`/api/drops/${MULTISEND}`);
    expect(multisend.ours.data.mode).toBe("address");
  });

  it("the live stream still runs for a multisend, and its snapshot says the mode", async () => {
    const response = await harness.app.request(`/api/drops/${MULTISEND}/live`);
    expect(response.status).toBe(200);
    const body = response.body as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(text).toContain("event: snapshot");
    const data = JSON.parse(/data:\s*(.+)/.exec(text)?.[1] ?? "{}") as { mode?: string };
    expect(data.mode).toBe("address");
  });

  it("a multisend has no share card; a handle drop has one, for its sender only", async () => {
    const multisend = await harness.app.request(`/api/drops/${MULTISEND}/share`);
    expect(multisend.status).toBe(404);
    expect(await multisend.json()).toEqual({ error: "no_share_card" });
    // Signed out: the card is the sender's. `share.test.ts` has the rest.
    expect((await harness.app.request(`/api/drops/${H1}/share`)).status).toBe(401);
  });
});
