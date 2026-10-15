/**
 * `GET /api/drops/:address/share`, the share card, first version.
 * Handle drops only, the sender only, ready once live, what was dropped and on
 * how many people, the 3 biggest receivers. No text, no link, no image: the browser makes those.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { avatar400 } from "../src/drops/share.js";
import { dropHandleLeaves, drops, profiles, xUsers } from "../src/db/schema.js";
import { FAKE_CHAIN_ID } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

const DROP = "0x00000000000000000000000000000000000d0000";
const MULTISEND = "0x00000000000000000000000000000000000d0001";
/** The X id the harness login signs in as, `createXStub`. */
const SENDER = "1234567890";

let harness: Harness;

function row(address: string, overrides: Record<string, unknown> = {}) {
  return {
    address,
    mode: "handle" as const,
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: SENDER,
    nonce: BigInt(address.slice(-1)),
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "500000000000000000",
    feeAmount: "0",
    grossRequired: "500000000000000000",
    leafCount: 5,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    state: "active",
    createTxHash: `0x${"55".repeat(32)}`,
    ...overrides,
  };
}

/** Five people. Two tie at the top (index order wins), one has no `x_users` row. */
const LEAVES = [
  { xUserId: "901", amount: "50000000000000000" },
  { xUserId: "902", amount: "150000000000000000" },
  { xUserId: "903", amount: "150000000000000000" },
  { xUserId: "904", amount: "100000000000000000" },
  { xUserId: "905", amount: "50000000000000000" },
];

/** The senders, as the harness login writes them; a drop row needs its sender's profile. */
async function senders(): Promise<void> {
  await harness.deps.db
    .insert(profiles)
    .values([
      {
        xUserId: SENDER,
        handle: "dropchadfun",
        displayName: "dropchad",
        profileImageUrl: "https://pbs.twimg.com/profile_images/1/avatar.png",
      },
      { xUserId: "777", handle: "someoneelse", displayName: "Someone", profileImageUrl: null },
    ])
    .onConflictDoNothing();
}

async function seed(overrides: Record<string, unknown> = {}): Promise<void> {
  const db = harness.deps.db;
  await senders();
  await db.insert(drops).values([row(DROP, overrides), row(MULTISEND, { mode: "address" })]);
  await db
    .insert(dropHandleLeaves)
    .values(LEAVES.map((leaf, leafIndex) => ({ dropAddress: DROP, leafIndex, ...leaf })));
  await db.insert(xUsers).values([
    {
      xUserId: "901",
      handle: "alice",
      displayName: "Alice",
      profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_normal.jpg",
    },
    { xUserId: "902", handle: "bob", displayName: "Bob", profileImageUrl: null },
    {
      xUserId: "903",
      handle: "carol",
      displayName: "Carol",
      profileImageUrl: "https://pbs.twimg.com/profile_images/9/carol_normal.png",
    },
    // 904, the third biggest, has no row: it is not shown and counts in `rest`.
    // Erin has a picture, but she is the fourth: pictures go on the first 3 only.
    {
      xUserId: "905",
      handle: "erin",
      displayName: "Erin",
      profileImageUrl: "https://pbs.twimg.com/profile_images/9/erin_normal.jpg",
    },
  ]);
}

async function asSender(path: string): Promise<Response> {
  const { jar } = await login(harness);
  return harness.app.request(path, { headers: { cookie: cookieHeader(jar) } });
}

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

