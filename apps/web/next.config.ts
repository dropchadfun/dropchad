import type { NextConfig } from "next";

/**
 * Where `apps/api` listens. In dev that is 4000: the X callback is registered on
 * `http://localhost:3000/api/auth/x/callback`, so this app owns 3000 and forwards `/api/*` there.
 * One origin means the PKCE cookie and the session cookie are shared.
 *
 * Server side only. It is never `NEXT_PUBLIC_`, the browser always talks to its own origin.
 * `127.0.0.1`, never `localhost`; the same default as `src/lib/api-origin.ts`.
 */
const apiOrigin = process.env["API_ORIGIN"] ?? "http://127.0.0.1:4000";

/**
 * The site's security headers, on every path. The strict CSP
 * with a nonce is set on every page by `src/proxy.ts`; the small enforced one here covers the
 * paths without a page (the api, static files). HSTS is Cloudflare's.
 */
function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    },
  ];
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/(.*)", headers: securityHeaders() }]);
  },
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]);
  },
};

export default nextConfig;
