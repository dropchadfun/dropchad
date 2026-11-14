/**
 * The api's security headers. Set after the route ran, and
 * only where the route set none, so the token logo route keeps its own stricter CSP. Not
 * Hono's `secureHeaders`: it overwrites a route's header and adds HSTS, which is Cloudflare's.
 */
import type { MiddlewareHandler } from "hono";

export const API_HEADERS: readonly (readonly [string, string])[] = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "no-referrer"],
  ["Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"],
];

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    // The dev only proof page is a real page with its own script. It answers on localhost in
    // development only; everywhere else it is the same 404 as any unknown route.
    const devPage = c.req.path.startsWith("/api/dev/");
    for (const [name, value] of API_HEADERS) {
      if (devPage && name === "Content-Security-Policy") continue;
      if (!c.res.headers.has(name)) c.res.headers.set(name, value);
    }
    c.res.headers.delete("X-Powered-By");
  };
}
