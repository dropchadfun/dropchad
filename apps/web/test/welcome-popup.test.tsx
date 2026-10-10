/**
 * The welcome popup: the text
 * exactly, once per browser, remembered when it is closed by either button, Escape or an outside
 * click, never in the server HTML, so never in a link preview, the og image or the share card.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const LINES = [
  "dropchad is in testnet mode right now, on solana devnet and robinhood chain testnet.",
  "everything here is test money, free to get and worth nothing, so play, drop and claim with zero risk.",
  "just keep your real coins safe in your main wallet for now.",
];

/** A storage with only the two calls the popup uses. */
function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    size: () => map.size,
  };
}
const broken = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("welcome text, exactly the owner's", () => {
  it("the title and the three lines", async () => {
    const { WELCOME_TITLE, WELCOME_LINES } = await import("@/lib/welcome");
    expect(WELCOME_TITLE).toBe("welcome chad 🤌");
    expect(WELCOME_LINES).toEqual(LINES);
  });

  it("set up my test wallet goes to the testnet part of /how", async () => {
    const { WELCOME_SETUP_HREF } = await import("@/lib/welcome");
    expect(WELCOME_SETUP_HREF).toBe("/how#testnet");
  });
});

describe("remembered in the browser when it is closed, not when it shows", () => {
  it("a new browser sees it", async () => {
    const { shouldShowWelcome } = await import("@/lib/welcome");
    expect(shouldShowWelcome(memory(), true)).toBe(true);
  });

  it("showing it writes nothing, so a reload before closing shows it again", async () => {
    const { shouldShowWelcome } = await import("@/lib/welcome");
    const store = memory();
    shouldShowWelcome(store, true);
    expect(store.size()).toBe(0);
    expect(shouldShowWelcome(store, true)).toBe(true);
  });

  it("after it is closed it never shows again", async () => {
    const { rememberWelcome, shouldShowWelcome } = await import("@/lib/welcome");
    const store = memory();
    rememberWelcome(store);
    expect(shouldShowWelcome(store, true)).toBe(false);
  });

  it("no storage: it does not show, and closing does not throw", async () => {
    const { rememberWelcome, shouldShowWelcome } = await import("@/lib/welcome");
    expect(shouldShowWelcome(broken, true)).toBe(false);
    expect(() => rememberWelcome(broken)).not.toThrow();
  });

  it("not testnet only: it never shows", async () => {
    const { shouldShowWelcome } = await import("@/lib/welcome");
    expect(shouldShowWelcome(memory(), false)).toBe(false);
  });
});

describe("the box", () => {
  it("a dialog with the title, the lines and the two buttons", async () => {
    const { WelcomeBox } = await import("@/components/site/WelcomePopup");
    const html = renderToStaticMarkup(<WelcomeBox onClose={() => {}} onSetup={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("welcome chad 🤌");
    for (const line of LINES) expect(html).toContain(line);
    expect(html).toContain(">set up my test wallet<");
    expect(html).toContain(">lets go<");
    expect(html).toContain("border-chad-accent");
  });

  it("the server HTML never carries it", async () => {
    const { WelcomePopup } = await import("@/components/site/WelcomePopup");
    expect(renderToStaticMarkup(<WelcomePopup />)).toBe("");
  });

  it("Escape and an outside click close it through the shared dismiss hook", () => {
    const src = read("components/site/WelcomePopup.tsx");
    expect(src).toContain('from "@/lib/dismiss"');
    expect(src).toContain("useDismiss(");
    expect(src).toContain("rememberWelcome(");
  });

  it("on every page: the root layout renders it", () => {
    expect(read("app/layout.tsx")).toContain("<WelcomePopup />");
  });

  it("/how has the testnet anchor", async () => {
    const { HowPage } = await import("@/components/how/HowPage");
    const html = renderToStaticMarkup(<HowPage chains={null} />);
    expect(html).toMatch(/<section id="testnet"[^>]*>\s*<div[^>]*><h2[^>]*>try it on testnet</);
  });

  it("/how#testnet lands with the title below the sticky top bar", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(css).toMatch(/#testnet\s*\{[^}]*scroll-margin-top:\s*64px;/);
  });

  it("not in the og image or the share card", () => {
    expect(read("components/drops/ShareCard.tsx")).not.toContain("WelcomePopup");
  });
});
