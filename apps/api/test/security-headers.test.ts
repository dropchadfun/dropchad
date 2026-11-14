/**
 * The api's security headers: every answer, whatever its
 * status, and never over a header a route set itself. HSTS is Cloudflare's, never sent here.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { TokenChecker } from "../src/chain/svm/token-check.js";
import { createHarness, type Harness } from "./harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const API_CSP = "default-src 'none'; frame-ancestors 'none'";

function expectShared(response: Response): void {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-powered-by")).toBeNull();
  expect(response.headers.get("strict-transport-security")).toBeNull();
}

describe("api security headers", () => {
  it("on a JSON answer", async () => {
    harness = await createHarness();
    const response = await harness.app.request("/api/health");
    expect(response.status).toBe(200);
    expectShared(response);
    expect(response.headers.get("content-security-policy")).toBe(API_CSP);
  });

  it("on a 404", async () => {
    harness = await createHarness();
    const response = await harness.app.request("/api/nope");
    expect(response.status).toBe(404);
    expectShared(response);
    expect(response.headers.get("content-security-policy")).toBe(API_CSP);
  });

  it("on a redirect and on a 429", async () => {
    harness = await createHarness();
    const first = await harness.app.request("/api/auth/x/start");
    expect(first.status).toBe(302);
    expectShared(first);
    let last = first;
    for (let i = 0; i < 10; i += 1) last = await harness.app.request("/api/auth/x/start");
    expect(last.status).toBe(429);
    expectShared(last);
    expect(last.headers.get("content-security-policy")).toBe(API_CSP);
  });

  it("keeps the token logo route's own stricter CSP", async () => {
    const checker = {
      check: () => Promise.reject(new Error("not used")),
      logo: () =>
        Promise.resolve({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          contentType: "image/png",
        }),
    } as unknown as TokenChecker;
    harness = await createHarness({ tokenChecker: checker });
    const response = await harness.app.request(
      "/api/tokens/So11111111111111111111111111111111111111112/logo?chain=solana",
    );
    expect(response.status).toBe(200);
    expectShared(response);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("leaves the dev only proof page usable in local development", async () => {
    harness = await createHarness({ env: { NODE_ENV: "development" } });
    const response = await harness.app.request("http://localhost:3000/api/dev/proof");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
