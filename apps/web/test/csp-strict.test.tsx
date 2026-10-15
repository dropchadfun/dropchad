/**
 * The site's strict CSP: enforced on every
 * page, a fresh nonce per request from `src/proxy.ts`, no `'unsafe-inline'` for scripts. Styles
 * keep `'unsafe-inline'` this round. The hackathon line's inline script carries the nonce.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HackathonLine } from "@/components/site/HackathonLine";
import { newNonce, sitePolicy } from "@/lib/csp";
import { config, proxy } from "@/proxy";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "font-inter" }),
  Space_Grotesk: () => ({ variable: "font-grotesk" }),
}));

// The layout's other parts need the Next router; only the hackathon line matters here.
vi.mock("@/components/site/Header", () => ({ Header: () => null }));
vi.mock("@/components/site/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/site/BottomBar", () => ({ BottomBar: () => null }));
vi.mock("@/components/site/WelcomePopup", () => ({ WelcomePopup: () => null }));

const headerStore = { nonce: null as string | null };
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers(headerStore.nonce ? { "x-nonce": headerStore.nonce } : {})),
}));

function directives(policy: string | null): Record<string, string> {
  return Object.fromEntries(
    (policy ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = "", ...values] = part.split(/\s+/);
        return [name, values.join(" ")];
      }),
  );
}

function nonceOf(policy: string | null): string | undefined {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1];
}

describe("the policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is exactly the policy in production", () => {
    expect(directives(sitePolicy("abc123", false))).toEqual({
      "default-src": "'self'",
      "script-src": "'self' 'nonce-abc123' 'strict-dynamic'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data: blob: https:",
      "connect-src": "'self'",
      "font-src": "'self'",
      "form-action": "'self'",
      "object-src": "'none'",
      "base-uri": "'self'",
      "frame-ancestors": "'none'",
    });
  });

  it("never allows inline scripts", () => {
    for (const dev of [false, true]) {
      expect(directives(sitePolicy("abc123", dev))["script-src"]).not.toContain("'unsafe-inline'");
    }
  });

  it("adds 'unsafe-eval' in development only", () => {
    expect(directives(sitePolicy("abc123", true))["script-src"]).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'",
    );
    expect(sitePolicy("abc123", false)).not.toContain("unsafe-eval");
  });

  it("makes a new random base64 nonce of at least 16 bytes each time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const nonce = newNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(Buffer.from(nonce, "base64").length).toBeGreaterThanOrEqual(16);
      seen.add(nonce);
    }
    expect(seen.size).toBe(50);
  });
});

describe("the proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enforces the policy with a nonce on a page, no report only header", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = proxy(new NextRequest("https://dropchad.com/claim"));
    const policy = res.headers.get("content-security-policy");
    const nonce = nonceOf(policy);
    expect(nonce).toBeDefined();
    expect(policy).toBe(sitePolicy(nonce ?? "", false));
    expect(res.headers.has("content-security-policy-report-only")).toBe(false);
  });

  it("gives every request its own nonce", () => {
    const a = nonceOf(
      proxy(new NextRequest("https://dropchad.com/")).headers.get("content-security-policy"),
    );
    const b = nonceOf(
      proxy(new NextRequest("https://dropchad.com/")).headers.get("content-security-policy"),
    );
    expect(a).not.toBe(b);
  });

  it("hands the same nonce and policy to the render", () => {
    // Next's way to pass request headers on from a proxy: `x-middleware-request-<name>`.
    const res = proxy(new NextRequest("https://dropchad.com/"));
    const policy = res.headers.get("content-security-policy");
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(policy));
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
  });

  it("skips the api, static files, the favicon and prefetches", () => {
    const rule = config.matcher[0];
    if (rule === undefined) throw new Error("no matcher");
    const pattern = new RegExp(`^${rule.source}$`);
    for (const page of ["/", "/claim", "/create", "/d/0xabc", "/m/0xabc", "/u/someone"]) {
      expect(pattern.test(page)).toBe(true);
    }
    for (const path of ["/api/me", "/_next/static/a.js", "/_next/image", "/favicon.ico"]) {
      expect(pattern.test(path)).toBe(false);
    }
    expect(rule.missing).toEqual([
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ]);
  });
});

describe("the hackathon line script", () => {
  it("carries the nonce it is given", () => {
    const html = renderToStaticMarkup(<HackathonLine nonce="n0nce" />);
    expect(html).toMatch(/<script [^>]*nonce="n0nce"/);
  });

  it("the root layout reads the request nonce and passes it on", async () => {
    headerStore.nonce = "fromproxy";
    const { default: RootLayout } = await import("@/app/layout");
    const tree = (await RootLayout({ children: null as ReactNode })) as React.ReactElement;
    const html = renderToStaticMarkup(tree);
    expect(html).toMatch(/<script [^>]*nonce="fromproxy"/);
    headerStore.nonce = null;
  });
});
