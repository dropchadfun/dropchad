/**
 * Streamer connect, Kick and Twitch "Kick and Twitch
 * connect".
 *
 * A signed in chad links a Kick or Twitch account only to prove they own it. The state row keeps
 * the provider and the session's X id; the callback refuses another browser, another session or
 * another provider. No token is kept: exchange, read, revoke. One platform account links to one X
 * id; a second X id is `taken` until its owner unlinks it. The public profile carries `streams`.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { dropHandleLeaves, drops, oauthStates, profiles, streamLinks } from "../src/db/schema.js";
import type { BoardDrop } from "../src/indexer/client.js";
import {
  KICK_ACCESS,
  KICK_REFRESH,
  TWITCH_ACCESS,
  type StreamStubOptions,
} from "./fake-streams.js";
import { cookieHeader, cookiesFrom, createHarness, login, type Harness } from "./harness.js";

/** The stubbed X user in `harness.ts`. */
const X_USER_ID = "1234567890";
const HANDLE = "dropchadfun";
const APP = "http://localhost:3000";

const KICK_ON = { KICK_CLIENT_ID: "kick-client-id", KICK_CLIENT_SECRET: "kick-client-secret" };
const TWITCH_ON = {
  TWITCH_CLIENT_ID: "twitch-client-id",
  TWITCH_CLIENT_SECRET: "twitch-client-secret",
};
const BOTH_ON = { ...KICK_ON, ...TWITCH_ON };

type Platform = "kick" | "twitch";

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function setUp(
  env: Record<string, string> = BOTH_ON,
  streams: StreamStubOptions = {},
): Promise<{ h: Harness; jar: Record<string, string> }> {
  const h = await createHarness({ env, streams });
  harness = h;
  const { jar } = await login(h);
  return { h, jar };
}

async function start(
  h: Harness,
  platform: Platform,
  jar: Record<string, string> | null,
): Promise<Response> {
  return await h.app.request(`/api/auth/${platform}/start`, {
    headers: jar === null ? {} : { cookie: cookieHeader(jar) },
  });
}

/** Start, then the callback with the state from the authorize url. The final `location`. */
async function connect(
  h: Harness,
  platform: Platform,
  jar: Record<string, string>,
  before?: (state: string) => Promise<void>,
): Promise<{ location: string; status: number }> {
  const started = await start(h, platform, jar);
  expect(started.status).toBe(302);
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
  if (before !== undefined) await before(state);
  const both = { ...jar, ...cookiesFrom(started) };
  const callback = await h.app.request(
    `/api/auth/${platform}/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookieHeader(both) } },
  );
  return { location: callback.headers.get("location") ?? "", status: callback.status };
}

async function linkRows(h: Harness): Promise<Record<string, unknown>[]> {
  return await h.deps.db.select().from(streamLinks);
}

/** The profile redirect: the result and the platform of the callback route. */
const done = (result: string, platform: Platform = "kick") =>
  `${APP}/u/${HANDLE}?connect=${result}&platform=${platform}`;

describe("start", () => {
  it("a platform with empty env values is off: 404 connect_off", async () => {
    const { h, jar } = await setUp(KICK_ON);
    const off = await start(h, "twitch", jar);
    expect(off.status).toBe(404);
    expect(await off.json()).toEqual({ error: "connect_off" });
  });

  it("not signed in goes back to / with connect=signin, no state row", async () => {
    const { h } = await setUp();
    const response = await start(h, "kick", null);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${APP}/?connect=signin`);
    const rows = await h.deps.db.select().from(oauthStates);
    // The X login row is used up; nothing new was written.
    expect(rows).toHaveLength(0);
  });

  it("kick: PKCE S256, user:read and channel:read, the callback on the site host", async () => {
    const { h, jar } = await setUp();
    const response = await start(h, "kick", jar);
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://id.kick.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("kick-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/kick/callback`);
    expect(url.searchParams.get("scope")).toBe("user:read channel:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(cookiesFrom(response)["dc_oauth"]).toBeTruthy();

    const rows = await h.deps.db.select().from(oauthStates);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row["provider"]).toBe("kick");
    expect(row["xUserId"]).toBe(X_USER_ID);
  });

  it("twitch: no PKCE, no scope, the callback on the site host", async () => {
    const { h, jar } = await setUp();
    const response = await start(h, "twitch", jar);
    const url = new URL(response.headers.get("location") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://id.twitch.tv/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("twitch-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/twitch/callback`);
    expect(url.searchParams.get("scope")).toBe("");
    expect(url.searchParams.has("code_challenge")).toBe(false);
    const row = (await h.deps.db.select().from(oauthStates))[0] as Record<string, unknown>;
    expect(row["provider"]).toBe("twitch");
    expect(row["xUserId"]).toBe(X_USER_ID);
  });

  it("the X login state rows say provider x and no X id", async () => {
    const h = await createHarness({ env: BOTH_ON });
    harness = h;
    await h.app.request("/api/auth/x/start");
    const row = (await h.deps.db.select().from(oauthStates))[0] as Record<string, unknown>;
    expect(row["provider"]).toBe("x");
    expect(row["xUserId"]).toBeNull();
  });
});