describe("who gets the card", () => {
  it("a junk address is 400, a drop we did not create is 404, before any session check", async () => {
    expect((await harness.app.request("/api/drops/nope/share")).status).toBe(400);
    const unknown = await harness.app.request(
      "/api/drops/0x000000000000000000000000000000000000dead/share",
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
  });

  it("a multisend has no share card, signed in or not", async () => {
    await seed();
    const open = await harness.app.request(`/api/drops/${MULTISEND}/share`);
    expect(open.status).toBe(404);
    expect(await open.json()).toEqual({ error: "no_share_card" });
    const signedIn = await asSender(`/api/drops/${MULTISEND}/share`);
    expect(signedIn.status).toBe(404);
  });

  it("signed out is 401", async () => {
    await seed();
    const response = await harness.app.request(`/api/drops/${DROP}/share`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("someone who is not the sender is 403 not_yours", async () => {
    await seed({ xUserId: "777" });
    const response = await asSender(`/api/drops/${DROP}/share`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_yours" });
  });
});

describe("when the card is ready", () => {
  for (const state of ["created", "funded", "funding_expired"]) {
    it(`not before the drop is live: ${state} is 409 not_live`, async () => {
      await seed({ state });
      const response = await asSender(`/api/drops/${DROP}/share`);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "not_live" });
    });
  }

  for (const state of ["active", "paying", "finished", "claims_expired"]) {
    it(`ready once funded and live: ${state}`, async () => {
      await seed({ state });
      expect((await asSender(`/api/drops/${DROP}/share`)).status).toBe(200);
    });
  }
});

describe("what the card says", () => {
  it("what was dropped and on how many people, the sender, every receiver biggest first", async () => {
    await seed({ state: "paying", paidCount: 1 });
    const response = await asSender(`/api/drops/${DROP}/share`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chainKey: "robinhood-testnet",
      symbol: "ETH",
      decimals: 18,
      // An ETH drop has no token.
      token: null,
      // What was dropped, never what was claimed.
      amount: "500000000000000000",
      people: 5,
      sender: {
        handle: "dropchadfun",
        profileImageUrl: "https://pbs.twimg.com/profile_images/1/avatar.png",
      },
      // 902 and 903 tie at 0.15, index order; 904 has no x_users row; then 901 and 905 at
      // 0.05, index order. Every receiver is listed, pictures on the first 3 only.
      receivers: [
        { handle: "bob", profileImageUrl: null },
        {
          handle: "carol",
          profileImageUrl: "https://pbs.twimg.com/profile_images/9/carol_400x400.png",
        },
        {
          handle: "alice",
          profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_400x400.jpg",
        },
        { handle: "erin", profileImageUrl: null },
      ],
      rest: 1,
      // No frozen price on this drop: no stamp.
      rank: null,
    });
  });

  it("no text, no link, no image in the answer: the browser makes those", async () => {
    await seed();
    const body = (await (await asSender(`/api/drops/${DROP}/share`)).json()) as Record<
      string,
      unknown
    >;
    for (const key of ["text", "url", "intentUrl", "cardImageUrl", "placeholderCard"]) {
      expect(body, key).not.toHaveProperty(key);
    }
  });

  it("a drop with fewer than 3 people shows them all and rest 0", async () => {
    const db = harness.deps.db;
    await senders();
    await db.insert(drops).values(row(DROP, { leafCount: 1 }));
    await db
      .insert(dropHandleLeaves)
      .values({ dropAddress: DROP, leafIndex: 0, xUserId: "901", amount: "500000000000000000" });
    await db
      .insert(xUsers)
      .values({ xUserId: "901", handle: "alice", displayName: "Alice", profileImageUrl: null });
    const body = (await (await asSender(`/api/drops/${DROP}/share`)).json()) as {
      receivers: unknown[];
      rest: number;
      people: number;
    };
    expect(body.people).toBe(1);
    expect(body.receivers).toEqual([{ handle: "alice", profileImageUrl: null }]);
    expect(body.rest).toBe(0);
  });

  it("the sender's own profile row is the one on the card", async () => {
    await seed();
    const { jar } = await login(harness);
    await harness.deps.db.update(profiles).set({
      handle: "samplechad",
      profileImageUrl: "https://pbs.twimg.com/profile_images/2/e_normal.jpg",
    });
    const body = (await (
      await harness.app.request(`/api/drops/${DROP}/share`, {
        headers: { cookie: cookieHeader(jar) },
      })
    ).json()) as { sender: unknown };
    expect(body.sender).toEqual({
      handle: "samplechad",
      profileImageUrl: "https://pbs.twimg.com/profile_images/2/e_400x400.jpg",
    });
  });
});

describe("the rank stamp, from the usd value at the frozen price", () => {
  // 0.5 ETH on every drop here; the price is per coin.
  const cases: [string | null, string | null][] = [
    ["150", "chad"], // 75 usd
    ["199.99", "chad"], // just under 100
    ["200", "gigachad"], // 100 exactly
    ["1999.99", "gigachad"], // just under 1,000
    ["2000", "whale"], // 1,000 exactly
    ["3000", "whale"], // 1,500
    [null, null], // no price, no stamp
  ];
  for (const [priceUsd, rank] of cases) {
    it(`price ${String(priceUsd)} is ${String(rank)}`, async () => {
      await seed({ priceUsd });
      const body = (await (await asSender(`/api/drops/${DROP}/share`)).json()) as Record<
        string,
        unknown
      >;
      expect(body["rank"]).toBe(rank);
    });
  }

  it("the usd number never leaves the api, only the word", async () => {
    await seed({ priceUsd: "3000" });
    const text = await (await asSender(`/api/drops/${DROP}/share`)).text();
    expect(text).not.toMatch(/usd|price|1500/i);
  });
});

describe("avatar400", () => {
  it("swaps X's 48px _normal for the 400px size", () => {
    expect(avatar400("https://pbs.twimg.com/profile_images/1/abc_normal.jpg")).toBe(
      "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
    );
    expect(avatar400("https://pbs.twimg.com/profile_images/1/abc_normal.png")).toBe(
      "https://pbs.twimg.com/profile_images/1/abc_400x400.png",
    );
  });

  it("any other url as it is, and null stays null", () => {
    expect(avatar400("https://pbs.twimg.com/profile_images/1/avatar.png")).toBe(
      "https://pbs.twimg.com/profile_images/1/avatar.png",
    );
    expect(avatar400(null)).toBeNull();
  });
});
