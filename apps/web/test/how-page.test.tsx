/**
 * The how it works page, `/how`: seven sections in simple
 * words, the fees read live from `GET /api/chains`, the testnet links and addresses checked by
 * hand. Plus the way in: the desktop menu and the footer. Rendered with
 * `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HowPage } from "@/components/how/HowPage";
import { FAQ, TESTNET, feeLines } from "@/components/how/how";
import { Footer } from "@/components/site/Footer";
import { NAV } from "@/components/site/Header";
import type { ChainInfo } from "@/lib/api";

/** The live `/api/chains` of, trimmed to what the page reads. */
const CHAINS: ChainInfo[] = [
  {
    key: "robinhood-testnet",
    chainId: 46630,
    family: "evm",
    nativeSymbol: "ETH",
    decimals: 18,
    defaultFeeBps: 100,
    minFee: "100000000000000",
    handleMode: true,
    tokenFeeTiers: [
      { upTo: 5, usd: "3", wei: "1110000000000000" },
      { upTo: 20, usd: "8", wei: "2960000000000000" },
      { upTo: 50, usd: "15", wei: "5550000000000000" },
      { upTo: 100, usd: "25", wei: "9250000000000000" },
      { upTo: 500, usd: "40", wei: "14800000000000000" },
    ],
  },
  {
    key: "solana-devnet",
    chainId: 103,
    family: "svm",
    nativeSymbol: "SOL",
    decimals: 9,
    defaultFeeBps: 100,
    minFee: "2500000",
    handleMode: true,
    tokenFeeTiers: [
      { upTo: 5, usd: "3", lamports: "24634587" },
      { upTo: 20, usd: "8", lamports: "65692232" },
      { upTo: 50, usd: "15", lamports: "123172935" },
      { upTo: 100, usd: "25", lamports: "205288225" },
      { upTo: 500, usd: "40", lamports: "328461160" },
    ],
  },
];

const html = renderToStaticMarkup(<HowPage chains={CHAINS} />);
/** The page as a reader sees it: the tags gone, the spaces folded. */
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("the way in", () => {
  it("the desktop menu ends with how it works, to /how", () => {
    expect(NAV.map((item) => item.label)).toEqual([
      "home",
      "boards",
      "drop",
      "claim",
      "how it works",
    ]);
    expect(NAV.find((item) => item.label === "how it works")?.href).toBe("/how");
  });

  it("the footer links to /how in the same tab, on phone and desktop", () => {
    const footer = renderToStaticMarkup(<Footer />);
    const link = footer.match(/<a [^>]*href="\/how"[^>]*>/)?.[0] ?? "";
    expect(link).not.toBe("");
    expect(link).not.toContain("target=");
    expect(footer).toContain(">how it works</a>");
  });
});

