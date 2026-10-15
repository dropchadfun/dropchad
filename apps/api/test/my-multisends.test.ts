/**
 * `GET /api/me/multisends`: the signed in sender's
 * own multisends, and nobody else's.
 *
 * - no session or a dead one: `401 unauthorized`
 * - only `mode = address` drops whose `x_user_id` is the session's X id; never a handle drop,
 *   never another account's multisend
 * - newest first, at most 100
 * - each row carries no handle, no name and no X id
 * - rate limited like `GET /api/claims`, 30 a minute; `cache-control: private, no-store`
 *
 * Every other door still names no sender of a multisend: `multisend-privacy.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { drops, profiles } from "../src/db/schema.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

let harness: Harness;

// The harness X stub signs in as this account, `createXStub`.
const ME = { xUserId: "1234567890", handle: "dropchadfun" };
const SECRET = { xUserId: "777000111222", handle: "secretsender" };

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const MY_OLD = addr(0x601);
const MY_NEW = addr(0x602);
const MY_HANDLE_DROP = addr(0x603);
const SECRET_MULTISEND = addr(0x604);

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

const row = (
  address: string,
  xUserId: string,
  mode: "address" | "handle",
  createdAt: Date,
  extra: Partial<typeof drops.$inferInsert> = {},
) => ({
  address,
  mode,
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId,
  nonce: BigInt(Number.parseInt(address.slice(-4), 16)),
  creatorCommitment: `0x${address.slice(-4).padStart(64, "0")}`,
  salt: `0x${"22".repeat(32)}`,
  asset: "0x0000000000000000000000000000000000000000",
  merkleRoot: `0x${"33".repeat(32)}`,
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: "{}",
  totalEntitlements: "10000000000000000",
  feeAmount: "0",
  grossRequired: "10000000000000000",
  leafCount: 1,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: 1_800_000_000n,
  claimPeriod: 604_800,
  state: "created",
  paidCount: 0,
  createTxHash: `0x${"55".repeat(32)}`,
  createdAt,
  ...extra,
});

beforeEach(async () => {
  harness = await createHarness();
  await harness.deps.db.insert(profiles).values([
    {
      xUserId: SECRET.xUserId,
      handle: SECRET.handle,
      displayName: "Secret Sender",
      profileImageUrl: null,
    },
    // The login below upserts this row; the drops need it first.
    { xUserId: ME.xUserId, handle: ME.handle, displayName: "dropchad", profileImageUrl: null },
  ]);
});
afterEach(() => harness.close());

async function signedIn(): Promise<string> {
  const { jar } = await login(harness);
  return cookieHeader(jar);
}

const list = (cookie?: string) =>
  harness.app.request("/api/me/multisends", { headers: cookie === undefined ? {} : { cookie } });

interface Row {
  address: string;
  chainKey: string;
  title: string | null;
  asset: string;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  totalEntitlements: string;
  leafCount: number;
  paidCount: number;
  state: string;
  createdAt: string;
}

describe("GET /api/me/multisends", () => {
  it("is 401 signed out and with a cookie that is no session", async () => {
    const out = await list();
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ error: "unauthorized" });
    expect((await list("dc_session=not-a-session")).status).toBe(401);
  });

  it("lists only my multisends, newest first: never a handle drop, never someone else's", async () => {
    await harness.deps.db.insert(drops).values([
      row(MY_OLD, ME.xUserId, "address", new Date(T0)),
      row(MY_NEW, ME.xUserId, "address", new Date(T0 + 60_000), {
        chainId: 103,
        chainKey: "solana-devnet",
        title: "rent split",
        totalEntitlements: "120000000",
        leafCount: 12,
        paidCount: 7,
        state: "paying",
      }),
      row(MY_HANDLE_DROP, ME.xUserId, "handle", new Date(T0 + 120_000)),
      row(SECRET_MULTISEND, SECRET.xUserId, "address", new Date(T0 + 180_000)),
    ]);
    const res = await list(await signedIn());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { multisends: Row[] };
    expect(body.multisends.map((r) => r.address)).toEqual([MY_NEW, MY_OLD]);
    expect(body.multisends[0]).toEqual({
      address: MY_NEW,
      chainKey: "solana-devnet",
      title: "rent split",
      asset: "0x0000000000000000000000000000000000000000",
      tokenSymbol: null,
      tokenDecimals: null,
      totalEntitlements: "120000000",
      leafCount: 12,
      paidCount: 7,
      state: "paying",
      createdAt: new Date(T0 + 60_000).toISOString(),
    });
  });

  it("names nobody: no X id, no handle, no display name", async () => {
    await harness.deps.db.insert(drops).values([row(MY_OLD, ME.xUserId, "address", new Date(T0))]);
    const text = await (await list(await signedIn())).text();
    expect(text).not.toContain(ME.xUserId);
    expect(text).not.toContain(ME.handle);
    expect(text).not.toContain(SECRET.xUserId);
  });

  it("an account with none gets an empty list", async () => {
    await harness.deps.db
      .insert(drops)
      .values([row(SECRET_MULTISEND, SECRET.xUserId, "address", new Date(T0))]);
    const res = await list(await signedIn());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ multisends: [] });
  });

  it("gives at most the newest 100", async () => {
    await harness.deps.db
      .insert(drops)
      .values(
        Array.from({ length: 101 }, (_, i) =>
          row(addr(0x1000 + i), ME.xUserId, "address", new Date(T0 + i * 1000)),
        ),
      );
    const body = (await (await list(await signedIn())).json()) as { multisends: Row[] };
    expect(body.multisends).toHaveLength(100);
    expect(body.multisends[0]?.address).toBe(addr(0x1000 + 100));
    expect(body.multisends.at(-1)?.address).toBe(addr(0x1000 + 1));
  });

  it("is private and never cached", async () => {
    const res = await list(await signedIn());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is rate limited, 30 a minute", async () => {
    const cookie = await signedIn();
    for (let i = 0; i < 30; i += 1) expect((await list(cookie)).status).toBe(200);
    expect((await list(cookie)).status).toBe(429);
  });
});