describe("callback, linked", () => {
  it("kick: saves the user id and the slug, revokes both tokens, keeps none", async () => {
    const { h, jar } = await setUp();
    const result = await connect(h, "kick", jar);
    expect(result.status).toBe(302);
    expect(result.location).toBe(done("ok"));

    const rows = await linkRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      xUserId: X_USER_ID,
      platform: "kick",
      platformUserId: "4242",
      channel: "chad-streams",
    });
    expect(JSON.stringify(rows)).not.toContain(KICK_ACCESS);
    expect(JSON.stringify(rows)).not.toContain("streamer@example.com");

    const calls = h.streams.calls;
    const token = calls.find((c) => c.url.startsWith("https://id.kick.com/oauth/token"));
    const form = new URLSearchParams(token?.body ?? "");
    expect(token?.method).toBe("POST");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe("kick-client-id");
    expect(form.get("client_secret")).toBe("kick-client-secret");
    expect(form.get("code")).toBe("auth-code-1");
    expect(form.get("redirect_uri")).toBe(`${APP}/api/auth/kick/callback`);
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

    const reads = calls.filter((c) => c.url.startsWith("https://api.kick.com/public/v1/"));
    expect(reads.map((c) => new URL(c.url).pathname).sort()).toEqual([
      "/public/v1/channels",
      "/public/v1/users",
    ]);
    for (const read of reads) expect(read.headers["authorization"]).toBe(`Bearer ${KICK_ACCESS}`);

    const revoked = calls
      .filter((c) => c.url.startsWith("https://id.kick.com/oauth/revoke"))
      .map((c) => new URL(c.url).searchParams.get("token"));
    expect(revoked.sort()).toEqual([KICK_ACCESS, KICK_REFRESH].sort());

    // Single use: the state row is gone.
    expect(await h.deps.db.select().from(oauthStates)).toHaveLength(0);
  });

  it("twitch: saves the id and the login, Client-Id on helix, revokes the token", async () => {
    const { h, jar } = await setUp();
    const result = await connect(h, "twitch", jar);
    expect(result.location).toBe(done("ok", "twitch"));
    expect(await linkRows(h)).toEqual([
      expect.objectContaining({
        xUserId: X_USER_ID,
        platform: "twitch",
        platformUserId: "141981764",
        channel: "chadstreams",
      }),
    ]);

    const calls = h.streams.calls;
    const token = calls.find((c) => c.url.startsWith("https://id.twitch.tv/oauth2/token"));
    const form = new URLSearchParams(token?.body ?? "");
    expect(form.get("client_id")).toBe("twitch-client-id");
    expect(form.get("client_secret")).toBe("twitch-client-secret");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe(`${APP}/api/auth/twitch/callback`);
    expect(form.has("code_verifier")).toBe(false);

    const helix = calls.find((c) => c.url.startsWith("https://api.twitch.tv/helix/users"));
    expect(helix?.headers["client-id"]).toBe("twitch-client-id");
    expect(helix?.headers["authorization"]).toBe(`Bearer ${TWITCH_ACCESS}`);

    const revoke = calls.find((c) => c.url.startsWith("https://id.twitch.tv/oauth2/revoke"));
    expect(revoke?.method).toBe("POST");
    const revokeForm = new URLSearchParams(revoke?.body ?? "");
    expect(revokeForm.get("client_id")).toBe("twitch-client-id");
    expect(revokeForm.get("token")).toBe(TWITCH_ACCESS);
  });

  it("both can be linked", async () => {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    await connect(h, "twitch", jar);
    expect((await linkRows(h)).map((r) => r["platform"]).sort()).toEqual(["kick", "twitch"]);
  });

  it("the same account again refreshes the channel; one row per platform", async () => {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    h.streams.calls.length = 0;
    const renamed = await createHarnessLike(h, {
      kickChannel: { broadcaster_user_id: 4242, slug: "chad-renamed" },
    });
    const result = await connect(renamed.h, "kick", renamed.jar);
    expect(result.location).toBe(done("ok"));
    const rows = await linkRows(renamed.h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["channel"]).toBe("chad-renamed");
  });

  it("another account on the same platform replaces the old one for this X id", async () => {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    const other = await createHarnessLike(h, {
      kickUser: { user_id: 5555, name: "Other" },
      kickChannel: { broadcaster_user_id: 5555, slug: "other" },
    });
    await connect(other.h, "kick", other.jar);
    const rows = await linkRows(other.h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platformUserId: "5555", channel: "other" });
  });
});

