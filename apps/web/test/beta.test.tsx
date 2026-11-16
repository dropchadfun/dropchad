/**
 * The `beta` mark in the top bar and the `beta` and `caps per drop`
 * sections on `/terms` and `/about`, only when `isTestnetOnly()` is false. The flag is set both ways with
 * `vi.doMock`, then the modules are loaded fresh. Rendered with `react-dom/server`, no browser.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Chains from "@/lib/chains";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const BETA_LINES = [
  "dropchad is in beta. the code is new and it can have bugs.",
  "each drop has a limit, so less money is at risk while the code is new.",
  "you use dropchad at your own risk.",
  "drops use real coins. only drop what you are ok to lose.",
];
const CAPS_LINES = [
  "in the beta one drop can hold at most 2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana.",
  "other tokens have no value cap.",
  "a drop over the cap is refused when you make it.",
];

interface PageModule {
  default: () => ReactElement | Promise<ReactElement>;
  metadata: Metadata;
}

/** The pages and the top bar lockup, loaded with `TESTNET_ONLY` set to `testnetOnly`. */
async function load(testnetOnly: boolean) {
  vi.resetModules();
  // no api in a test, so the live view is the one with no answer.
  vi.doMock("@/lib/live-chains", () => ({
    readLiveChains: () => Promise.resolve({ listed: new Set(), paused: new Set() }),
  }));
  vi.doMock("@/lib/chains", async (importOriginal) => ({
    ...(await importOriginal<typeof Chains>()),
    TESTNET_ONLY: testnetOnly,
  }));
  const terms: PageModule = await import("@/app/terms/page");
  const about: PageModule = await import("@/app/about/page");
  const { Wordmark } = await import("@/components/site/Wordmark");
  return { terms, about, Wordmark };
}

/** The visible words only, tags out and spaces folded. */
const words = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
/** The section titles, in order. */
const titles = (markup: string): string[] =>
  [...markup.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1] ?? "");
/** The small marks next to the wordmark: their words. */
const marks = (markup: string): string[] =>
  [...markup.matchAll(/<span class="[^"]*\btype-label\b[^"]*"[^>]*>([^<]*)<\/span>/g)].map(
    (m) => m[1] ?? "",
  );

afterEach(() => {
  vi.doUnmock("@/lib/chains");
  vi.resetModules();
});

describe("testnet, isTestnetOnly() true", () => {
  it("the top bar shows the testnet mark and no beta mark", async () => {
    const { Wordmark } = await load(true);
    expect(marks(renderToStaticMarkup(<Wordmark />))).toEqual(["testnet"]);
  });

  for (const name of ["terms", "about"] as const) {
    it(`/${name} keeps testnet only, no beta or caps section`, async () => {
      const page = (await load(true))[name];
      const markup = renderToStaticMarkup(await page.default());
      expect(titles(markup)).toContain("testnet only");
      expect(titles(markup)).not.toContain("beta");
      expect(titles(markup)).not.toContain("caps per drop");
      for (const line of [...BETA_LINES, ...CAPS_LINES]) expect(words(markup)).not.toContain(line);
    });
  }

  it("the descriptions stay the testnet ones", async () => {
    const { terms, about } = await load(true);
    expect(terms.metadata.description).toBe("the short terms for using dropchad on testnet.");
    expect(about.metadata.description).toBe(
      "who builds dropchad, testnet only, no token, open code.",
    );
  });
});

describe("mainnet, isTestnetOnly() false", () => {
  it("the top bar shows the beta mark and no testnet mark", async () => {
    const { Wordmark } = await load(false);
    expect(marks(renderToStaticMarkup(<Wordmark />))).toEqual(["beta"]);
  });

  it("the beta mark looks exactly like the testnet mark", async () => {
    const { Wordmark: OnTestnet } = await load(true);
    const testnet = renderToStaticMarkup(<OnTestnet />);
    const { Wordmark: OnMainnet } = await load(false);
    const beta = renderToStaticMarkup(<OnMainnet />);
    const classOf = (markup: string, word: string): string =>
      markup.match(new RegExp(`<span class="([^"]*)"[^>]*>${word}</span>`))?.[1] ?? "";
    expect(classOf(beta, "beta")).not.toBe("");
    expect(classOf(beta, "beta")).toBe(classOf(testnet, "testnet"));
    expect(classOf(beta, "beta")).not.toMatch(/accent|mint/);
  });

  for (const name of ["terms", "about"] as const) {
    it(`/${name}: beta and caps per drop in place of testnet only, the exact words`, async () => {
      const page = (await load(false))[name];
      const markup = renderToStaticMarkup(await page.default());
      const list = titles(markup);
      expect(list).not.toContain("testnet only");
      expect(list).toContain("beta");
      expect(list.indexOf("caps per drop")).toBe(list.indexOf("beta") + 1);
      for (const line of [...BETA_LINES, ...CAPS_LINES]) expect(words(markup)).toContain(line);
      expect(words(markup)).not.toMatch(/test coins|testnet/);
    });
  }

  it("the mainnet descriptions", async () => {
    const { terms, about } = await load(false);
    expect(terms.metadata.description).toBe("the short terms for using dropchad.");
    expect(about.metadata.description).toBe("who builds dropchad, beta, no token, open code.");
  });
});