describe("the sections, in order", () => {
  it("has the titles top to bottom", () => {
    const titles = [
      "send crypto to anyone on X, by username.",
      "why dropchad",
      "what you can do",
      "how to send",
      "how to claim",
      "why it is safe",
      "fees",
      "try it on testnet",
      "coming next",
      "questions",
    ];
    const at = titles.map((title) => text.indexOf(title));
    for (const [i, position] of at.entries()) expect(position, titles[i]).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("1. the title is the one h1, h1-fit, on one line", () => {
    const h1s = html.match(/<h1 [^>]*>[^<]*<\/h1>/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toContain("type-h1-fit");
    expect(h1s[0]).not.toContain("type-display");
    expect(h1s[0]).toContain(">send crypto to anyone on X, by username.<");
  });

  it("1. h1-fit is 22px at most and never under 16px, in globals.css", () => {
    const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");
    const rule = css.match(/\.type-h1-fit\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/font-size:\s*clamp\(16px,[^;]*,\s*22px\)/);
    expect(rule).toContain("var(--font-title)");
    // One line where 16px fits; on a very narrow phone (320) it may wrap.
    expect(rule).toContain("white-space: nowrap");
    expect(css).toMatch(/@media \(max-width: \d+px\) \{\s*\.type-h1-fit \{\s*white-space: normal;/);
  });

  it("2. why dropchad: the words, one sentence per line, in order", () => {
    const lines = [...html.matchAll(/<p data-why="">([^<]*)<\/p>/g)].map((m) =>
      (m[1] ?? "").replace(/&#x27;/g, "'"),
    );
    expect(lines).toEqual([
      "be honest, everyone on X says i will airdrop someone, just for likes.",
      "after that nobody knows if anyone got paid.",
      "on dropchad every drop is onchain.",
      "people see who really pays.",
      "boards show the real givers.",
      "based af.",
      "people notice you and follow you.",
      "launched a memecoin? drop it to your holders or to people who did good work.",
      "they get paid, you get attention.",
    ]);
  });

  it("2. why dropchad sits in one card, the three groups split by the row line", () => {
    const card = html.match(/<div [^>]*data-why-card=""[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(card).toMatch(/class="[^"]*\bcard\b[^"]*\bdivide-y\b/);
    expect(card.match(/data-why-group=""/g)).toHaveLength(3);
    expect(card.match(/data-why=""/g)).toHaveLength(9);
  });

  it("3. what you can do: drop, token drop, multisend, the words", () => {
    expect(html.match(/data-can="[^"]+"/g)).toEqual([
      'data-can="drop"',
      'data-can="token"',
      'data-can="multisend"',
    ]);
    const card = (key: string) =>
      html.match(new RegExp(String.raw`<li [^>]*data-can="${key}"[\s\S]*?</li>`))?.[0] ?? "";
    const said = (key: string) =>
      card(key)
        .replace(/<[^>]+>/g, "\n")
        .split("\n")
        .map((line) => line.replace(/&#x27;/g, "'").trim())
        .filter(Boolean);
    expect(said("drop")).toEqual([
      "drop",
      "send SOL on Solana or ETH on Robinhood to people by their X name. they sign in with X and claim.",
    ]);
    expect(said("token")).toEqual([
      "token drop",
      "drop your own token, like a memecoin you launched, to X names. reward your holders or people who helped you.",
    ]);
    expect(said("multisend")).toEqual([
      "multisend",
      "already have a list of wallet addresses? pay them all at once. no X needed.",
    ]);
  });

  it("3. drop and token drop carry both chain logos, multisend the lucide list-checks", () => {
    const card = (key: string) =>
      html.match(new RegExp(String.raw`<li [^>]*data-can="${key}"[\s\S]*?</li>`))?.[0] ?? "";
    const logos = (key: string) =>
      [...card(key).matchAll(/<img [^>]*src="(\/chains\/[a-z]+\.svg)"/g)].map((m) => m[1]);
    expect(logos("drop")).toEqual(["/chains/solana.svg", "/chains/robinhood.svg"]);
    expect(logos("token")).toEqual(["/chains/solana.svg", "/chains/robinhood.svg"]);
    expect(logos("multisend")).toEqual([]);
    expect(card("multisend")).toContain("lucide-list-checks");
  });

  it("3. stacked on phone, three in a row on desktop", () => {
    const list = html.match(/<ul [^>]*>(?=<li [^>]*data-can=)/)?.[0] ?? "";
    expect(list).toMatch(/class="[^"]*\bgrid\b/);
    expect(list).toMatch(/\bmd:grid-cols-3\b/);
    expect(list).not.toMatch(/(^|[" ])grid-cols-3\b/);
  });

  it("3. no multisend line under the cards any more", () => {
    expect(text).not.toContain("or multisend to pay a list of wallet addresses.");
    expect(text).not.toContain("or use multisend");
    expect(html).not.toContain("data-way=");
  });

  it("9. coming next: streamer drops, badge drops, more chains, more fun, no dates", () => {
    const items = [...html.matchAll(/<li data-next=""[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(items).toEqual(["streamer drops", "badge drops", "more chains", "more fun"]);
  });

  it("2. how to send: chain, coin or token, X names, one drop address, live by itself", () => {
    expect(text).toContain("pick the chain");
    expect(text).toContain("SOL, ETH or a token");
    expect(text).toContain("X names");
    expect(text).toContain("one drop address");
    expect(text).toContain("goes live by itself");
  });

  it("3. how to claim: X sign in, any wallet, no connect, no gas", () => {
    expect(text).toContain("sign in with X");
    expect(text).toContain("paste any wallet address");
    expect(text).toContain("no wallet connect");
    expect(text).toContain("you pay no gas");
  });

  it("4. why it is safe: the five true lines", () => {
    expect(text).toContain("every drop is its own contract");
    expect(text).toContain("only to the people on the list, or back to the sender");
    expect(text).toContain("comes back after 7 days");
    expect(text).toContain("cannot touch a drop");
    expect(text).toContain("risky tokens are refused");
  });

  it("7. a short FAQ, five or more questions, each with an answer", () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(5);
    for (const item of FAQ) {
      expect(item.q.endsWith("?"), item.q).toBe(true);
      expect(text).toContain(item.q);
      expect(item.a.length).toBeGreaterThan(0);
    }
  });

  it("draws every step with a lucide icon, no screenshot; the only pictures are chain logos", () => {
    expect(html).not.toMatch(/<img [^>]*\.(png|jpg|webp)/);
    for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/src="\/chains\//);
    expect(html.match(/class="lucide/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("5. fees, read live from the api", () => {
  it("one line per coin: 1%, at least the chain minimum", () => {
    const lines = feeLines(CHAINS);
    expect(lines?.coins).toEqual([
      "SOL drops: 1%, at least 0.0025 SOL.",
      "ETH drops: 1%, at least 0.0001 ETH.",
    ]);
  });

  it("the token tiers by the number of people, in usd, from the api", () => {
    expect(feeLines(CHAINS)?.tiers).toEqual([
      "up to 5 people: $3",
      "up to 20 people: $8",
      "up to 50 people: $15",
      "up to 100 people: $25",
      "up to 500 people: $40",
    ]);
    expect(text).toContain("paid in SOL or ETH");
    expect(text).toContain("never a % of your token");
  });

  it("shows the live numbers on the page", () => {
    expect(text).toContain("SOL drops: 1%, at least 0.0025 SOL.");
    expect(text).toContain("ETH drops: 1%, at least 0.0001 ETH.");
    expect(text).toContain("up to 500 people: $40");
  });

  it("with no api answer: no number, a line to the create page", () => {
    expect(feeLines(null)).toBeNull();
    const down = renderToStaticMarkup(<HowPage chains={null} />);
    expect(down).not.toContain("0.0025");
    expect(down).not.toContain("$40");
    expect(down).toMatch(/<a [^>]*href="\/create"/);
    expect(down).toContain("the create page shows the fee");
  });

  it("a chain that did not answer gets no line, never a guessed number", () => {
    const quiet = CHAINS.map((chain) =>
      chain.key === "solana-devnet" ? { ...chain, defaultFeeBps: null, minFee: null } : chain,
    );
    expect(feeLines(quiet)?.coins).toEqual(["ETH drops: 1%, at least 0.0001 ETH."]);
  });
});

describe("6. try it on testnet, every link and address", () => {
  it("Solana devnet: Phantom testnet mode and the official faucet", () => {
    expect(text).toContain("Settings → Developer Settings → Testnet Mode");
    expect(text).toContain("Solana Devnet");
    expect(html).toContain('href="https://faucet.solana.com"');
  });

  it("Robinhood testnet: the network details for MetaMask", () => {
    expect(TESTNET.robinhood.network).toEqual({
      name: "Robinhood Chain Testnet",
      rpc: "https://rpc.testnet.chain.robinhood.com",
      chainId: "46630",
      symbol: "ETH",
      explorer: "https://explorer.testnet.chain.robinhood.com",
    });
    for (const value of Object.values(TESTNET.robinhood.network)) expect(text).toContain(value);
  });

  it("Robinhood faucets: the official one first, Alchemy second", () => {
    const official = html.indexOf('href="https://faucet.testnet.chain.robinhood.com"');
    const alchemy = html.indexOf('href="https://www.alchemy.com/faucets/robinhood-testnet"');
    expect(official).toBeGreaterThan(-1);
    expect(alchemy).toBeGreaterThan(official);
  });

  it("the three test tokens: address, copy, explorer", () => {
    expect(TESTNET.tokens.map((token) => [token.symbol, token.address])).toEqual([
      ["TEST", "CKwgEmb3YgA7hjU6tVVBUvXfTqu2qTuYDiR2eo3o4cgt"],
      ["TEST", "0x077aC8FfC52458C6BF08d427c5eB038bE3f06F03"],
      ["tUSDC", "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C"],
    ]);
    for (const token of TESTNET.tokens) expect(text).toContain(token.address);
    expect(html).toContain(
      'href="https://explorer.solana.com/address/CKwgEmb3YgA7hjU6tVVBUvXfTqu2qTuYDiR2eo3o4cgt?cluster=devnet"',
    );
    expect(html).toContain(
      'href="https://explorer.testnet.chain.robinhood.com/token/0x077aC8FfC52458C6BF08d427c5eB038bE3f06F03"',
    );
    expect(html).toContain(
      'href="https://explorer.testnet.chain.robinhood.com/token/0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C"',
    );
  });

  it("test tokens: ask us on Telegram, no write contract steps", () => {
    expect(text).toContain("ask us on Telegram for test tokens");
    expect(html).toContain('href="https://t.me/dropchad"');
    expect(text.toLowerCase()).not.toContain("write contract");
  });

  it("every outside link opens in a new tab", () => {
    for (const anchor of html.match(/<a [^>]*href="https:[^"]*"[^>]*>/g) ?? []) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
  });
});
