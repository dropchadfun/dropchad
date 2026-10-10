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
import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  readonly limit: number;
  readonly windowSeconds: number;
  /** Defaults to the client ip. */
  readonly keyOf?: (c: Context) => string;
  readonly now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * The client ip, from the proxy headers when present.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy we control. In dev there is no proxy and
 * the socket address is used. On a server this must be paired with a trusted proxy setting;
 * until then the limiter is a speed bump, not a wall, and it is written down here rather than
 * pretended away.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded !== undefined && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;
  const keyOf = options.keyOf ?? clientIp;
  const windowMs = options.windowSeconds * 1000;

  return async (c, next) => {
    const at = now();
    const key = keyOf(c);

    // Cheap sweep: drop everything already expired. The map only holds live windows.
    for (const [existing, bucket] of buckets) {
      if (bucket.resetAt <= at) buckets.delete(existing);
    }

    const bucket = buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= at) {
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
