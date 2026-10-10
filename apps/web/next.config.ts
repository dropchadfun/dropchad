import type { NextConfig } from "next";

/**
 * Where `apps/api` listens. In dev that is 4000: the X callback is registered on
 * `http://localhost:3000/api/auth/x/callback`, so this app owns 3000 and forwards `/api/*` there.
 * One origin means the PKCE cookie and the session cookie are shared.
 *
 * Server side only. It is never `NEXT_PUBLIC_`, the browser always talks to its own origin.
 */
const apiOrigin = process.env["API_ORIGIN"] ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  typedRoutes: true,
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]);
  },
};

export default nextConfig;
