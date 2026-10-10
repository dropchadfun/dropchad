/**
 * `GET /api/boards` and `GET /api/users/:handle`.
 *
 * The board is computed in the api: the indexer only knows a drop's `creatorCommitment`, and a
 * commitment is `keccak256(xUserId, nonce)`, unique per drop. Our own `drops` table is the only
 * thing that maps a commitment back to the X id that made it. So: final drops from the indexer,
 * joined to `drops` on the commitment, grouped by `x_user_id`, joined to `profiles`.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import { createHarness, type Harness } from "./harness.js";

let harness: Harness;

const NOW = new Date("2026-09-12T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const DAY = 24 * 60 * 60;

const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

/**
 * What the indexer's `/board-drops` answers: one row per final, verified drop. Every drop here is a
 * handle drop.: `claimedIndexes` are the claimed leaves, and `LEAVES` below gives the X id
 * behind each one. People are counted by X id, never by the wallet paid.
 */
const INDEXED = [
  // alice, this week, two drops. Receiver 0xa1 gets paid twice, so unique receivers is 3 not 4.
  {
    address: addr(0x101),
    creatorCommitment: commitment(1),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "300000000000000",
    claimedCountFinal: 2,
    recipients: [addr(0xa1), addr(0xa2)],
    claimedIndexes: [0, 1],
  },
  {
    address: addr(0x102),
    creatorCommitment: commitment(2),
    createdAt: String(SECONDS - 2 * DAY),
    claimedFinalWei: "500000000000000",
    claimedCountFinal: 2,
    recipients: [addr(0xa1), addr(0xa3)],
    claimedIndexes: [0, 1],
  },
  // bob, one big drop, thirty days ago. Only on the all time board.
  {
    address: addr(0x201),
    creatorCommitment: commitment(3),
    createdAt: String(SECONDS - 30 * DAY),
    claimedFinalWei: "2000000000000000",
    claimedCountFinal: 1,
    recipients: [addr(0xb1)],
    claimedIndexes: [0],
  },
  // A commitment we did not create. Cannot be attributed, so it is not on any board.
  {
    address: addr(0x301),
    creatorCommitment: commitment(99),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "9000000000000000",
    claimedCountFinal: 1,
    recipients: [addr(0xc1)],
    claimedIndexes: [0],
  },
];

/** The X id behind each leaf. X id 9001 is paid in both of alice's drops: one person. */
const LEAVES: Record<string, string[]> = {
  [addr(0x101)]: ["9001", "9002", "9004"],
  [addr(0x102)]: ["9001", "9003", "9005"],
  [addr(0x201)]: ["9101", "9102", "9103"],
  [addr(0x401)]: ["9401", "9402", "9403"],
  [addr(0x501)]: ["9501", "9502", "9503"],
};

async function seedLeaves(addresses: string[]): Promise<void> {
  await harness.deps.db.insert(dropHandleLeaves).values(
    addresses.flatMap((address) =>
      (LEAVES[address] ?? []).map((xUserId, leafIndex) => ({
        dropAddress: address,
        leafIndex,
        xUserId,
        amount: "100000000000000",
      })),
    ),
  );
}

/** One of our `drops` rows. `totalEntitlements` is what was funded; the board must never read it. */
const row = (
  address: string,
  xUserId: string,
  nonce: bigint,
  c: string,
  ageDays: number,
  priceUsd: string | null = null,
  totalEntitlements = "300000000000000",
) => ({
  address,
  mode: "handle" as const,
  priceUsd,
  pricedAt: priceUsd === null ? null : new Date(NOW.getTime() - ageDays * DAY * 1000),
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId,
  nonce,
  creatorCommitment: c,
  salt: `0x${"22".repeat(32)}`,
  asset: "0x0000000000000000000000000000000000000000",
  merkleRoot: `0x${"33".repeat(32)}`,
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: "{}",
  totalEntitlements,
  feeAmount: "0",
  grossRequired: totalEntitlements,
  leafCount: 3,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: 1_800_000_000n,
  claimPeriod: 2_592_000,
  state: "finished",
  paidCount: 3,
  createTxHash: `0x${"55".repeat(32)}`,
  title: `drop ${address.slice(-3)}`,
  createdAt: new Date(NOW.getTime() - ageDays * DAY * 1000),
});

async function seed(): Promise<void> {
  const db = harness.deps.db;
  await db.insert(profiles).values([
    { xUserId: "1", handle: "Alice", displayName: "Alice", profileImageUrl: null, kind: "kol" },
    { xUserId: "2", handle: "bob", displayName: "Bob", profileImageUrl: "https://x.invalid/b.png" },
  ]);
  await db.insert(drops).values([
    // Alice: one drop frozen at 3000 usd per ETH, one that never got a price. Bob: 2000.
    row(addr(0x101), "1", 0n, commitment(1), 1, "3000"),
    row(addr(0x102), "1", 1n, commitment(2), 2),
    row(addr(0x201), "2", 0n, commitment(3), 30, "2000"),
  ]);
  await seedLeaves([addr(0x101), addr(0x102), addr(0x201)]);
}