/**
 * The same database under a new stub: the harness keeps one stub per app, so a second answer
 * from Kick needs a second app over the first one's database.
 */
async function createHarnessLike(
  first: Harness,
  streams: StreamStubOptions,
): Promise<{ h: Harness; jar: Record<string, string> }> {
  const second = await createHarness({ env: BOTH_ON, streams });
  // Point the second app at the first database: the rows from the first connect are there.
  const h: Harness = {
    ...second,
    deps: second.deps,
  };
  (second.deps as { db: unknown }).db = first.deps.db;
  await second.handle.close();
  const { jar } = await login(h);
  return { h, jar };
}

describe("the profile owns its links", () => {
  it("a deleted profile takes its links with it", async () => {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    await h.deps.db.delete(profiles).where(eq(profiles.xUserId, X_USER_ID));
    expect(await linkRows(h)).toHaveLength(0);
  });
});

describe("callback, refused", () => {
  it("cancel on Kick: connect=cancelled, nothing saved", async () => {
    const { h, jar } = await setUp();
    const started = await start(h, "kick", jar);
    const both = { ...jar, ...cookiesFrom(started) };
    const response = await h.app.request("/api/auth/kick/callback?error=access_denied", {
      headers: { cookie: cookieHeader(both) },
    });
    expect(response.headers.get("location")).toBe(done("cancelled"));
    expect(await linkRows(h)).toHaveLength(0);
  });

  it("taken: the account is linked to another X id, nothing changes", async () => {
    const { h, jar } = await setUp();
    await h.deps.db
      .insert(profiles)
      .values({ xUserId: "777", handle: "firstchad", displayName: "First", profileImageUrl: null });
    await h.deps.db.insert(streamLinks).values({
      xUserId: "777",
      platform: "kick",
      platformUserId: "4242",
      channel: "chad-streams",
      linkedAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    const result = await connect(h, "kick", jar);
    expect(result.location).toBe(done("taken"));
    const rows = await linkRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["xUserId"]).toBe("777");
  });

  it("expired: no pre-session cookie (another browser)", async () => {
    const { h, jar } = await setUp();
    const started = await start(h, "kick", jar);
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const response = await h.app.request(
      `/api/auth/kick/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader({ ...jar, dc_oauth: "" }) } },
    );
    expect(response.headers.get("location")).toBe(done("expired"));
    expect(await linkRows(h)).toHaveLength(0);
  });

  it("expired: the state was made for another X session", async () => {
    const { h, jar } = await setUp();
    await h.deps.db
      .insert(profiles)
      .values({ xUserId: "888", handle: "otherchad", displayName: "Other", profileImageUrl: null });
    const result = await connect(h, "kick", jar, async () => {
      await h.deps.db.update(oauthStates).set({ xUserId: "888" });
    });
    expect(result.location).toBe(done("expired"));
    expect(await linkRows(h)).toHaveLength(0);
    expect(h.streams.calls).toHaveLength(0);
  });

  it("expired: a Twitch state on the Kick callback", async () => {
    const { h, jar } = await setUp();
    const started = await start(h, "twitch", jar);
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const both = { ...jar, ...cookiesFrom(started) };
    const response = await h.app.request(
      `/api/auth/kick/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(both) } },
    );
    expect(response.headers.get("location")).toBe(done("expired"));
    expect(await linkRows(h)).toHaveLength(0);
  });

  it("expired: an X login state on the Kick callback", async () => {
    const { h, jar } = await setUp();
    const xStart = await h.app.request("/api/auth/x/start");
    const state = new URL(xStart.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const both = { ...jar, ...cookiesFrom(xStart) };
    const response = await h.app.request(
      `/api/auth/kick/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(both) } },
    );
    expect(response.headers.get("location")).toBe(done("expired"));
  });

  it("a Kick state on the X login callback is refused, never a login", async () => {
    const { h, jar } = await setUp();
    const started = await start(h, "kick", jar);
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const both = { ...jar, ...cookiesFrom(started) };
    const response = await h.app.request(
      `/api/auth/x/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(both) } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_state" });
  });

  it("expired: after ten minutes", async () => {
    const { h, jar } = await setUp();
    const result = await connect(h, "kick", jar, () => {
      h.setNow(new Date("2026-09-09T00:11:00.000Z"));
      return Promise.resolve();
    });
    expect(result.location).toBe(done("expired"));
    expect(await linkRows(h)).toHaveLength(0);
  });

  it("expired: a replayed callback finds nothing", async () => {
    const { h, jar } = await setUp();
    const started = await start(h, "kick", jar);
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const both = { ...jar, ...cookiesFrom(started) };
    const path = `/api/auth/kick/callback?code=auth-code-1&state=${encodeURIComponent(state)}`;
    const first = await h.app.request(path, { headers: { cookie: cookieHeader(both) } });
    expect(first.headers.get("location")).toBe(done("ok"));
    const second = await h.app.request(path, { headers: { cookie: cookieHeader(both) } });
    expect(second.headers.get("location")).toBe(done("expired"));
  });

  it("a callback with no session goes to / with connect=signin", async () => {
    const { h, jar } = await setUp();
    const started = await start(h, "kick", jar);
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const response = await h.app.request(
      `/api/auth/kick/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(cookiesFrom(started)) } },
    );
    expect(response.headers.get("location")).toBe(`${APP}/?connect=signin`);
    expect(await linkRows(h)).toHaveLength(0);
  });

  it("failed: the token exchange fails, no token or code in the answer", async () => {
    const { h, jar } = await setUp(BOTH_ON, { kickTokenStatus: 400 });
    const result = await connect(h, "kick", jar);
    expect(result.location).toBe(done("failed"));
    expect(result.location).not.toContain("auth-code-1");
    expect(await linkRows(h)).toHaveLength(0);
  });

  it("failed: the Kick channel belongs to another user id", async () => {
    const { h, jar } = await setUp(BOTH_ON, {
      kickChannel: { broadcaster_user_id: 9999, slug: "someone-else" },
    });
    const result = await connect(h, "kick", jar);
    expect(result.location).toBe(done("failed"));
    expect(await linkRows(h)).toHaveLength(0);
  });

  const BAD_NAMES: { platform: Platform; streams: StreamStubOptions }[] = [
    {
      platform: "kick",
      streams: { kickChannel: { broadcaster_user_id: 4242, slug: "bad slug" } },
    },
    {
      platform: "kick",
      streams: { kickChannel: { broadcaster_user_id: 4242, slug: "../evil" } },
    },
    {
      platform: "kick",
      streams: { kickChannel: { broadcaster_user_id: 4242, slug: "a".repeat(26) } },
    },
    {
      platform: "twitch",
      streams: { twitchUser: { id: "1", login: "Has.Dot", display_name: "x" } },
    },
    {
      platform: "twitch",
      streams: { twitchUser: { id: "1", login: "evil.example/x", display_name: "x" } },
    },
  ];
  for (const bad of BAD_NAMES) {
    it(`failed: the ${bad.platform} channel name ${JSON.stringify(
      bad.streams.kickChannel?.slug ?? bad.streams.twitchUser?.login,
    )} fails the check`, async () => {
      const { h, jar } = await setUp(BOTH_ON, bad.streams);
      const result = await connect(h, bad.platform, jar);
      expect(result.location).toBe(done("failed", bad.platform));
      expect(await linkRows(h)).toHaveLength(0);
    });
  }
});

describe("unlink", () => {
  async function linked(): Promise<{ h: Harness; headers: Record<string, string> }> {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    await connect(h, "twitch", jar);
    return { h, headers: { cookie: cookieHeader(jar), [CSRF_HEADER]: jar["dc_csrf"] ?? "" } };
  }

  it("needs the CSRF pair", async () => {
    const { h, headers } = await linked();
    const response = await h.app.request("/api/me/streams/kick", {
      method: "DELETE",
      headers: { cookie: headers["cookie"] ?? "" },
    });
    expect(response.status).toBe(403);
    expect(await linkRows(h)).toHaveLength(2);
  });

  // Coverage check: a header that is there but wrong.
  it("a wrong CSRF value is 403 too, and nothing is unlinked", async () => {
    const { h, headers } = await linked();
    const response = await h.app.request("/api/me/streams/kick", {
      method: "DELETE",
      headers: { cookie: headers["cookie"] ?? "", [CSRF_HEADER]: "not-the-token" },
    });
    expect(response.status).toBe(403);
    expect(await linkRows(h)).toHaveLength(2);
  });

  it("deletes that platform's row only", async () => {
    const { h, headers } = await linked();
    const response = await h.app.request("/api/me/streams/kick", { method: "DELETE", headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await linkRows(h)).map((r) => r["platform"])).toEqual(["twitch"]);
  });

  it("is ok when nothing was linked", async () => {
    const { h, headers } = await linked();
    await h.app.request("/api/me/streams/kick", { method: "DELETE", headers });
    const again = await h.app.request("/api/me/streams/kick", { method: "DELETE", headers });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
  });

  it("an unknown platform is 400", async () => {
    const { h, headers } = await linked();
    const response = await h.app.request("/api/me/streams/youtube", { method: "DELETE", headers });
    expect(response.status).toBe(400);
  });

  it("not signed in is 401", async () => {
    const { h } = await linked();
    const response = await h.app.request("/api/me/streams/kick", { method: "DELETE" });
    expect(response.status).toBe(401);
  });

  it("logout does not unlink", async () => {
    const { h, headers } = await linked();
    await h.app.request("/api/auth/logout", { method: "POST", headers });
    expect(await linkRows(h)).toHaveLength(2);
  });
});

describe("the read side", () => {
  interface MeBody {
    profile: { streams: { platform: string; channel: string }[] };
    streamConnect: { kick: boolean; twitch: boolean };
  }

  it("/api/me: streams, kick first, and streamConnect", async () => {
    const { h, jar } = await setUp();
    await connect(h, "twitch", jar);
    await connect(h, "kick", jar);
    const me = (await (
      await h.app.request("/api/me", { headers: { cookie: cookieHeader(jar) } })
    ).json()) as MeBody;
    expect(me.profile.streams).toEqual([
      { platform: "kick", channel: "chad-streams" },
      { platform: "twitch", channel: "chadstreams" },
    ]);
    expect(me.streamConnect).toEqual({ kick: true, twitch: true });
  });

  it("/api/me: none linked is [], a platform off says false", async () => {
    const { h, jar } = await setUp(KICK_ON);
    const me = (await (
      await h.app.request("/api/me", { headers: { cookie: cookieHeader(jar) } })
    ).json()) as MeBody;
    expect(me.profile.streams).toEqual([]);
    expect(me.streamConnect).toEqual({ kick: true, twitch: false });
  });

  it("a platform turned off leaves its link out of streams", async () => {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    await connect(h, "twitch", jar);
    const kickOnly = await createHarness({ env: KICK_ON });
    harness = kickOnly;
    (kickOnly.deps as { db: unknown }).db = h.deps.db;
    const user = (await (await kickOnly.app.request(`/api/users/${HANDLE}`)).json()) as {
      profile: { streams: unknown[] };
    };
    expect(user.profile.streams).toEqual([{ platform: "kick", channel: "chad-streams" }]);
    await h.close();
  });

  it("/api/users/:handle carries streams", async () => {
    const { h, jar } = await setUp();
    await connect(h, "kick", jar);
    const user = (await (await h.app.request(`/api/users/${HANDLE}`)).json()) as {
      profile: { streams: unknown[] };
    };
    expect(user.profile.streams).toEqual([{ platform: "kick", channel: "chad-streams" }]);
  });
});

describe("boards and the drop page sender", () => {
  const NOW = new Date("2026-09-12T12:00:00.000Z");
  const SECONDS = Math.floor(NOW.getTime() / 1000);
  const DAY = 24 * 60 * 60;
  const H1 = `0x${(0x101).toString(16).padStart(40, "0")}`;
  const COMMITMENT = `0x${"1".padStart(64, "0")}`;

  const INDEXED: BoardDrop[] = [
    {
      address: H1,
      creatorCommitment: COMMITMENT,
      createdAt: String(SECONDS - DAY),
      claimedFinalWei: "300000000000000",
      claimedCountFinal: 1,
      recipients: [`0x${"a1".padStart(40, "0")}`],
      claimedIndexes: [0],
    },
  ];

  async function seeded(): Promise<Harness> {
    const h = await createHarness({
      env: BOTH_ON,
      indexer: { boardDrops: INDEXED, dropsByAddress: { [H1]: { address: H1 } } },
    });
    harness = h;
    h.setNow(NOW);
    const db = h.deps.db;
    await db
      .insert(profiles)
      .values({ xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null });
    await db.insert(drops).values({
      address: H1,
      mode: "handle",
      chainId: 46630,
      chainKey: "robinhood-testnet",
      xUserId: "1",
      nonce: 1n,
      creatorCommitment: COMMITMENT,
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
      claimPeriod: 2_592_000,
      state: "active",
      paidCount: 0,
      createTxHash: `0x${"55".repeat(32)}`,
      priceUsd: "3000",
      pricedAt: NOW,
      createdAt: new Date(NOW.getTime() - DAY * 1000),
    });
    await db
      .insert(dropHandleLeaves)
      .values({ dropAddress: H1, leafIndex: 0, xUserId: "9001", amount: "100000000000000" });
    await db.insert(streamLinks).values({
      xUserId: "1",
      platform: "twitch",
      platformUserId: "141981764",
      channel: "alicestreams",
      linkedAt: NOW,
    });
    return h;
  }

  it("a board row's profile carries streams", async () => {
    const h = await seeded();
    const body = (await (await h.app.request("/api/boards?range=all&chain=all")).json()) as {
      rows: { profile: { handle: string; streams: unknown[] } }[];
    };
    expect(body.rows.map((r) => [r.profile.handle, r.profile.streams])).toEqual([
      ["alice", [{ platform: "twitch", channel: "alicestreams" }]],
    ]);
  });

  it("the drop page creator carries streams", async () => {
    const h = await seeded();
    const body = (await (await h.app.request(`/api/drops/${H1}`)).json()) as {
      ours: { data: { creator: { handle: string; streams: unknown[] } } };
    };
    expect(body.ours.data.creator.handle).toBe("alice");
    expect(body.ours.data.creator.streams).toEqual([
      { platform: "twitch", channel: "alicestreams" },
    ]);
  });
});
