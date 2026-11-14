/**
 * A GIF on a drop
 * - `POST /api/drops` takes an optional `giphy: { id, kind }` on a handle drop; the id is 1 to 40
 *   letters and digits, the kind `gif` or `sticker`; anything else is `400 invalid_body`
 * - never on a multisend; no `memeImageUrl`, any value
 * - only `giphy_id` and `giphy_kind` are stored, migration `0027`: both null or both set
 * - the drop detail sends `ours.data.giphy`; no answer carries `memeImageUrl`; the list card
 *   carries neither
 */
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { ownDropCard } from "../src/drops/card.js";
import { drops } from "../src/db/schema.js";
import { createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV } from "./test-binders.js";

const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const ALICE = { id: "44196397", username: "alice", name: "alice" };
/** The signed in user of the harness X stub. */
const SELF = { id: "1234567890", username: "dropchadfun", name: "dropchad" };
/** A real GIPHY id, letters and digits. */
const GIF_ID = "3og0IV5cAmtbkeKPBe";

let harness: Harness;
let chain: FakeChain;

afterEach(async () => {
  await harness.close();
});

async function signedIn(): Promise<Record<string, string>> {
  chain = createFakeChain();
  const adapter = { ...evmAdapterFor(chain), handleModeReady: () => Promise.resolve(true) };
  harness = await createHarness({
    writeSides: singleAdapter(adapter),
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV },
    xLookup: [ALICE, SELF],
  });
  const { jar } = await login(harness);
  return {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

const post = (headers: Record<string, string>, body: unknown) =>
  harness.app.request("/api/drops", { method: "POST", headers, body: JSON.stringify(body) });

const handleBody = (extra: Record<string, unknown> = {}) => ({
  mode: "handle",
  handles: [{ handle: "alice", amount: "10000000000000", xUserId: ALICE.id }],
  refundRecipient: REFUND,
  ...extra,
});

const multisendBody = (extra: Record<string, unknown> = {}) => ({
  mode: "address",
  receivers: [{ address: A, amount: "10000000000000" }],
  refundRecipient: REFUND,
  ...extra,
});

/** Nothing was written and nothing went to the chain. */
async function nothingCreated(): Promise<void> {
  expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
  expect(chain.creates).toHaveLength(0);
}

describe("POST /api/drops, the GIF", () => {
  it("stores a gif's id and kind on a handle drop", async () => {
    const headers = await signedIn();
    const res = await post(headers, handleBody({ giphy: { id: GIF_ID, kind: "gif" } }));
    expect(res.status, await res.clone().text()).toBe(201);
    const [row] = await harness.deps.db.select().from(drops);
    expect(row?.giphyId).toBe(GIF_ID);
    expect(row?.giphyKind).toBe("gif");
  });

  it("stores a sticker, and an id of 40 characters", async () => {
    const headers = await signedIn();
    const id = "aB3".repeat(13) + "z";
    expect(id).toHaveLength(40);
    const res = await post(headers, handleBody({ giphy: { id, kind: "sticker" } }));
    expect(res.status, await res.clone().text()).toBe(201);
    const [row] = await harness.deps.db.select().from(drops);
    expect(row?.giphyId).toBe(id);
    expect(row?.giphyKind).toBe("sticker");
  });

  it("no GIF: both columns are null", async () => {
    const headers = await signedIn();
    expect((await post(headers, handleBody())).status).toBe(201);
    const [row] = await harness.deps.db.select().from(drops);
    expect(row?.giphyId).toBeNull();
    expect(row?.giphyKind).toBeNull();
  });

  const bad: [string, unknown][] = [
    ["an empty id", { id: "", kind: "gif" }],
    ["an id of 41 characters", { id: "a".repeat(41), kind: "gif" }],
    ["an id with a slash", { id: "abc/def", kind: "gif" }],
    ["an id with a dot", { id: "abc.gif", kind: "gif" }],
    ["an id with a space", { id: "abc def", kind: "gif" }],
    ["an id with a dash", { id: "abc-def", kind: "gif" }],
    [
      "an id that is a url",
      { id: `https://media.giphy.com/media/${GIF_ID}/giphy.gif`, kind: "gif" },
    ],
    ["an id that is a number", { id: 12345, kind: "gif" }],
    ["a kind that is not gif or sticker", { id: GIF_ID, kind: "clip" }],
    ["no kind", { id: GIF_ID }],
    ["no id", { kind: "gif" }],
    ["a url next to the id", { id: GIF_ID, kind: "gif", url: "https://media.giphy.com/x.gif" }],
    ["a string instead of an object", GIF_ID],
    ["null", null],
  ];
  for (const [name, giphy] of bad) {
    it(`refuses ${name}, 400 invalid_body, nothing created`, async () => {
      const headers = await signedIn();
      const res = await post(headers, handleBody({ giphy }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_body" });
      await nothingCreated();
    });
  }

  it("refuses a GIF on a multisend, 400 invalid_body, nothing created", async () => {
    const headers = await signedIn();
    const res = await post(headers, multisendBody({ giphy: { id: GIF_ID, kind: "gif" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
    await nothingCreated();
  });
});

describe("POST /api/drops, no picture link", () => {
  for (const [mode, body] of [
    ["a handle drop", handleBody],
    ["a multisend", multisendBody],
  ] as const) {
    it(`refuses memeImageUrl on ${mode}, an https link too`, async () => {
      const headers = await signedIn();
      const res = await post(headers, body({ memeImageUrl: "https://example.com/chad.png" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_body" });
      await nothingCreated();
    });
  }

  it("the create answer carries no memeImageUrl", async () => {
    const headers = await signedIn();
    const res = await post(headers, handleBody({ giphy: { id: GIF_ID, kind: "gif" } }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { drop: Record<string, unknown> };
    expect(body.drop).not.toHaveProperty("memeImageUrl");
  });
});

describe("what the api sends", () => {
  async function created(giphy?: { id: string; kind: string }): Promise<string> {
    const headers = await signedIn();
    const res = await post(headers, handleBody(giphy === undefined ? {} : { giphy }));
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { drop: { address: string } }).drop.address;
  }

  async function detail(address: string): Promise<Record<string, unknown>> {
    const res = await harness.app.request(`/api/drops/${address}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ours: { data: Record<string, unknown> | null } };
    expect(body.ours.data).not.toBeNull();
    return body.ours.data ?? {};
  }

  it("the drop detail sends ours.data.giphy, the id and the kind only", async () => {
    const address = await created({ id: GIF_ID, kind: "sticker" });
    const data = await detail(address);
    expect(data["giphy"]).toEqual({ id: GIF_ID, kind: "sticker" });
    expect(data).not.toHaveProperty("memeImageUrl");
  });

  it("the drop detail sends giphy null when the drop has none", async () => {
    const address = await created();
    const data = await detail(address);
    expect(data["giphy"]).toBeNull();
    expect(data).not.toHaveProperty("memeImageUrl");
  });

  it("the list card, GET /api/drops and GET /api/users/:handle, carries no GIF and no picture link", async () => {
    await created({ id: GIF_ID, kind: "gif" });
    // An old row with a picture link: the column stays and is never read again.
    await harness.deps.db.execute(
      sql`UPDATE drops SET meme_image_url = 'https://example.com/old.png'`,
    );
    const [row] = await harness.deps.db.select().from(drops);
    expect(row).toBeDefined();
    if (row === undefined) return;
    const card = ownDropCard(row, null) as unknown as Record<string, unknown>;
    expect(card).not.toHaveProperty("giphy");
    expect(card).not.toHaveProperty("giphyId");
    expect(card).not.toHaveProperty("giphyKind");
    expect(card).not.toHaveProperty("memeImageUrl");
  });
});

describe("migration 0027", () => {
  it("giphy_id and giphy_kind are both null or both set, the kind gif or sticker", async () => {
    const headers = await signedIn();
    expect((await post(headers, handleBody())).status).toBe(201);
    const db = harness.deps.db;

    await expect(db.execute(sql`UPDATE drops SET giphy_id = ${GIF_ID}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE drops SET giphy_kind = 'gif'`)).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE drops SET giphy_id = ${GIF_ID}, giphy_kind = 'clip'`),
    ).rejects.toThrow();

    await db.execute(sql`UPDATE drops SET giphy_id = ${GIF_ID}, giphy_kind = 'sticker'`);
    const [row] = await db.select().from(drops);
    expect(row?.giphyId).toBe(GIF_ID);
    expect(row?.giphyKind).toBe("sticker");
  });
});
