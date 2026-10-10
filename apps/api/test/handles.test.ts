/**
 * The handle resolver and `POST /api/handles/resolve`.
 * a handle maps to an X id through `x_handle_lookups`, refreshed after 7 days; the X id to
 * profile cache in `x_users` stays forever; at most 500 handles per drop; at most
 * `HANDLE_LOOKUPS_DAILY_MAX` paid lookups a day, charged before the call.
 *
 * X is a stubbed `fetch`. No test here calls the real X API.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { xHandleLookups, xUsers } from "../src/db/schema.js";
import {
  HANDLE_REFRESH_MS,
  HandleResolveError,
  normalizeHandle,
  resolveHandles,
} from "../src/x/resolver.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV } from "./test-binders.js";

const BEARER = "test-app-bearer-token-do-not-log";
const T0 = new Date("2026-09-28T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

interface XUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
}

/** A fake `GET /2/users/by`. Records every call; `status` forces a failure. */
function fakeX(users: XUser[], status?: number) {
  const calls: { url: URL; auth: string | null }[] = [];
  const byLower = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (status !== undefined) return Promise.resolve(new Response("{}", { status }));
    const names = (url.searchParams.get("usernames") ?? "").split(",");
    const data = names.map((n) => byLower.get(n.toLowerCase())).filter((u) => u !== undefined);
    const errors = names
      .filter((n) => !byLower.has(n.toLowerCase()))
      .map((n) => ({
        value: n,
        detail: `Could not find user with usernames: [${n}].`,
        title: "Not Found Error",
      }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ...(data.length > 0 ? { data } : {}),
          ...(errors.length > 0 ? { errors } : {}),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };
  return { calls, fetchImpl };
}

const ALICE: XUser = {
  id: "44196397",
  username: "Alice",
  name: "alice",
  profile_image_url: "https://pbs.twimg.com/a.png",
};
const BOB: XUser = { id: "1600000000000000000", username: "bob_2", name: "Bob" };

let db: DatabaseHandle;

beforeEach(async () => {
  db = await openAndMigrate("memory://");
});

afterEach(async () => {
  await db.close();
});

function opts(
  x: ReturnType<typeof fakeX>,
  extra: Partial<Parameters<typeof resolveHandles>[0]> = {},
) {
  return {
    db: db.db,
    now: T0,
    fetchImpl: x.fetchImpl,
    bearerToken: BEARER,
    maxHandles: 500,
    dailyMax: 1000,
    ...extra,
  };
}

// -- normalizing ------------------------------------------------------------------------------

describe("normalizeHandle", () => {
  it("strips one @, trims, lowercases, and checks the X format", () => {
    expect(normalizeHandle(" @Alice ")).toBe("alice");
    expect(normalizeHandle("bob_2")).toBe("bob_2");
    expect(normalizeHandle("a".repeat(15))).toBe("a".repeat(15));
    for (const bad of [
      "",
      "@",
      "a".repeat(16),
      "al ice",
      "alice!",
      "@@alice",
      "https://x.com/alice",
    ]) {
      expect(normalizeHandle(bad)).toBeNull();
    }
  });
});

// -- the resolver -----------------------------------------------------------------------------

describe("resolveHandles", () => {
  it("resolves, caches both tables, and keeps the input order", async () => {
    const x = fakeX([ALICE, BOB]);
    const out = await resolveHandles({ ...opts(x), handles: ["bob_2", "@alice"] });

    expect(out.found.map((f) => f.xUserId)).toEqual([BOB.id, ALICE.id]);
    expect(out.found[1]).toEqual({
      handle: "Alice",
      handleLower: "alice",
      xUserId: ALICE.id,
      displayName: "alice",
      profileImageUrl: "https://pbs.twimg.com/a.png",
    });
    expect(out.missing).toEqual([]);
    expect(out.paidLookups).toBe(2);

    expect(x.calls).toHaveLength(1);
    expect(x.calls[0]?.url.pathname).toBe("/2/users/by");
    expect(x.calls[0]?.url.searchParams.get("user.fields")).toBe("profile_image_url");
    expect(x.calls[0]?.auth).toBe(`Bearer ${BEARER}`);

    expect(await db.db.select().from(xUsers)).toHaveLength(2);
    expect(await db.db.select().from(xHandleLookups)).toHaveLength(2);
  });

  it("a fresh cache entry costs no call; one older than 7 days is asked again", async () => {
    const x = fakeX([ALICE]);
    await resolveHandles({ ...opts(x), handles: ["alice"] });
    expect(HANDLE_REFRESH_MS).toBe(7 * DAY_MS);

    const inside = await resolveHandles({
      ...opts(x, { now: new Date(T0.getTime() + 7 * DAY_MS - 1) }),
      handles: ["alice"],
    });
    expect(inside.paidLookups).toBe(0);
    expect(x.calls).toHaveLength(1);

    const after = await resolveHandles({
      ...opts(x, { now: new Date(T0.getTime() + 7 * DAY_MS + 1) }),
      handles: ["alice"],
    });
    expect(after.paidLookups).toBe(1);
    expect(x.calls).toHaveLength(2);
    expect(after.found[0]?.xUserId).toBe(ALICE.id);
  });

  it("a recycled handle: after the refresh it points to the new account", async () => {
    await resolveHandles({ ...opts(fakeX([ALICE])), handles: ["alice"] });
    const newOwner: XUser = { id: "999", username: "alice", name: "someone new" };
    const later = new Date(T0.getTime() + 8 * DAY_MS);
    const out = await resolveHandles({
      ...opts(fakeX([newOwner]), { now: later }),
      handles: ["alice"],
    });
    expect(out.found[0]?.xUserId).toBe("999");
    // The old account's profile stays cached forever: X ids are never reused.
    expect((await db.db.select().from(xUsers)).map((u) => u.xUserId).sort()).toEqual([
      ALICE.id,
      "999",
    ]);
  });

  it("reports a handle X does not know, and drops its stale mapping", async () => {
    await resolveHandles({ ...opts(fakeX([ALICE])), handles: ["alice"] });
    const later = new Date(T0.getTime() + 8 * DAY_MS);
    const out = await resolveHandles({
      ...opts(fakeX([]), { now: later }),
      handles: ["alice", "ghost"],
    });
    expect(out.found).toEqual([]);
    expect(out.missing).toEqual(["alice", "ghost"]);
    expect(await db.db.select().from(xHandleLookups)).toHaveLength(0);
  });

  it("dedupes before counting and before calling", async () => {
    const x = fakeX([ALICE]);
    const out = await resolveHandles({ ...opts(x), handles: ["alice", "@ALICE", " alice "] });
    expect(out.found).toHaveLength(1);
    expect(out.paidLookups).toBe(1);
  });

  it("refuses a bad handle before any paid call, and names it", async () => {
    const x = fakeX([ALICE]);
    const err = await resolveHandles({ ...opts(x), handles: ["alice", "not a handle"] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HandleResolveError);
    expect((err as HandleResolveError).code).toBe("bad_handle");
    expect((err as HandleResolveError).handles).toEqual(["not a handle"]);
    expect(x.calls).toHaveLength(0);
  });

  it("refuses more than the cap before any paid call", async () => {
    const x = fakeX([]);
    const handles = Array.from({ length: 501 }, (_, i) => `h${i}`);
    const err = await resolveHandles({ ...opts(x), handles }).catch((e: unknown) => e);
    expect((err as HandleResolveError).code).toBe("too_many");
    expect(x.calls).toHaveLength(0);
  });

  it("asks X in batches of 100", async () => {
    const users = Array.from({ length: 250 }, (_, i) => ({
      id: String(1000 + i),
      username: `u${i}`,
      name: `U${i}`,
    }));
    const x = fakeX(users);
    const out = await resolveHandles({ ...opts(x), handles: users.map((u) => u.username) });
    expect(out.found).toHaveLength(250);
    expect(
      x.calls.map((c) => (c.url.searchParams.get("usernames") ?? "").split(",").length),
    ).toEqual([100, 100, 50]);
  });

  it("the daily cap is charged before the call and refuses what would go over it", async () => {
    const x = fakeX([ALICE, BOB]);
    await resolveHandles({ ...opts(x, { dailyMax: 2 }), handles: ["alice"] });
    const err = await resolveHandles({
      ...opts(x, { dailyMax: 2 }),
      handles: ["bob_2", "carol"],
    }).catch((e: unknown) => e);
    expect((err as HandleResolveError).code).toBe("daily_cap");
    expect(x.calls).toHaveLength(1);
    // Cached handles still work past the cap: they cost nothing.
    const cached = await resolveHandles({ ...opts(x, { dailyMax: 2 }), handles: ["alice"] });
    expect(cached.found).toHaveLength(1);
    // A new UTC day starts a new count.
    const tomorrow = await resolveHandles({
      ...opts(x, { dailyMax: 2, now: new Date(T0.getTime() + DAY_MS) }),
      handles: ["bob_2"],
    });
    expect(tomorrow.found).toHaveLength(1);
  });

  it("without a bearer token it refuses what is not cached, and serves what is", async () => {
    await resolveHandles({ ...opts(fakeX([ALICE])), handles: ["alice"] });
    const x = fakeX([BOB]);
    const cached = await resolveHandles({
      ...opts(x, { bearerToken: undefined }),
      handles: ["alice"],
    });
    expect(cached.found).toHaveLength(1);
    const err = await resolveHandles({
      ...opts(x, { bearerToken: undefined }),
      handles: ["bob_2"],
    }).catch((e: unknown) => e);
    expect((err as HandleResolveError).code).toBe("not_configured");
    expect(x.calls).toHaveLength(0);
  });

  it("an X failure is a clean error that never carries the token", async () => {
    for (const status of [401, 429, 503]) {
      const err = await resolveHandles({ ...opts(fakeX([], status)), handles: ["alice"] }).catch(
        (e: unknown) => e,
      );
      expect((err as HandleResolveError).code).toBe("x_unavailable");
      expect((err as HandleResolveError).status).toBe(status);
      expect(String((err as Error).message)).not.toContain(BEARER);
      expect(JSON.stringify(err)).not.toContain(BEARER);
    }
  });
});

// -- the route --------------------------------------------------------------------------------

describe("POST /api/handles/resolve", () => {
  let harness: Harness;
  let headers: Record<string, string>;

  beforeEach(async () => {
    // Handle mode on for one chain.: our binder key, the same binder on chain.
    const adapter = {
      ...evmAdapterFor(createFakeChain()),
      handleModeReady: () => Promise.resolve(true),
    };
    harness = await createHarness({
      writeSides: singleAdapter(adapter),
      env: { X_BEARER_TOKEN: BEARER, ...TEST_BINDER_ENV },
      xLookup: [ALICE],
    });
    const { jar } = await login(harness);
    headers = {
      cookie: cookieHeader(jar),
      [CSRF_HEADER]: jar["dc_csrf"] ?? "",
      "content-type": "application/json",
    };
  });

  afterEach(async () => {
    await harness.close();
  });

  const post = (body: unknown, h: Record<string, string> = headers) =>
    harness.app.request("/api/handles/resolve", {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });

  it("returns name and avatar for the preview, and the misses", async () => {
    const res = await post({ handles: ["@Alice", "ghost"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      found: [
        {
          handle: "Alice",
          xUserId: ALICE.id,
          displayName: "alice",
          profileImageUrl: "https://pbs.twimg.com/a.png",
        },
      ],
      missing: ["ghost"],
    });
  });

  it("needs a session and the CSRF token", async () => {
    expect(
      (await post({ handles: ["alice"] }, { "content-type": "application/json" })).status,
    ).toBe(401);
    expect(
      (await post({ handles: ["alice"] }, { ...headers, [CSRF_HEADER]: "wrong" })).status,
    ).toBe(403);
  });

  it("answers a bad handle with 400 and names it", async () => {
    const res = await post({ handles: ["not a handle"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_handle", handles: ["not a handle"] });
  });

  it("refuses a body that is not a list of strings", async () => {
    expect((await post({ handles: "alice" })).status).toBe(400);
    expect((await post({ handles: [1] })).status).toBe(400);
  });
});