interface BoardRow {
  rank: number;
  profile: { xUserId: string; handle: string; kind: string | null };
  totalWei: string;
  usd: number;
  dropCount: number;
  uniqueReceivers: number;
  biggestDropWei: string;
}

interface BoardBody {
  range: string;
  kind: string;
  board: string;
  rankedBy: string;
  available: boolean;
  note?: string;
  finality: string;
  rows: BoardRow[];
}

async function board(query: string): Promise<BoardBody> {
  const response = await harness.app.request(`/api/boards${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as BoardBody;
}

describe("GET /api/boards", () => {
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: INDEXED } });
    harness.setNow(NOW);
    await seed();
  });
  afterEach(() => harness.close());

  it("groups final drops by the X id behind the commitment, all time, most fed first", async () => {
    const body = await board("?range=all");

    expect(body.range).toBe("all");
    expect(body.kind).toBe("all");
    // The default board: wallets fed, on one chain too.
    expect(body.board).toBe("fed");
    expect(body.rankedBy).toBe("uniqueReceivers");
    expect(body.available).toBe(true);
    // Said out loud, like /api/stats: the board is built from final rows only.
    expect(body.finality).toBe("final");

    // Alice fed three wallets with less money than bob fed one. Wallets win.
    expect(body.rows.map((row) => row.profile.handle)).toEqual(["Alice", "bob"]);

    const [alice, bob] = body.rows;
    expect(alice).toMatchObject({
      rank: 1,
      totalWei: "800000000000000",
      dropCount: 2,
      // X id 9001 was fed twice. Counted once.
      uniqueReceivers: 3,
      biggestDropWei: "500000000000000",
      profile: { xUserId: "1", kind: "kol" },
    });
    expect(bob).toMatchObject({
      rank: 2,
      totalWei: "2000000000000000",
      dropCount: 1,
      uniqueReceivers: 1,
      biggestDropWei: "2000000000000000",
    });
  });

  it("board=fed is the same as the default, and says so", async () => {
    const body = await board("?range=all&board=fed");
    expect(body.board).toBe("fed");
    expect(body.rows.map((row) => row.profile.handle)).toEqual(["Alice", "bob"]);
  });

  it("best dropper ranks everyone by usd from the frozen prices; an unpriced drop counts zero", async () => {
    const body = await board("?range=all&board=dropper");
    expect(body).toMatchObject({ board: "dropper", rankedBy: "usd", available: true });
    expect(body.note).toBeUndefined();
    // bob: 0.002 ETH at 2000 = 4.00. alice: 0.0003 ETH at 3000 = 0.90, plus 0.0005 ETH unpriced = 0.
    expect(body.rows.map((row) => [row.profile.handle, row.usd])).toEqual([
      ["bob", 4],
      ["Alice", 0.9],
    ]);
    expect(body.rows[0]?.rank).toBe(1);
  });

  it("GET /api/stats carries the same usd the boards rank, per chain and summed", async () => {
    const response = await harness.app.request("/api/stats?chain=all");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      usd: number;
      totals: { chainKey: string; usd: number | null }[];
    };
    // bob 4.00 plus alice 0.90, the unpriced drop zero: the best dropper board's numbers, added.
    expect(body.usd).toBe(4.9);
    expect(body.totals.find((t) => t.chainKey === "robinhood-testnet")?.usd).toBe(4.9);
  });

  it("best token counts token drops only: a kind project profile with ETH drops is not on it", async () => {
    // the kind no longer decides this board.
    // Token drops are in `test/token-boards.test.ts`; here every drop is native.
    await harness.deps.db
      .update(profiles)
      .set({ kind: "project" })
      .where(eq(profiles.xUserId, "2"));
    const body = await board("?range=all&board=project");
    expect(body).toMatchObject({ board: "project", rankedBy: "uniqueReceivers", available: true });
    expect(body.rows).toEqual([]);
  });

  it("most fed carries usd too, but ranks by wallets", async () => {
    const body = await board("?range=all");
    expect(body.rows.map((row) => [row.profile.handle, row.usd])).toEqual([
      ["Alice", 0.9],
      ["bob", 4],
    ]);
  });

  it("this week keeps only drops created in the last seven days", async () => {
    const body = await board("?range=week");
    expect(body.rows.map((row) => row.profile.handle)).toEqual(["Alice"]);
    expect(body.rows[0]?.rank).toBe(1);
  });

  it("24h keeps only drops created in the last 24 hours, the edge included", async () => {
    const body = await board("?range=day");
    expect(body.range).toBe("day");
    // alice's drop of exactly 24 hours ago counts; her 2 day old drop and bob's do not.
    expect(body.rows.map((row) => row.profile.handle)).toEqual(["Alice"]);
    expect(body.rows[0]).toMatchObject({
      rank: 1,
      dropCount: 1,
      uniqueReceivers: 2,
      totalWei: "300000000000000",
    });
  });

  it("24h counts by the drop's creation time, never by the claim time", async () => {
    // 1 second past 24 hours: the drop is out, whenever its claims landed.
    harness.setNow(new Date(NOW.getTime() + 1000));
    expect((await board("?range=day")).rows).toEqual([]);
  });

  it("refuses a range it does not know", async () => {
    for (const range of ["month", "24h", "DAY", ""]) {
      const response = await harness.app.request(`/api/boards?range=${range}`);
      expect(response.status, range).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_query" });
    }
  });

  it("defaults to this week and all kinds", async () => {
    const body = await board("");
    expect(body.range).toBe("week");
    expect(body.kind).toBe("all");
  });

  it("filters by profile kind, and a chad who never picked is on the chads board", async () => {
    const kols = await board("?range=all&kind=kol");
    expect(kols.rows.map((row) => row.profile.handle)).toEqual(["Alice"]);

    // bob's column is NULL. He reads as chad, the default, not as nobody.
    const chads = await board("?range=all&kind=chad");
    expect(chads.rows.map((row) => row.profile)).toEqual([
      expect.objectContaining({ handle: "bob", kind: "chad" }),
    ]);

    const projects = await board("?range=all&kind=project");
    expect(projects.rows).toEqual([]);
    // dev is gone; it was never set on anybody.
    expect((await harness.app.request("/api/boards?kind=dev")).status).toBe(400);
  });

  it("a row's profile carries the tags in order, never the old one tag field", async () => {
    await harness.deps.db
      .update(profiles)
      .set({ tags: ["kol", "nft", "dev"] })
      .where(eq(profiles.xUserId, "1"));
    const body = await board("?range=all");
    const alice = body.rows.find((row) => row.profile.handle === "Alice")?.profile;
    expect(alice).toMatchObject({ tags: ["kol", "nft", "dev"] });
    expect(alice).not.toHaveProperty("tag");
    expect(body.rows.find((row) => row.profile.handle === "bob")?.profile).toMatchObject({
      tags: [],
    });
  });

  it("never shows a drop it cannot attribute to a profile", async () => {
    const body = await board("?range=all");
    // The 0.009 ETH from commitment(99) would top the board. It is nowhere.
    expect(body.rows.some((row) => row.totalWei === "9000000000000000")).toBe(false);
  });

  it("rejects an unknown range, kind or board", async () => {
    expect((await harness.app.request("/api/boards?range=year")).status).toBe(400);
    expect((await harness.app.request("/api/boards?kind=whale")).status).toBe(400);
    expect((await harness.app.request("/api/boards?board=richest")).status).toBe(400);
  });

  it("answers 503 when the indexer is down", async () => {
    const down = await createHarness({ indexer: { down: true } });
    try {
      const response = await down.app.request("/api/boards");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "indexer_unavailable" });
    } finally {
      await down.close();
    }
  });

  it("needs no session: the board is public", async () => {
    expect((await harness.app.request("/api/boards")).status).toBe(200);
  });
});

interface UserBody {
  profile: { xUserId: string; handle: string; displayName: string; kind: string | null };
  totals: {
    available: boolean;
    finality: string;
    totalWei: string;
    dropCount: number;
    uniqueReceivers: number;
  };
  drops: { address: string; title: string | null; state: string; leafCount: number }[];
}

describe("GET /api/users/:handle", () => {
  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: INDEXED } });
    harness.setNow(NOW);
    await seed();
  });
  afterEach(() => harness.close());

  it("returns the profile, final totals, and the wall of that chad's drops, newest first", async () => {
    const response = await harness.app.request("/api/users/alice");
    expect(response.status).toBe(200);
    const body = (await response.json()) as UserBody;

    expect(body.profile).toMatchObject({ xUserId: "1", handle: "Alice", kind: "kol" });
    expect(body.totals).toMatchObject({
      available: true,
      finality: "final",
      totalWei: "800000000000000",
      dropCount: 2,
      uniqueReceivers: 3,
    });
    expect(body.drops.map((drop) => drop.address)).toEqual([addr(0x101), addr(0x102)]);
    expect(body.drops[0]).toMatchObject({ title: "drop 101", state: "finished", leafCount: 3 });
  });

  it("matches the handle case insensitively, because X does", async () => {
    expect((await harness.app.request("/api/users/ALICE")).status).toBe(200);
  });

  it("returns 404 for a handle nobody has signed in with", async () => {
    const response = await harness.app.request("/api/users/nobody");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("rejects a handle that is not an X handle shape", async () => {
    expect((await harness.app.request("/api/users/not%20a%20handle")).status).toBe(400);
  });

  it("still serves the profile and the wall when the indexer is down, totals marked unavailable", async () => {
    await harness.close();
    harness = await createHarness({ indexer: { down: true } });
    await seed();
    const body = (await (await harness.app.request("/api/users/bob")).json()) as UserBody;
    expect(body.profile.handle).toBe("bob");
    expect(body.totals).toMatchObject({ available: false });
    expect(body.drops).toHaveLength(1);
  });
});

/**
 * Boards rank claimed money, never funded. What a sender put
 * in is `totalEntitlements` on our row; the board reads the indexer's final claims and nothing
 * else. So a funded drop nobody claimed is worth nothing on every board and puts nobody on one,
 * and a half claimed drop is worth exactly the half that was claimed.
 */
describe("boards rank claimed money, never funded", () => {
  // carol: 10 ETH funded at 3000 usd, nobody claimed. dave: 10 ETH funded at 3000 usd, one wallet
  // claimed 0.0001 ETH of it. Both this week.
  const UNCLAIMED = {
    address: addr(0x401),
    creatorCommitment: commitment(4),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "0",
    claimedCountFinal: 0,
    recipients: [],
  };
  const HALF = {
    address: addr(0x501),
    creatorCommitment: commitment(5),
    createdAt: String(SECONDS - DAY),
    claimedFinalWei: "100000000000000",
    claimedCountFinal: 1,
    recipients: [addr(0xd1)],
    claimedIndexes: [0],
  };
  const FUNDED = "10000000000000000000";

  beforeEach(async () => {
    harness = await createHarness({ indexer: { boardDrops: [...INDEXED, UNCLAIMED, HALF] } });
    harness.setNow(NOW);
    await seed();
    await harness.deps.db.insert(profiles).values([
      { xUserId: "4", handle: "carol", displayName: "Carol", profileImageUrl: null },
      { xUserId: "5", handle: "dave", displayName: "Dave", profileImageUrl: null },
    ]);
    await harness.deps.db
      .insert(drops)
      .values([
        row(addr(0x401), "4", 0n, commitment(4), 1, "3000", FUNDED),
        row(addr(0x501), "5", 0n, commitment(5), 1, "3000", FUNDED),
      ]);
    await seedLeaves([addr(0x401), addr(0x501)]);
  });
  afterEach(() => harness.close());

  it("a funded drop nobody claimed puts the chad on no board", async () => {
    for (const type of ["fed", "dropper", "project"]) {
      const body = await board(`?range=all&board=${type}`);
      expect(
        body.rows.map((r) => r.profile.handle),
        type,
      ).not.toContain("carol");
    }
  });

  it("the unclaimed drop is not a drop on the profile totals either: zero usd, zero wallets, zero drops", async () => {
    const body = (await (await harness.app.request("/api/users/carol")).json()) as UserBody & {
      totals: { usd: number };
    };
    expect(body.totals).toMatchObject({
      available: true,
      usd: 0,
      uniqueReceivers: 0,
      dropCount: 0,
    });
    // The wall still shows the drop itself: it exists, it is just worth nothing yet.
    expect(body.drops.map((drop) => drop.address)).toEqual([addr(0x401)]);
  });

  it("a half claimed drop counts the claimed half only, on every board and on the profile", async () => {
    // 0.0001 ETH claimed at 3000 is 0.30 usd. The 10 ETH funded would be 30,000.
    const dropper = await board("?range=all&board=dropper");
    expect(dropper.rows.find((r) => r.profile.handle === "dave")).toMatchObject({
      usd: 0.3,
      totalWei: "100000000000000",
      uniqueReceivers: 1,
      biggestDropWei: "100000000000000",
    });
    // Funded 10 ETH, claimed 0.0001: dave ranks under bob's 4.00 and alice's 0.90.
    expect(dropper.rows.map((r) => r.profile.handle)).toEqual(["bob", "Alice", "dave"]);

    const fed = await board("?range=all&board=fed");
    expect(fed.rows.find((r) => r.profile.handle === "dave")?.uniqueReceivers).toBe(1);

    const user = (await (await harness.app.request("/api/users/dave")).json()) as UserBody & {
      totals: { usd: number };
    };
    expect(user.totals).toMatchObject({ usd: 0.3, totalWei: "100000000000000", dropCount: 1 });
  });

  it("the stats tile is claimed too: carol adds nothing, dave adds 0.30", async () => {
    const body = (await (await harness.app.request("/api/stats?chain=all")).json()) as {
      usd: number;
    };
    // 4.00 + 0.90 + 0.30. Not 30,000, not 60,000.
    expect(body.usd).toBe(5.2);
  });
});
