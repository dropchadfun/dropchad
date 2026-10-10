/**
 * a multisend is on no public list.
 *
 * `GET /api/drops` feeds `live now` and latest drops on the front page. It lists handle drops
 * only, built from our own rows on both chains, newest first. The EVM half takes the chain side
 * of each row from the indexer, one `getDrop` per row. The indexer's own list is never read: its
 * newest rows are all multisend today, so filtering them would leave nothing even once handle
 * drops exist. A drop we did not create is not listed. The Solana half is in `svm-read.test.ts`.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { drops, profiles } from "../src/db/schema.js";
import { createHarness, type Harness, type IndexerStubOptions } from "./harness.js";

let harness: Harness;

afterEach(async () => {
  await harness?.close();
});

const NOW = new Date("2026-09-29T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const OLD_HANDLE = addr(0x101);
const NEW_HANDLE = addr(0x102);
const MULTISEND = addr(0x103);
const NEWEST_HANDLE = addr(0x104);
const NOT_OURS = addr(0x1ff);

/** Our `drops` row for an EVM drop, created `ageSeconds` before `NOW`. */
const row = (address: string, mode: "address" | "handle", ageSeconds: number) => ({
  address,
  mode,
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId: "1",
  nonce: BigInt(Number.parseInt(address.slice(-3), 16)),
  creatorCommitment: commitment(Number.parseInt(address.slice(-3), 16)),
  salt: `0x${"22".repeat(32)}`,
  asset: "0x0000000000000000000000000000000000000000",
  merkleRoot: `0x${"33".repeat(32)}`,
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: "{}",
  totalEntitlements: "10000000000000000",
  feeAmount: "0",
  grossRequired: "10000000000000000",
  leafCount: 3,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: 1_800_000_000n,
  claimPeriod: 2_592_000,
  state: "active",
  paidCount: 1,
  createTxHash: `0x${"55".repeat(32)}`,
  createdAt: new Date(NOW.getTime() - ageSeconds * 1000),
});

/** What the indexer holds for a drop, as `getDrop` answers under `drop`. */
const indexed = (address: string, ageSeconds: number) => ({
  address,
  chainId: 46630,
  status: "Active",
  totalEntitlements: "10000000000000000",
  leafCount: 3,
  claimedCount: 1,
  createdAt: String(SECONDS - ageSeconds),
  finality: "final",
});

async function world(
  rows: ReturnType<typeof row>[],
  indexer: IndexerStubOptions = {},
): Promise<void> {
  harness = await createHarness({ indexer });
  harness.setNow(NOW);
  await harness.deps.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null });
  if (rows.length > 0) await harness.deps.db.insert(drops).values(rows);
}

/** Every drop the indexer knows, by lowercase address. */
const EVERY_INDEXED = {
  [OLD_HANDLE]: indexed(OLD_HANDLE, 300),
  [NEW_HANDLE]: indexed(NEW_HANDLE, 200),
  [MULTISEND]: indexed(MULTISEND, 100),
  [NOT_OURS]: indexed(NOT_OURS, 50),
};

interface ListBody {
  drops: { address: string; source: string; claimedCount?: number; dropchad: unknown }[];
  sources: { indexer: { available: boolean } };
}

async function list(path = "/api/drops"): Promise<ListBody> {
  const response = await harness.app.request(path);
  expect(response.status, path).toBe(200);
  return (await response.json()) as ListBody;
}

describe("GET /api/drops lists handle drops only.", () => {
  it("leaves a multisend out, and a drop we did not create", async () => {
    await world(
      [
        row(OLD_HANDLE, "handle", 300),
        row(NEW_HANDLE, "handle", 200),
        row(MULTISEND, "address", 100),
      ],
      {
        // The indexer's own list is newest first and full of what must not show.
        drops: { drops: [EVERY_INDEXED[NOT_OURS], EVERY_INDEXED[MULTISEND]] },
        dropsByAddress: EVERY_INDEXED,
      },
    );
    const body = await list();
    expect(body.drops.map((d) => d.address)).toEqual([NEW_HANDLE, OLD_HANDLE]);
  });

  it("each entry is the indexer's chain side next to our handle card", async () => {
    await world([row(NEW_HANDLE, "handle", 200)], { dropsByAddress: EVERY_INDEXED });
    const body = await list();
    expect(body.drops).toHaveLength(1);
    expect(body.drops[0]).toMatchObject({
      address: NEW_HANDLE,
      source: "indexer",
      status: "Active",
      claimedCount: 1,
      dropchad: { mode: "handle", state: "active", creator: { handle: "alice" } },
    });
    expect(body.sources.indexer.available).toBe(true);
  });

  it("the creator carries the tags in order, never the old one tag field", async () => {
    await world([row(NEW_HANDLE, "handle", 200)], { dropsByAddress: EVERY_INDEXED });
    await harness.deps.db
      .update(profiles)
      .set({ tags: ["streamer", "dev"] })
      .where(eq(profiles.xUserId, "1"));
    const card = (await list()).drops[0]?.dropchad as { creator: Record<string, unknown> };
    const creator = card.creator;
    expect(creator).toMatchObject({ handle: "alice", tags: ["streamer", "dev"] });
    expect(creator).not.toHaveProperty("tag");
  });

  it("finds handle drops even when the indexer's newest rows are all multisend", async () => {
    // Fifty multisends newer than the one handle drop: the old list, the indexer's newest 50
    // filtered, would come back empty.
    const multisends = Array.from({ length: 50 }, (_, i) =>
      row(addr(0x300 + i), "address", 10 + i),
    );
    await world([...multisends, row(OLD_HANDLE, "handle", 300)], {
      drops: { drops: multisends.map((m) => indexed(m.address, 10)) },
      dropsByAddress: EVERY_INDEXED,
    });
    expect((await list()).drops.map((d) => d.address)).toEqual([OLD_HANDLE]);
  });

  it("takes the newest handle drops first and cuts at the limit", async () => {
    await world(
      [
        row(OLD_HANDLE, "handle", 300),
        row(NEW_HANDLE, "handle", 200),
        row(MULTISEND, "address", 100),
        row(NEWEST_HANDLE, "handle", 20),
      ],
      { dropsByAddress: { ...EVERY_INDEXED, [NEWEST_HANDLE]: indexed(NEWEST_HANDLE, 20) } },
    );
    expect((await list("/api/drops?limit=2")).drops.map((d) => d.address)).toEqual([
      NEWEST_HANDLE,
      NEW_HANDLE,
    ]);
  });

  it("a handle drop the indexer has not seen yet is left out, not an error", async () => {
    // Created a second ago: in our table, not yet in the indexer. It shows once it is indexed.
    await world([row(OLD_HANDLE, "handle", 300), row(NEWEST_HANDLE, "handle", 1)], {
      dropsByAddress: EVERY_INDEXED,
    });
    expect((await list()).drops.map((d) => d.address)).toEqual([OLD_HANDLE]);
  });

  it("is empty while no handle drop exists", async () => {
    await world([row(MULTISEND, "address", 100)], {
      drops: { drops: [EVERY_INDEXED[MULTISEND], EVERY_INDEXED[NOT_OURS]] },
      dropsByAddress: EVERY_INDEXED,
    });
    expect((await list()).drops).toEqual([]);
  });

  it("still answers 503 when the indexer is down and an EVM handle drop needs it", async () => {
    await world([row(OLD_HANDLE, "handle", 300)], { down: true });
    const response = await harness.app.request("/api/drops");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "indexer_unavailable" });
  });
});
