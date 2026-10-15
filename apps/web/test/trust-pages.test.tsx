/**
 * `/about`, `/terms`, `/privacy`, `/contact`, the footer links, the claim page seed phrase line,
 * `robots.txt`, `sitemap.xml` and `security.txt`. Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { ClaimView } from "@/components/drops/ClaimView";
import { NO_SEED_LINE } from "@/components/drops/claim";
import { Footer } from "@/components/site/Footer";
import { CONTACT_EMAIL } from "@/lib/social";

const WEB = join(__dirname, "..");
const PUBLIC_REPO = "https://github.com/dropchadfun/dropchad";
const SITE = "https://dropchad.com";

interface PageModule {
  default: () => ReactElement;
  metadata: Metadata;
}

const PAGES = ["about", "terms", "privacy", "contact"] as const;
type PageName = (typeof PAGES)[number];

const modules: Record<PageName, PageModule> = {
  about: await import("@/app/about/page"),
  terms: await import("@/app/terms/page"),
  privacy: await import("@/app/privacy/page"),
  contact: await import("@/app/contact/page"),
};

const html = (name: PageName): string => renderToStaticMarkup(modules[name].default());
/** The visible words only, tags out and spaces folded, so a sentence split by a tag still reads. */
const words = (name: PageName): string =>
  html(name)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const hrefs = (markup: string): string[] =>
  [...markup.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1] ?? "");

describe("the four pages, what they all share", () => {
  for (const name of PAGES) {
    // lowercase but X. The hackathon's name and `DM` keep their capitals, as on
    // the hackathon line and in the security line.
    it(`/${name}: all lowercase but X, the hackathon's name and DM`, () => {
      const text = words(name).replace(/Crypto World's Fair|\bDM\b/g, "");
      expect(text.replace(/\bX\b/g, "")).toBe(text.replace(/\bX\b/g, "").toLowerCase());
      expect(String(modules[name].metadata.description)).toBe(
        String(modules[name].metadata.description).toLowerCase(),
      );
    });

    it(`/${name}: one h1, its own title and description, no picture of its own`, () => {
      const markup = html(name);
      expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
      expect(markup).toMatch(/<h1 class="[^"]*\btype-h1\b/);
      const { metadata } = modules[name];
      expect(metadata.title).toBe(name);
      expect(typeof metadata.description).toBe("string");
      expect(String(metadata.description).length).toBeGreaterThan(10);
      expect(metadata).not.toHaveProperty("openGraph");
      expect(metadata).not.toHaveProperty("twitter");
    });

    it(`/${name}: names no person, links no repo but the public one`, () => {
      const markup = html(name);
      // No X handle (an email's `@` does not count) and no link to a person's X page.
      const handle = /(?<![\w.])@[A-Za-z0-9_]{2,15}\b/;
      expect(words(name)).not.toMatch(handle);
      const source = readFileSync(join(WEB, "src", "app", name, "page.tsx"), "utf8");
      expect(source).not.toMatch(handle);
      expect(hrefs(markup).filter((h) => /\/\/(x|twitter)\.com\//.test(h))).toEqual([]);
      for (const href of hrefs(markup).filter((h) => h.includes("github.com"))) {
        expect(href).toBe(PUBLIC_REPO);
      }
    });

    it(`/${name}: the scale and the tokens only, no raw size or colour`, () => {
      const markup = html(name);
      expect(markup).not.toMatch(/text-\[\d+px\]/);
      expect(markup).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      // The `/how` column, 640px.
      expect(markup).toMatch(/max-w-160\b/);
    });

    it(`/${name}: an outside link opens in a new tab, safely`, () => {
      for (const anchor of html(name).match(/<a [^>]*href="https?:[^"]*"[^>]*>/g) ?? []) {
        expect(anchor).toContain('target="_blank"');
        expect(anchor).toContain('rel="noopener noreferrer"');
      }
    });
  }
});

describe("/about", () => {
  it("the dropchad team, the hackathon, testnet only, no token, the public repo", () => {
    const text = words("about");
    expect(text).toContain("the dropchad team");
    expect(text).toContain("Crypto World's Fair hackathon");
    expect(text).toMatch(/testnet only/);
    expect(text).toContain("dropchad has no token. anyone selling one is not us.");
    expect(hrefs(html("about"))).toContain(PUBLIC_REPO);
    expect(hrefs(html("about"))).toContain("https://colosseum.com/arena/projects/dropchad");
  });
});

describe("/terms", () => {
  it("testnet, final on chain, no advice, no illegal use, can stop, no warranty, not X", () => {
    const text = words("terms");
    expect(text).toMatch(/testnet/);
    expect(text).toMatch(/no value/);
    expect(text).toMatch(/final/);
    expect(text).toMatch(/cannot undo/);
    expect(text).not.toMatch(/can not/);
    expect(text).toContain("the fee is shown before you send.");
    expect(text).toMatch(/not financial advice/);
    expect(text).toMatch(/illegal/);
    expect(text).toMatch(/stop/);
    expect(text).toMatch(/no warranty/);
    expect(text).toMatch(/not run by X/);
    expect(text).not.toMatch(/investment|returns guaranteed/);
  });
});

describe("/privacy", () => {
  it("says what is stored, from the api's own tables", () => {
    const text = words("privacy");
    // profiles and x_users
    expect(text).toMatch(/X id/);
    expect(text).toMatch(/handle/);
    expect(text).toMatch(/picture/);
    // drops
    expect(text).toMatch(/refund address/);
    // handle_bindings
    expect(text).toMatch(/wallet/);
    expect(text).toMatch(/signature/);
    expect(text).toMatch(/tx hash/);
  });

  it("the X login, the session, the browser, the chain, the logs", () => {
    const text = words("privacy");
    expect(text).toMatch(/revoked/);
    expect(text).toMatch(/can not post/);
    expect(text).toMatch(/30 days/);
    expect(text).toMatch(/hackathon line/);
    expect(text).toMatch(/welcome popup/);
    expect(text).toMatch(/never leave/);
    expect(text).toMatch(/public and permanent/);
    expect(text).toMatch(/no analytics/);
    expect(text).toMatch(/cloudflare/);
    expect(text).toMatch(/ip address/);
  });

  it("points to the contact page to delete your data", () => {
    expect(hrefs(html("privacy"))).toContain("/contact");
  });
});

describe("/contact", () => {
  it("the email, Telegram and the security line", () => {
    expect(CONTACT_EMAIL).toBe("hello@dropchad.com");
    const links = hrefs(html("contact"));
    expect(links).toContain("mailto:hello@dropchad.com");
    expect(links).toContain("https://t.me/dropchad");
    expect(words("contact")).toContain("for a security issue, email us. we never DM you first.");
  });

  it("both links are mint, the one accent", () => {
    for (const anchor of html("contact").match(/<a [^>]*>/g) ?? []) {
      expect(anchor).toMatch(/text-chad-accent/);
    }
  });
});

describe("the footer, the trust links", () => {
  const markup = renderToStaticMarkup(<Footer />);
  const text = (markup.match(/<a [^>]*>[^<]+<\/a>/g) ?? []).map((a) => ({
    href: /href="([^"]*)"/.exec(a)?.[1],
    label: />([^<]+)<\/a>$/.exec(a)?.[1],
    anchor: a,
  }));

  it("how it works, about, terms, privacy, contact, github, in that order", () => {
    expect(text.map((t) => t.label)).toEqual([
      "how it works",
      "about",
      "terms",
      "privacy",
      "contact",
      "github",
    ]);
    expect(text.map((t) => t.href)).toEqual([
      "/how",
      "/about",
      "/terms",
      "/privacy",
      "/contact",
      PUBLIC_REPO,
    ]);
  });

  it("the site pages in the same tab, github in a new one, every link 44px and grey", () => {
    for (const t of text) {
      expect(t.anchor).toContain("min-h-11");
      expect(t.anchor).toContain("hover:text-chad-accent");
      if (t.label === "github") {
        expect(t.anchor).toContain('target="_blank"');
        expect(t.anchor).toContain('rel="noopener noreferrer"');
      } else {
        expect(t.anchor).not.toContain("target=");
      }
    }
  });
});

