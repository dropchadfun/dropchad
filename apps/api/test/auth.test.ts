/**
 * The X login flow, end to end, against a stubbed x.com.
 *
 * These tests drive the real routes and the real `XClient`. Nothing is faked except the network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import { CSRF_COOKIE, OAUTH_COOKIE, SESSION_COOKIE } from "../src/auth/session.js";
import { sessions } from "../src/db/schema.js";
import {
  cookieHeader,
  cookiesFrom,
  createHarness,
  login,
  setCookieHeader,
  type Harness,
} from "./harness.js";

let harness: Harness;

afterEach(async () => {
  await harness.close();
});

describe("GET /api/auth/x/start", () => {
  beforeEach(async () => {
    harness = await createHarness();
  });

  it("redirects to x.com with every parameter the docs require", async () => {
    const response = await harness.app.request("/api/auth/x/start");

    expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location") ?? "");

    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/x/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("asks for users.read and tweet.read, and never for offline.access", async () => {
    const response = await harness.app.request("/api/auth/x/start");
    const scope = new URL(response.headers.get("location") ?? "").searchParams.get("scope") ?? "";

    expect(scope.split(" ").sort()).toEqual(["tweet.read", "users.read"]);
    expect(scope).not.toContain("offline.access");
  });

  it("uses S256: the challenge is the sha256 of the stored verifier, not the verifier itself", async () => {
    const response = await harness.app.request("/api/auth/x/start");
    const challenge = new URL(response.headers.get("location") ?? "").searchParams.get(
      "code_challenge",
    );

    const rows = await harness.handle.client.query<{ code_verifier: string }>(
      "SELECT code_verifier FROM oauth_states",
    );
    const verifier = rows.rows[0]?.code_verifier ?? "";

    expect(verifier).not.toBe("");
    expect(challenge).not.toBe(verifier);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("sets a short lived, httpOnly, Secure, SameSite=Lax pre-session cookie", async () => {
    const response = await harness.app.request("/api/auth/x/start");
    const header = setCookieHeader(response, OAUTH_COOKIE) ?? "";

    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=600");
    // Host scoped. A Domain attribute would send it to every sibling subdomain.
    expect(header).not.toContain("Domain=");
  });

  it("never puts the code verifier in the redirect url", async () => {
    const response = await harness.app.request("/api/auth/x/start");
    const location = response.headers.get("location") ?? "";
    const rows = await harness.handle.client.query<{ code_verifier: string }>(
      "SELECT code_verifier FROM oauth_states",
    );
    expect(location).not.toContain(rows.rows[0]?.code_verifier ?? "never");
  });

  it("issues a different state and verifier every time", async () => {
    const first = await harness.app.request("/api/auth/x/start");
    const second = await harness.app.request("/api/auth/x/start");

    const stateOf = (r: Response) =>
      new URL(r.headers.get("location") ?? "").searchParams.get("state");
    expect(stateOf(first)).not.toBe(stateOf(second));

    const rows = await harness.handle.client.query<{ n: string }>(
      "SELECT count(DISTINCT code_verifier)::text AS n FROM oauth_states",
    );
    expect(rows.rows[0]?.n).toBe("2");
  });
});

describe("GET /api/auth/x/callback", () => {
  beforeEach(async () => {
    harness = await createHarness();
  });

  it("exchanges the code with Basic auth and the matching verifier, then signs the user in", async () => {
    const { callback, jar } = await login(harness);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("http://localhost:3000/?login=ok");
    expect(jar[SESSION_COOKIE]).toBeTruthy();

    const tokenCall = harness.x.calls.find((call) => call.url.includes("/oauth2/token"));
    expect(tokenCall?.method).toBe("POST");
    // Confidential client: the secret goes in the Authorization header, never in the body.
    expect(tokenCall?.headers["authorization"]).toBe(
      "Basic " + Buffer.from("test-client-id:test-client-secret").toString("base64"),
    );
    expect(tokenCall?.headers["content-type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(tokenCall?.body ?? "");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("redirect_uri")).toBe("http://localhost:3000/api/auth/x/callback");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(body.get("client_secret")).toBeNull();
  });

  it("sends the verifier that belongs to the state it was given", async () => {
    // Two logins are started at once. The second one finishes. It must use the second verifier.
    const first = await harness.app.request("/api/auth/x/start");
    const second = await harness.app.request("/api/auth/x/start");
    const secondState = new URL(second.headers.get("location") ?? "").searchParams.get("state");

    const rows = await harness.handle.client.query<{ code_verifier: string; state_hash: string }>(
      "SELECT code_verifier, state_hash FROM oauth_states",
    );
    expect(rows.rows).toHaveLength(2);

    await harness.app.request(
      `/api/auth/x/callback?code=c&state=${encodeURIComponent(secondState ?? "")}`,
      { headers: { cookie: cookieHeader(cookiesFrom(second)) } },
    );

    const used = harness.x.verifiers()[0];
    expect(rows.rows.map((r) => r.code_verifier)).toContain(used);
    // And the unrelated first login is untouched, its row is still there.
    const left = await harness.handle.client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM oauth_states",
    );
    expect(left.rows[0]?.n).toBe("1");
    expect(first.status).toBe(302);
  });

  it("stores the numeric X id as the identity, with the handle only as display", async () => {
    await login(harness);

    const rows = await harness.handle.client.query<{
      x_user_id: string;
      handle: string;
      display_name: string;
      profile_image_url: string;
    }>("SELECT x_user_id, handle, display_name, profile_image_url FROM profiles");

    expect(rows.rows[0]).toEqual({
      x_user_id: "1234567890",
      handle: "dropchadfun",
      display_name: "dropchad",
      profile_image_url: "https://pbs.twimg.com/profile_images/1/avatar.png",
    });
  });

  it("refreshes the handle, name and avatar on the next login", async () => {
    await login(harness);
    await harness.close();

    harness = await createHarness({
      user: { id: "1234567890", username: "newhandle", name: "New Name" },
    });
    await login(harness);
    // The same login again, so the profile is updated rather than inserted twice.
    await login(harness);

    const rows = await harness.handle.client.query<{
      x_user_id: string;
      handle: string;
      display_name: string;
      profile_image_url: string | null;
      n: string;
    }>("SELECT x_user_id, handle, display_name, profile_image_url FROM profiles");

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.handle).toBe("newhandle");
    expect(rows.rows[0]?.display_name).toBe("New Name");
    expect(rows.rows[0]?.profile_image_url).toBeNull();
  });

  it("revokes the access token and stores it nowhere", async () => {
    await login(harness);

    expect(harness.x.revoked()).toEqual(["x-access-token-abc"]);

    // Nothing anywhere in the database looks like that token.
    const dump =
      await harness.handle.client.query<Record<string, unknown>>("SELECT * FROM sessions");
    expect(JSON.stringify(dump.rows)).not.toContain("x-access-token-abc");
    const profileDump =
      await harness.handle.client.query<Record<string, unknown>>("SELECT * FROM profiles");
    expect(JSON.stringify(profileDump.rows)).not.toContain("x-access-token-abc");
  });

  it("sets a session cookie that JavaScript cannot read, and a CSRF cookie that it can", async () => {
    const { callback } = await login(harness);

    const session = setCookieHeader(callback, SESSION_COOKIE) ?? "";
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    expect(session).toContain("SameSite=Lax");
    expect(session).toContain("Max-Age=2592000"); // thirty days

    const csrf = setCookieHeader(callback, CSRF_COOKIE) ?? "";
    expect(csrf).not.toContain("HttpOnly"); // the frontend must echo it back in a header
    expect(csrf).toContain("Secure");
    expect(csrf).toContain("SameSite=Lax");
  });

  it("stores only a hash of the session id, never the id itself", async () => {
    const { jar } = await login(harness);
    const sessionId = jar[SESSION_COOKIE] ?? "";

    const rows = await harness.handle.client.query<{ id: string }>("SELECT id FROM sessions");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.id).not.toBe(sessionId);
    expect(rows.rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consumes the state: a replayed callback is rejected", async () => {
    const start = await harness.app.request("/api/auth/x/start");
    const startJar = cookiesFrom(start);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cookie = cookieHeader(startJar);

    const first = await harness.app.request(
      `/api/auth/x/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    );
    expect(first.status).toBe(302);

    const replay = await harness.app.request(
      `/api/auth/x/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_state" });
  });

  it("rejects a state that was never issued", async () => {
    const start = await harness.app.request("/api/auth/x/start");
    const response = await harness.app.request("/api/auth/x/callback?code=c&state=made-up", {
      headers: { cookie: cookieHeader(cookiesFrom(start)) },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_state" });
    // No token exchange was even attempted.
    expect(harness.x.calls).toHaveLength(0);
  });

  it("rejects a real state presented by another browser", async () => {
    const start = await harness.app.request("/api/auth/x/start");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";

    // Same state, a different browser's pre-session cookie.
    const other = await harness.app.request("/api/auth/x/start");
    const response = await harness.app.request(
      `/api/auth/x/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(cookiesFrom(other)) } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_state" });
    expect(harness.x.calls).toHaveLength(0);
  });

  it("rejects a callback with no pre-session cookie at all", async () => {
    const start = await harness.app.request("/api/auth/x/start");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";

    const response = await harness.app.request(
      `/api/auth/x/callback?code=c&state=${encodeURIComponent(state)}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "login_expired" });
  });

  it("rejects a state that has expired", async () => {
    const start = await harness.app.request("/api/auth/x/start");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";

    harness.setNow(new Date("2026-09-09T00:11:00.000Z")); // eleven minutes later

    const response = await harness.app.request(
      `/api/auth/x/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(cookiesFrom(start)) } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "login_expired" });
  });

  it("treats a cancelled login as a redirect, not an error", async () => {
    const response = await harness.app.request(
      "/api/auth/x/callback?error=access_denied&state=whatever",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/?login=cancelled");
  });

  it("rejects a callback with neither code nor error", async () => {
    const response = await harness.app.request("/api/auth/x/callback?state=abc");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_callback" });
  });

  it("rejects an over long state instead of hitting the database", async () => {
    const response = await harness.app.request(
      `/api/auth/x/callback?code=c&state=${"a".repeat(501)}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_callback" });
  });
});

describe("callback failures at X", () => {
  it("does not sign anybody in when the token exchange fails", async () => {
    harness = await createHarness({ tokenStatus: 400 });
    const { callback, jar } = await login(harness);

    expect(callback.status).toBe(502);
    expect(await callback.json()).toEqual({ error: "x_auth_failed" });
    expect(jar[SESSION_COOKIE]).toBeUndefined();

    const rows = await harness.handle.client.query("SELECT * FROM sessions");
    expect(rows.rows).toHaveLength(0);
  });

  it("does not sign anybody in when users/me fails, and still revokes the token", async () => {
    harness = await createHarness({ meStatus: 401 });
    const { callback } = await login(harness);

    expect(callback.status).toBe(502);
    expect(harness.x.revoked()).toEqual(["x-access-token-abc"]);

    const profiles = await harness.handle.client.query("SELECT * FROM profiles");
    expect(profiles.rows).toHaveLength(0);
  });

  it("refuses a users/me id that is not numeric", async () => {
    harness = await createHarness({
      user: { id: "not-a-number", username: "x", name: "x" },
    });
    const { callback } = await login(harness);

    expect(callback.status).toBe(502);
    const rows = await harness.handle.client.query("SELECT * FROM profiles");
    expect(rows.rows).toHaveLength(0);
  });
});

describe("session rotation", () => {
  beforeEach(async () => {
    harness = await createHarness();
  });

  it("issues a new id on a second login and kills the old one", async () => {
    const first = await login(harness);
    const firstId = first.jar[SESSION_COOKIE] ?? "";

    // Log in again carrying the first session cookie, the way a browser would.
    const start = await harness.app.request("/api/auth/x/start", {
      headers: { cookie: cookieHeader(first.jar) },
    });
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const callback = await harness.app.request(
      `/api/auth/x/callback?code=c2&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader({ ...first.jar, ...cookiesFrom(start) }) } },
    );

    const secondId = cookiesFrom(callback)[SESSION_COOKIE] ?? "";
    expect(secondId).not.toBe("");
    expect(secondId).not.toBe(firstId);

    // Exactly one live session, and the old cookie no longer resolves to anybody.
    const rows = await harness.handle.client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM sessions",
    );
    expect(rows.rows[0]?.n).toBe("1");

    const me = await harness.app.request("/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(firstId)}` },
    });
    expect(await me.json()).toEqual({ profile: null });
  });

  it("expires a session after thirty days, absolute from login, no sliding renewal", async () => {
    const { jar } = await login(harness);

    // Day 15: a read does not extend the session. Day 30 minus one minute: still live.
    harness.setNow(new Date("2026-09-24T00:00:00.000Z"));
    await harness.app.request("/api/me", { headers: { cookie: cookieHeader(jar) } });
    harness.setNow(new Date("2026-10-08T23:59:00.000Z"));
    const before = await harness.app.request("/api/me", {
      headers: { cookie: cookieHeader(jar) },
    });
    expect(((await before.json()) as { profile: unknown }).profile).not.toBeNull();

    harness.setNow(new Date("2026-10-09T00:00:01.000Z"));
    const after = await harness.app.request("/api/me", { headers: { cookie: cookieHeader(jar) } });
    expect(await after.json()).toEqual({ profile: null });

    // The expired row is deleted, not left lying around.
    const rows = await harness.deps.db.select().from(sessions);
    expect(rows).toHaveLength(0);
  });
});
