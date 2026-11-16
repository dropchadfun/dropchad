/**
 * `/about`, `/terms`, `/privacy`, `/contact`, the footer links, the claim page seed phrase line,
 * `robots.txt`, `sitemap.xml` and `security.txt`. Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { ClaimView } from "@/components/drops/ClaimView";
import { CLAIM_RISK_LINE, NO_SEED_LINE } from "@/components/drops/claim";
import { Footer } from "@/components/site/Footer";
import { CONTACT_EMAIL } from "@/lib/social";

// no api in a test, so the live view is the one with no answer.
vi.mock("@/lib/live-chains", () => ({
  readLiveChains: () => Promise.resolve({ listed: new Set(), paused: new Set() }),
}));

const WEB = join(__dirname, "..");
const PUBLIC_REPO = "https://github.com/dropchadfun/dropchad";
const SITE = "https://dropchad.com";
/** The one person's name on the trust pages, `/about` only. */
const BUILDER = "Einz";
const BUILDER_X = "https://x.com/einzxx";
/** The name warning, the footer and `/terms`. */
const NAME_WARNING =
  "Our official sites are dropchad.com and dropchad.fun. We have no token, any dropchad token you see is fake.";
/** A line as a regex, its dots and commas taken as they are. */
const literal = (line: string): string => line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface PageModule {
  default: () => ReactElement | Promise<ReactElement>;
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

/** `/about` and `/terms` are async since: each page is rendered once, here. */
const rendered = Object.fromEntries(
  await Promise.all(
    PAGES.map(async (name) => [name, renderToStaticMarkup(await modules[name].default())]),
  ),
) as Record<PageName, string>;
const html = (name: PageName): string => rendered[name];
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
    // the hackathon line and in the security line. The builder's name keeps
    // its capital too, and so does `2FA` in `/terms`. The name warning keeps its sentence
    // case. `DMs open` on `/contact` keeps its capitals, and X keeps its own in a description too.
    it(`/${name}: all lowercase but X, the hackathon's name, DM, 2FA, the builder, the warning, the stablecoin tickers`, () => {
      const text = words(name)
        .replace(NAME_WARNING, "")
        // The `tokens` line names USDC, USDT and USDG by their tickers.
        // A mainnet build shows the caps: SOL, ETH and USD1 keep their tickers too.
        .replace(/Crypto World's Fair|\bDMs?\b|\b2FA\b|\bUSD[CTG1]\b|\bSOL\b|\bETH\b/g, "")
        .replace(`built by ${BUILDER} .`, "");
      expect(text.replace(/\bX\b/g, "")).toBe(text.replace(/\bX\b/g, "").toLowerCase());
      const description = String(modules[name].metadata.description).replace(/\bX\b/g, "");
      expect(description).toBe(description.toLowerCase());
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
      // The exceptions: the builder's line on `/about` and our
      // own account on `/contact`.
      const xLinks = hrefs(markup).filter((h) => /\/\/(x|twitter)\.com\//.test(h));
      const allowed: Record<PageName, string[]> = {
        about: [BUILDER_X],
        contact: ["https://x.com/dropchadfun"],
        terms: [],
        privacy: [],
      };
      expect(xLinks).toEqual(allowed[name]);
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
  it("built by the builder, the hackathon, testnet only, no token, the public repo", () => {
    const text = words("about");
    // `words` puts a space where the link ends; the page reads `built by <name>.`
    expect(text).toContain(`built by ${BUILDER} .`);
    expect(text).not.toContain("the dropchad team");
    expect(text).toContain("Crypto World's Fair hackathon");
    // The build runs mainnet: the beta words, not testnet only.
    expect(text).toMatch(/dropchad is in beta/);
    expect(text).not.toMatch(/testnet only/);
    expect(text).toContain("dropchad has no token. anyone selling one is not us.");
    expect(hrefs(html("about"))).toContain(PUBLIC_REPO);
    expect(hrefs(html("about"))).toContain("https://colosseum.com/arena/projects/dropchad");
  });

  // The one person's name on the trust pages, linked to X.
  it("the builder's name links to their X page in a new tab, the only name on the four pages", () => {
    const anchors = html("about").match(/<a [^>]*>[^<]*<\/a>/g) ?? [];
    const link = anchors.find((a) => a.includes(`href="${BUILDER_X}"`));
    expect(link).toContain(`>${BUILDER}</a>`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    for (const name of PAGES) {
      const count = html(name).toLowerCase().split(BUILDER.toLowerCase()).length - 1;
      expect(count, name).toBe(name === "about" ? 2 : 0);
    }
  });
});

describe("/terms", () => {
  it("testnet, final on chain, no advice, no illegal use, can stop, no warranty, not X", () => {
    const text = words("terms");
    // The build runs mainnet: the beta words, in place of the testnet words.
    expect(text).toMatch(/dropchad is in beta/);
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

  // Testnet and mainnet both.
  it("your X account, your wallet, tokens, our name, the words", () => {
    const text = words("terms");
    for (const title of ["your X account", "your wallet", "tokens", "our name"]) {
      expect(html("terms")).toMatch(new RegExp(`<h2[^>]*>${title}</h2>`));
    }
    expect(text).toContain(
      "your X account is how you claim. if someone takes over your X account, they can claim " +
        "your drops. that is your risk. keep it safe and turn on 2FA.",
    );
    expect(text).toContain(
      "you paste the wallet your claim goes to. if you paste a wrong address, the coins are " +
        "gone. we cannot get them back.",
    );
    expect(text).toContain(
      "anyone can drop any token. we do not check tokens. a token here is not a pick by us. " +
        "claims are at your own risk.",
    );
    expect(text).toContain(NAME_WARNING);
  });

  // testnet and mainnet both.
  it("tokens: the stablecoin issuer line", () => {
    expect(words("terms")).toContain(
      "stablecoins like USDC, USDT and USDG are controlled by their issuers. they can freeze or " +
        "remove balances. dropchad cannot change that.",
    );
  });

  // The `our name` line in mint, not a link.
  it("the our name line is mint text, not a link", () => {
    expect(html("terms")).toMatch(
      new RegExp(`<span class="[^"]*text-chad-accent[^"]*">${literal(NAME_WARNING)}</span>`),
    );
    expect(html("terms")).not.toMatch(new RegExp(`<a [^>]*>${literal(NAME_WARNING)}`));
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
  it("the email and the security line", () => {
    expect(CONTACT_EMAIL).toBe("hello@dropchad.com");
    const links = hrefs(html("contact"));
    expect(links).toContain("mailto:hello@dropchad.com");
    expect(words("contact")).toContain("for a security issue, email us. we never DM you first.");
  });

  // Telegram is a channel, nobody can write there.
  it("email first, then X with x.com/dropchadfun and DMs open, then security; no Telegram", () => {
    const markup = html("contact");
    const titles = [...markup.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(titles).toEqual(["email", "X", "security"]);
    expect(hrefs(markup)).toEqual(["mailto:hello@dropchad.com", "https://x.com/dropchadfun"]);
    expect(words("contact")).toContain("x.com/dropchadfun");
    expect(words("contact")).toContain("DMs open");
    expect(words("contact").indexOf("DMs open")).toBeGreaterThan(
      words("contact").indexOf("x.com/dropchadfun"),
    );
    expect(markup.toLowerCase()).not.toContain("telegram");
    expect(markup).not.toContain("t.me");
    expect(modules.contact.metadata.description).toBe("email and X for dropchad.");
  });

  it("the X link opens in a new tab, safely", () => {
    expect(html("contact")).toMatch(
      /<a [^>]*href="https:\/\/x.com\/dropchadfun"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
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

  // every page, testnet and mainnet both. Mint.
  it("the name warning under the links, one mint small line, no link", () => {
    const line = new RegExp(`<p class="([^"]*)">${literal(NAME_WARNING)}</p>`).exec(markup);
    expect(line?.[1]).toMatch(/\btype-small\b/);
    expect(line?.[1]).toMatch(/\btext-chad-accent\b/);
    expect(line?.[1]).not.toMatch(/text-chad-text-dim|hover:/);
    expect(markup.indexOf("github</a>")).toBeLessThan(markup.indexOf(NAME_WARNING));
    expect(markup).not.toMatch(/<a [^>]*>[^<]*Our official sites/);
  });
});

describe("the claim page line", () => {
  it("the words", () => {
    // Sentence case since.
    expect(NO_SEED_LINE).toBe("We never ask for your seed phrase or private keys.");
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
      // Mint since, the same size.
      expect(markup).toMatch(
        new RegExp(`<p class="[^"]*type-small[^"]*text-chad-accent[^"]*">${literal(NO_SEED_LINE)}`),
      );
    }
  });

  it("the could not be read screen carries it too", () => {
    const src = readFileSync(join(WEB, "src", "components", "drops", "ClaimPage.tsx"), "utf8");
    expect(src).toContain("NO_SEED_LINE");
  });

  // under the seed phrase line, the same style. Sentence case
  // and mint.
  it("the hacked X and wrong wallet line, the words", () => {
    expect(CLAIM_RISK_LINE).toBe(
      "If your X account is hacked or you paste a wrong wallet, we cannot get your coins back.",
    );
  });

  it("shows under the seed phrase line in every state of the claim view", () => {
    const states = [
      { session: null, claims: null },
      { session: { handle: "" }, claims: null },
      { session: { handle: "alice" }, claims: [] },
    ];
    for (const state of states) {
      const markup = renderToStaticMarkup(
        <ClaimView {...state} freshLoginSecondsLeft={600} selected={null} />,
      );
      expect(markup.indexOf(NO_SEED_LINE)).toBeGreaterThan(-1);
      expect(markup.indexOf(NO_SEED_LINE)).toBeLessThan(markup.indexOf(CLAIM_RISK_LINE));
      expect(markup).toMatch(
        new RegExp(
          `<p class="[^"]*type-small[^"]*text-chad-accent[^"]*">${literal(CLAIM_RISK_LINE)}`,
        ),
      );
    }
  });

  it("the could not be read screen carries it too, after the seed phrase line", () => {
    const src = readFileSync(join(WEB, "src", "components", "drops", "ClaimPage.tsx"), "utf8");
    expect(src).toContain("{CLAIM_RISK_LINE}");
    expect(src.indexOf("{NO_SEED_LINE}")).toBeLessThan(src.indexOf("{CLAIM_RISK_LINE}"));
    // Both mint.
    expect(src).toMatch(/className="[^"]*type-small[^"]*text-chad-accent[^"]*">\{NO_SEED_LINE\}/);
    expect(src).toMatch(
      /className="[^"]*type-small[^"]*text-chad-accent[^"]*">\{CLAIM_RISK_LINE\}/,
    );
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