describe("the claim page line", () => {
  it("the words", () => {
    expect(NO_SEED_LINE).toBe("we never ask for your seed phrase or private keys.");
  });

  it("shows under the title in every state of the claim view", () => {
    const states = [
      { session: null, claims: null },
      { session: { handle: "" }, claims: null },
      { session: { handle: "alice" }, claims: [] },
    ];
    for (const state of states) {
      const markup = renderToStaticMarkup(
        <ClaimView {...state} freshLoginSecondsLeft={600} selected={null} />,
      );
      expect(markup).toContain(NO_SEED_LINE);
      expect(markup.indexOf("</h1>")).toBeLessThan(markup.indexOf(NO_SEED_LINE));
      expect(markup).toMatch(
        new RegExp(`<p class="[^"]*type-small[^"]*text-chad-text-dim[^"]*">${NO_SEED_LINE}`),
      );
    }
  });

  it("the could not be read screen carries it too", () => {
    const src = readFileSync(join(WEB, "src", "components", "drops", "ClaimPage.tsx"), "utf8");
    expect(src).toContain("NO_SEED_LINE");
  });
});

describe("robots.txt", () => {
  it("every agent allowed, and the sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${SITE}/sitemap.xml`,
    });
  });
});

describe("sitemap.xml", () => {
  it("the site pages on dropchad.com, no drop, multisend or profile page", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(
      ["/", "/how", "/boards", "/create", "/claim", "/about", "/terms", "/privacy", "/contact"].map(
        (path) => (path === "/" ? SITE : `${SITE}${path}`),
      ),
    );
    for (const url of urls) expect(url).not.toMatch(/\/(d|m|u)\//);
  });
});

describe("security.txt", () => {
  const file = readFileSync(join(WEB, "public", ".well-known", "security.txt"), "utf8");
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}: (.+)$`, "m").exec(file)?.[1]?.trim();

  it("contact, languages and canonical, RFC 9116", () => {
    expect(field("Contact")).toBe("mailto:hello@dropchad.com");
    expect(field("Preferred-Languages")).toBe("en");
    expect(field("Canonical")).toBe(`${SITE}/.well-known/security.txt`);
  });

  it("expires in the future, at most a year ahead", () => {
    const expires = Date.parse(field("Expires") ?? "");
    expect(Number.isNaN(expires)).toBe(false);
    const now = Date.now();
    expect(expires).toBeGreaterThan(now);
    expect(expires - now).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });
});
