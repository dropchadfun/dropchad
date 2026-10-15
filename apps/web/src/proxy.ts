import { NextResponse, type NextRequest } from "next/server";

import { newNonce, sitePolicy } from "@/lib/csp";

/**
 * Sets the strict CSP on every page. The policy goes on the
 * response for the browser and on the request for the render: Next reads the nonce from the
 * request's CSP and puts it on its own scripts; the root layout reads `x-nonce` for ours.
 * From Next's CSP guide (`node_modules/next/dist/docs`, 16.3.8).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = sitePolicy(nonce, process.env["NODE_ENV"] === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

/**
 * Pages only. The api, static files, the image route, the favicon and `next/link` prefetches
 * keep the small enforced CSP from `next.config.ts`.
 */
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
