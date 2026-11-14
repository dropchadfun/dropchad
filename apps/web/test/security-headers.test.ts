/**
 * The site's security headers: set in `next.config.ts` for
 * every path. Paths without a page keep the small enforced CSP; every page gets the strict one
 * from `src/proxy.ts` (`csp-strict.test.tsx`). HSTS is Cloudflare's, never sent here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadHeaders(): Promise<Map<string, string>> {
  const config = (await import("../next.config")).default;
  const rules = (await config.headers?.()) ?? [];
  const all = rules.find((rule) => rule.source === "/(.*)");
  return new Map((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe("site security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends no X-Powered-By", async () => {
    const config = (await import("../next.config")).default;
    expect(config.poweredByHeader).toBe(false);
  });

  it("sends the shared headers on every path", async () => {
    const headers = await loadHeaders();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.has("strict-transport-security")).toBe(false);
  });

  it("turns off camera, microphone, geolocation, payment and usb, and keeps clipboard and share", async () => {
    const policy = (await loadHeaders()).get("permissions-policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect(policy).not.toMatch(/clipboard|web-share/);
  });

  it("enforces only frame-ancestors, object-src and base-uri", async () => {
    const enforced = (await loadHeaders()).get("content-security-policy");
    expect(enforced).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  });

  it("sends no report only policy: the strict one is enforced by the proxy", async () => {
    const headers = await loadHeaders();
    expect(headers.has("content-security-policy-report-only")).toBe(false);
  });
});
