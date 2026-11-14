/**
 * The rate limiter's keys: the client ip, the memory bound and the per
 * session key. The flood tests through real routes are in `routes.test.ts`.
 */
import { readFileSync } from "node:fs";

import { Hono, type MiddlewareHandler } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import type { AppDeps, AppEnv } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SESSION_COOKIE } from "../src/auth/session.js";
import { rateLimit } from "../src/middleware/rate-limit.js";
import { cookieHeader, createHarness, login, TEST_ENV, type Harness } from "./harness.js";

/** A one route app with only the config the limiter reads. */
function miniApp(trustProxy: "on" | "off", limiter: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("deps", { config: { TRUST_PROXY: trustProxy } } as unknown as AppDeps);
    await next();
  });
  app.use("/x", limiter);
  app.get("/x", (c) => c.text("ok"));
  return app;
}

/** The bindings `@hono/node-server` passes, with only the socket address. */
function socket(remoteAddress: string) {
  return { incoming: { socket: { remoteAddress } } };
}

describe("TRUST_PROXY", () => {
  it("is off by default", () => {
    expect(loadConfig({ ...TEST_ENV }).TRUST_PROXY).toBe("off");
  });

  it("takes on and off, and refuses anything else", () => {
    expect(loadConfig({ ...TEST_ENV, TRUST_PROXY: "on" }).TRUST_PROXY).toBe("on");
    expect(loadConfig({ ...TEST_ENV, TRUST_PROXY: "off" }).TRUST_PROXY).toBe("off");
    expect(() => loadConfig({ ...TEST_ENV, TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
  });
});

describe("the client ip", () => {
  const ask = (app: Hono<AppEnv>, headers: Record<string, string>, from = "192.0.2.1") =>
    app.request("/x", { headers }, socket(from));

  it("never reads X-Forwarded-For, with the setting off", async () => {
    const app = miniApp("off", rateLimit({ limit: 1, windowSeconds: 60 }));
    expect((await ask(app, { "x-forwarded-for": "203.0.113.1" })).status).toBe(200);
    expect((await ask(app, { "x-forwarded-for": "203.0.113.2" })).status).toBe(429);
  });

  it("never reads X-Forwarded-For, with the setting on", async () => {
    const app = miniApp("on", rateLimit({ limit: 1, windowSeconds: 60 }));
    const real = { "x-real-ip": "198.51.100.7" };
    expect((await ask(app, { ...real, "x-forwarded-for": "203.0.113.1" })).status).toBe(200);
    expect((await ask(app, { ...real, "x-forwarded-for": "203.0.113.2" })).status).toBe(429);
  });

  it("ignores X-Real-IP with the setting off and uses the socket address", async () => {
    const app = miniApp("off", rateLimit({ limit: 1, windowSeconds: 60 }));
    expect((await ask(app, { "x-real-ip": "198.51.100.1" })).status).toBe(200);
    expect((await ask(app, { "x-real-ip": "198.51.100.2" })).status).toBe(429);
    expect((await ask(app, {}, "192.0.2.99")).status).toBe(200);
  });

  it("reads X-Real-IP with the setting on, one limit per value", async () => {
    const app = miniApp("on", rateLimit({ limit: 1, windowSeconds: 60 }));
    expect((await ask(app, { "x-real-ip": "198.51.100.1" })).status).toBe(200);
    expect((await ask(app, { "x-real-ip": "198.51.100.1" })).status).toBe(429);
    expect((await ask(app, { "x-real-ip": "198.51.100.2" })).status).toBe(200);
  });

  it("falls back to the socket address when X-Real-IP is missing or empty", async () => {
    const app = miniApp("on", rateLimit({ limit: 1, windowSeconds: 60 }));
    expect((await ask(app, {}, "192.0.2.5")).status).toBe(200);
    expect((await ask(app, { "x-real-ip": "" }, "192.0.2.5")).status).toBe(429);
    expect((await ask(app, {}, "192.0.2.6")).status).toBe(200);
  });

  it("is unknown without a socket, one shared limit, never a thrown error", async () => {
    const app = miniApp("off", rateLimit({ limit: 1, windowSeconds: 60 }));
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(429);
  });
});

describe("the memory bound", () => {
  const byHeader = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header("k") ?? "none";
  const ask = (app: Hono<AppEnv>, k: string) => app.request("/x", { headers: { k } });

  it("keeps at most 10,000 keys by default, the oldest window out first", async () => {
    const app = miniApp("off", rateLimit({ limit: 1, windowSeconds: 60, keyOf: byHeader }));
    for (let i = 0; i < 10_000; i += 1) expect((await ask(app, `k${i}`)).status).toBe(200);
    expect((await ask(app, "k0")).status).toBe(429);
    expect((await ask(app, "new")).status).toBe(200);
    // `new` pushed out only `k0`, the oldest window; a later ask does not make a key newer.
    expect((await ask(app, "k1")).status).toBe(429);
    expect((await ask(app, "k0")).status).toBe(200);
    expect((await ask(app, "k9999")).status).toBe(429);
  });

  it("drops expired windows before it drops a live one", async () => {
    let at = 0;
    const app = miniApp(
      "off",
      rateLimit({ limit: 1, windowSeconds: 60, keyOf: byHeader, maxKeys: 2, now: () => at }),
    );
    expect((await ask(app, "a")).status).toBe(200);
    at = 30_000;
    expect((await ask(app, "b")).status).toBe(200);
    at = 61_000; // `a` has expired, `b` has not
    expect((await ask(app, "c")).status).toBe(200);
    expect((await ask(app, "b")).status).toBe(429);
  });

  it("cuts a key to its first 128 characters", async () => {
    const app = miniApp("off", rateLimit({ limit: 1, windowSeconds: 60, keyOf: byHeader }));
    const head = "a".repeat(128);
    expect((await ask(app, `${head}1`)).status).toBe(200);
    expect((await ask(app, `${head}2`)).status).toBe(429);
  });
});

describe("per session only for a live session", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness.close();
  });

  const multisends = (headers: Record<string, string>) =>
    harness.app.request("/api/me/multisends", { headers });

  it("counts made up cookies on the client ip, so a new cookie is not a new limit", async () => {
    harness = await createHarness({ env: { TRUST_PROXY: "on" } });
    const ip = { "x-real-ip": "203.0.113.20" };
    for (let i = 0; i < 30; i += 1) {
      const fake = await multisends({ ...ip, cookie: `${SESSION_COOKIE}=made-up-${i}` });
      expect(fake.status).toBe(401);
    }
    const over = await multisends({ ...ip, cookie: `${SESSION_COOKIE}=made-up-last` });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
  });

  it("counts a missing cookie on the client ip too", async () => {
    harness = await createHarness({ env: { TRUST_PROXY: "on" } });
    const ip = { "x-real-ip": "203.0.113.21" };
    for (let i = 0; i < 15; i += 1) expect((await multisends(ip)).status).toBe(401);
    for (let i = 0; i < 15; i += 1) {
      expect((await multisends({ ...ip, cookie: `${SESSION_COOKIE}=x${i}` })).status).toBe(401);
    }
    expect((await multisends(ip)).status).toBe(429);
  });

  it("counts an expired session on the client ip", async () => {
    harness = await createHarness({ env: { TRUST_PROXY: "on" } });
    const { jar } = await login(harness);
    harness.setNow(new Date("2026-12-31T00:00:00.000Z"));
    const ip = { "x-real-ip": "203.0.113.22" };
    for (let i = 0; i < 30; i += 1) expect((await multisends(ip)).status).toBe(401);
    const expired = await multisends({ ...ip, cookie: cookieHeader(jar) });
    expect(expired.status).toBe(429);
  });

  it("keys a live session by the session, apart from its ip and across ips", async () => {
    harness = await createHarness({ env: { TRUST_PROXY: "on" } });
    const { jar } = await login(harness);
    const cookie = cookieHeader(jar);
    const ip = { "x-real-ip": "203.0.113.23" };
    for (let i = 0; i < 30; i += 1) expect((await multisends(ip)).status).toBe(401);
    // The ip is used up, the live session on the same ip is not.
    for (let i = 0; i < 30; i += 1) {
      expect((await multisends({ ...ip, cookie })).status).toBe(200);
    }
    // Its own 30 are used up, from any ip.
    const other = await multisends({ "x-real-ip": "198.51.100.30", cookie });
    expect(other.status).toBe(429);
  });

  it("no route keys by the raw session cookie", () => {
    const routes = ["bind", "claims", "drops", "handles", "my-multisends"];
    for (const name of routes) {
      const source = readFileSync(new URL(`../src/routes/${name}.ts`, import.meta.url), "utf8");
      expect(source, name).not.toMatch(/readSessionCookie\(c\)\s*\?\?\s*clientIp/);
    }
  });
});
