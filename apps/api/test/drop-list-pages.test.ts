/**
 * `GET /api/drops?page=`, the same rules as the other lists: 10 drops a page,
 * newest first, `page`, `pageSize` and `total` in the answer; a page past the end is the last
 * page; a bad `page` is `400 invalid_query`. Only the drops of that page get their chain reads.
 * `chain=` filters in the api. Without `page` the list is as before, the newest `limit`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { drops, profiles } from "../src/db/schema.js";
import { createHarness, type Harness } from "./harness.js";

let harness: Harness;

afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.close();
});

const NOW = new Date("2026-09-29T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const commitment = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

/** Our `drops` row for an EVM drop number `n`, made `n` minutes before `NOW`. */
const row = (n: number, mode: "address" | "handle" = "handle") => ({
  address: addr(0x1000 + n),
  mode,
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId: "1",
  nonce: BigInt(n),
  creatorCommitment: commitment(0x1000 + n),
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
  createdAt: new Date(NOW.getTime() - n * 60_000),
});

const indexed = (n: number) => ({
  address: addr(0x1000 + n),
  chainId: 46630,
  status: "Active",
  totalEntitlements: "10000000000000000",
  leafCount: 3,
  claimedCount: 1,
  createdAt: String(SECONDS - n * 60),
  finality: "final",
});

/** 23 handle drops, drop 1 the newest, and 2 multisends that must never count. */
async function world(): Promise<void> {
  const handles = Array.from({ length: 23 }, (_, i) => i + 1);
  const multisends = [24, 25];
  const byAddress = Object.fromEntries(
    [...handles, ...multisends].map((n) => [addr(0x1000 + n), indexed(n)]),
  );
  harness = await createHarness({ indexer: { dropsByAddress: byAddress } });
  harness.setNow(NOW);
  await harness.deps.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null });
  await harness.deps.db
    .insert(drops)
    .values([...handles.map((n) => row(n)), ...multisends.map((n) => row(n, "address"))]);
}

interface PageBody {
  page?: number;
  pageSize?: number;
  total?: number;
  drops: { address: string }[];
}

async function list(query: string): Promise<PageBody> {
  const response = await harness.app.request(`/api/drops${query}`);
  expect(response.status, query).toBe(200);
  return (await response.json()) as PageBody;
}

/** Drop numbers of a page, from the addresses. */
const numbers = (body: PageBody) =>
  body.drops.map((d) => Number.parseInt(d.address.slice(-4), 16) - 0x1000);

describe("GET /api/drops pages of 10", () => {
  it("page 1: the 10 newest handle drops, and the total of every listed drop", async () => {
    await world();
    const body = await list("?page=1&chain=all");
    expect(body).toMatchObject({ page: 1, pageSize: 10, total: 23 });
    expect(numbers(body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("page 2 and page 3 go on, older each time; the multisends never count", async () => {
    await world();
    expect(numbers(await list("?page=2"))).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const three = await list("?page=3");
    expect(three).toMatchObject({ page: 3, total: 23 });
    expect(numbers(three)).toEqual([21, 22, 23]);
  });

  it("a page past the end answers the last page, never an empty one", async () => {
    await world();
    const body = await list("?page=9");
    expect(body.page).toBe(3);
    expect(numbers(body)).toEqual([21, 22, 23]);
  });

  it("a page that is not a whole number from 1 is 400 invalid_query", async () => {
    await world();
    for (const page of ["0", "-1", "abc", "1.5", ""]) {
      const response = await harness.app.request(`/api/drops?page=${page}`);
      expect(response.status, page).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_query" });
    }
  });

  it("only the drops of that page are read from the indexer", async () => {
    await world();
    const getDrop = vi.spyOn(harness.deps.indexer, "getDrop");
    await list("?page=2");
    expect(getDrop).toHaveBeenCalledTimes(10);
    const asked = getDrop.mock.calls.map(([address]) => address.toLowerCase());
    expect(asked).toContain(addr(0x1000 + 11));
    expect(asked).not.toContain(addr(0x1000 + 1));
  });

  it("chain= filters in the api: robinhood testnet has them all, devnet none", async () => {
    await world();
    expect(await list("?page=1&chain=robinhood-testnet")).toMatchObject({ total: 23 });
    const devnet = await list("?page=1&chain=solana-devnet");
    expect(devnet).toMatchObject({ page: 1, total: 0, drops: [] });
  });

  it("without page the list is as before: the newest limit, no page fields", async () => {
    await world();
    const body = await list("?limit=5");
    expect(numbers(body)).toEqual([1, 2, 3, 4, 5]);
    expect(body.page).toBeUndefined();
    expect(body.total).toBeUndefined();
  });
});
