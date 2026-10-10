/**
 * `/api/health`, `/api/me`, `/api/auth/logout`, the CSRF gate and the rate limiter.
 *
 * Every route the api serves has a test here or in `auth.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "../src/auth/session.js";
import { createFakeChain } from "./fake-chain.js";
import { cookieHeader, cookiesFrom, createHarness, login, type Harness } from "./harness.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const response = await harness.app.request("/api/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; time: string };
    expect(body.ok).toBe(true);
    expect(body.time).toBe("2026-09-09T00:00:00.000Z");
  });

  it("reports 503 when the database is gone", async () => {
    await harness.handle.close();
    const response = await harness.app.request("/api/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, database: "unreachable" });
  });
});

describe("GET /api/chains", () => {
  it("lists the chains with a write side and the fee each one really charges", async () => {
    // The default harness has no relayer key, so no chain can make drops and the list is empty.
    const empty = await harness.app.request("/api/chains");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ chains: [] });

    // With a write side the fee is read from the factory, never assumed.
    const withFee = await createHarness({
      writeSide: {
        chain: createFakeChain({ defaultFeeBps: 100 }),
        chainName: "Robinhood Chain Testnet",
      },
    });
    try {
      const response = await withFee.app.request("/api/chains");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        chains: [
          {
            key: "robinhood-testnet",
            chainId: 46630,
            family: "evm",
            nativeSymbol: "ETH",
            decimals: 18,
            defaultFeeBps: 100,
            minFee: "0",
            // zero before DropFactoryV4, the V3 fee.
            minFeePerReceiver: "0",
            maxFee: "0",
            // No binder key in the default harness.
            handleMode: false,
            // No token drops on Robinhood yet.
            tokenFeeTiers: null,
          },
        ],
      });
    } finally {
      await withFee.close();
    }
  });

  it("returns the minimum fee next to the bps, in base units as a string", async () => {
    const withMin = await createHarness({
      writeSide: {
        chain: createFakeChain({ defaultFeeBps: 100, minFeeAmount: 100_000_000_000_000n }),
        chainName: "Robinhood Chain Testnet",
      },
    });
    try {
      const response = await withMin.app.request("/api/chains");
      const body = (await response.json()) as { chains: { minFee: string | null }[] };
      expect(body.chains[0]?.minFee).toBe("100000000000000");
    } finally {
      await withMin.close();
    }
  });

  it("reports null for a chain that does not answer, and still lists it", async () => {
    const chain = createFakeChain({ defaultFeeBps: 100 });
    chain.defaultFeeBps = () => Promise.reject(new Error("rpc down"));
    chain.minFeeAmount = () => Promise.reject(new Error("rpc down"));
    const broken = await createHarness({
      writeSide: { chain, chainName: "Robinhood Chain Testnet" },
    });
    try {
      const response = await broken.app.request("/api/chains");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        chains: { defaultFeeBps: number | null; minFee: string | null }[];
      };
      expect(body.chains).toHaveLength(1);
      expect(body.chains[0]?.defaultFeeBps).toBeNull();
      expect(body.chains[0]?.minFee).toBeNull();
    } finally {
      await broken.close();
    }
  });
});

describe("GET /api/me", () => {
  it("returns null for a visitor with no cookie", async () => {
    const response = await harness.app.request("/api/me");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: null });
  });

  it("returns null for a made up cookie", async () => {
    const response = await harness.app.request("/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-real-session` },
    });
    expect(await response.json()).toEqual({ profile: null });
  });

  it("returns the profile and the session expiry for a signed in user", async () => {
    const { jar } = await login(harness);
    const response = await harness.app.request("/api/me", {
      headers: { cookie: cookieHeader(jar) },
    });

    expect(await response.json()).toEqual({
      profile: {
        xUserId: "1234567890",
        handle: "dropchadfun",
        displayName: "dropchad",
        profileImageUrl: "https://pbs.twimg.com/profile_images/1/avatar.png",
        // Never picked, so the defaults. `PATCH /api/me` sets the tags and derives the kind,
        // `me.test.ts`. Nothing earns a badge yet.
        kind: "chad",
        tags: [],
        tagLockedUntil: null,
        badges: [],
      },
      session: { expiresAt: "2026-10-09T00:00:00.000Z" },
    });
  });

  it("never returns anything that could authenticate a request", async () => {
    const { jar } = await login(harness);
    const response = await harness.app.request("/api/me", {
      headers: { cookie: cookieHeader(jar) },
    });
    const text = await response.text();

    expect(text).not.toContain(jar[SESSION_COOKIE] ?? "impossible");
    expect(text).not.toContain(jar[CSRF_COOKIE] ?? "impossible");
    expect(text).not.toContain("x-access-token");
  });
});

describe("POST /api/auth/logout", () => {
  it("deletes the session and clears both cookies", async () => {
    const { jar } = await login(harness);

    const response = await harness.app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER]: jar[CSRF_COOKIE] ?? "" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const cleared = cookiesFrom(response);
    expect(cleared[SESSION_COOKIE]).toBe("");
    expect(cleared[CSRF_COOKIE]).toBe("");

    const rows = await harness.handle.client.query("SELECT * FROM sessions");
    expect(rows.rows).toHaveLength(0);

    const me = await harness.app.request("/api/me", { headers: { cookie: cookieHeader(jar) } });
    expect(await me.json()).toEqual({ profile: null });
  });

  it("rejects a logout with no CSRF header, which is the cross site case", async () => {
    const { jar } = await login(harness);

    const response = await harness.app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookieHeader(jar) },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "csrf_failed" });

    const rows = await harness.handle.client.query("SELECT * FROM sessions");
    expect(rows.rows).toHaveLength(1);
  });

  it("rejects a CSRF header that does not match the cookie", async () => {
    const { jar } = await login(harness);

    const response = await harness.app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER]: "some-other-token" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects a CSRF token from a different session, even when header and cookie agree", async () => {
    const victim = await login(harness);
    await harness.app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: cookieHeader(victim.jar),
        [CSRF_HEADER]: victim.jar[CSRF_COOKIE] ?? "",
      },
    });

    // A second, unrelated login. Its CSRF token must not work against the first session.
    const attacker = await login(harness);
    const stolen = attacker.jar[CSRF_COOKIE] ?? "";

    const response = await harness.app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(victim.jar[SESSION_COOKIE] ?? "")}; ${CSRF_COOKIE}=${encodeURIComponent(stolen)}`,
        [CSRF_HEADER]: stolen,
      },
    });
    expect(response.status).toBe(403);
  });

  it("is a no-op, not an error, for somebody who is already logged out", async () => {
    const response = await harness.app.request("/api/auth/logout", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("rate limiting", () => {
  it("stops a flood of login starts and says when to come back", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };

    for (let i = 0; i < 10; i += 1) {
      const ok = await harness.app.request("/api/auth/x/start", { headers });
      expect(ok.status).toBe(302);
    }

    const blocked = await harness.app.request("/api/auth/x/start", { headers });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(await blocked.json()).toMatchObject({ error: "rate_limited" });
  });

  it("limits per ip, so one noisy client does not lock out everybody", async () => {
    for (let i = 0; i < 11; i += 1) {
      await harness.app.request("/api/auth/x/start", {
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
    }

    const other = await harness.app.request("/api/auth/x/start", {
      headers: { "x-forwarded-for": "198.51.100.4" },
    });
    expect(other.status).toBe(302);
  });
});

describe("unknown routes", () => {
  it("answers with json, not an html error page", async () => {
    const response = await harness.app.request("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
