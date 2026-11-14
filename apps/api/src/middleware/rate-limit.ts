/**
 * A fixed window rate limiter, in memory.
 *
 * It exists because the auth routes must not be free to hammer: `/api/auth/x/start` writes a row
 * per call, and `/api/auth/x/callback` is a guessing surface.
 *
 * **In memory means per process.** That is honest for one local dev process and for one server
 * container. The moment the api runs on more than one instance this has to move to Redis or to
 * Postgres, because a limit that each instance counts separately is not the limit you configured.
 * The interface below is deliberately small so that swap is one file.
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";

import type { AppDeps, AppEnv } from "../app.js";
import { readSessionCookie } from "../auth/cookies.js";
import { readSession } from "../auth/session.js";

/** Keys kept per limiter, and the longest key. */
export const RATE_LIMIT_MAX_KEYS = 10_000;
export const RATE_LIMIT_KEY_LENGTH = 128;

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  readonly limit: number;
  readonly windowSeconds: number;
  /** Defaults to the client ip. */
  readonly keyOf?: (c: Context) => string | Promise<string>;
  /** Defaults to `RATE_LIMIT_MAX_KEYS`. */
  readonly maxKeys?: number;
  readonly now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function socketAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket: a test request through `app.request`.
    return "unknown";
  }
}

/**
 * The client ip.
 *
 * `X-Real-IP` only with `TRUST_PROXY=on`, which is set only behind a reverse proxy that replaces that
 * header on every request. Otherwise the socket address. `X-Forwarded-For` is never read.
 */
export function clientIp(c: Context): string {
  const deps = (c as Context<AppEnv>).var.deps as AppDeps | undefined;
  if (deps?.config.TRUST_PROXY === "on") {
    const real = c.req.header("x-real-ip")?.trim();
    if (real !== undefined && real.length > 0) return real;
  }
  return socketAddress(c);
}

/**
 * The key of a limit per session: the session only when the cookie names a live
 * session row, else the client ip. A made up cookie is not a fresh limit.
 */
export async function sessionOrIpKey(c: Context<AppEnv>): Promise<string> {
  const sessionId = readSessionCookie(c);
  if (sessionId !== undefined) {
    const { db, config, now } = c.var.deps;
    const session = await readSession(db, { secret: config.SESSION_SECRET, sessionId, now: now() });
    if (session !== null) return `session:${session.id}`;
  }
  return `ip:${clientIp(c)}`;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;
  const keyOf = options.keyOf ?? clientIp;
  const maxKeys = options.maxKeys ?? RATE_LIMIT_MAX_KEYS;
  const windowMs = options.windowSeconds * 1000;

  return async (c, next) => {
    const at = now();
    const key = (await keyOf(c)).slice(0, RATE_LIMIT_KEY_LENGTH);

    // Every window has the same length and a key is only added when it is new, so the map is in
    // expiry order: the sweep stops at the first live window, and the first key is the oldest.
    for (const [existing, bucket] of buckets) {
      if (bucket.resetAt > at) break;
      buckets.delete(existing);
    }

    const bucket = buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= at) {
      buckets.delete(key);
      if (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next();
        if (oldest.done !== true) buckets.delete(oldest.value);
      }
      buckets.set(key, { count: 1, resetAt: at + windowMs });
      return next();
    }

    if (bucket.count >= options.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - at) / 1000));
      c.header("retry-after", String(retryAfter));
      return c.json({ error: "rate_limited", retryAfterSeconds: retryAfter }, 429);
    }

    bucket.count += 1;
    return next();
  };
}
