/**
 * The drop page for token drops (
 * ):
 * 1. the headline row on every drop: the picture, the X logo right next to it, then the text;
 *    `$TEST` in a token drop's headline;
 * 2. the dropping part shows the plain ticker, `tokens` only with none;
 * 3. long tickers: 7 to 10 letters one size smaller, over 10 cut to 10 and `…`, in the headline,
 *    the dropping part and the share card bar;
 * 4. a small token row under `who got fed`: logo, name, ticker, `CA` in two halves with copy,
 *    the launchpad, an explorer link. Never a price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { FedProgress } from "@/components/drops/FedList";
import { LiveView } from "@/components/drops/LiveView";
import { dropLines, headlineParts } from "@/components/drops/drop-lines";
import { barSymbol, type ShareCardData } from "@/components/drops/share-card";
import type { DropDetail, Profile, TokenInfo } from "@/lib/api";
import { tickerShow, tokenPageLink } from "@/lib/token";

const SRC = join(__dirname, "..", "src");
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";

const creator = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: null,
  kind: "kol",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

const TEST: TokenInfo = {
  mint: MINT,
  symbol: "TEST",
  name: "Test Coin",
  decimals: 5,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
  launchpad: "pump.fun",
};

function live(token: TokenInfo | null, amountWei = "100000000", chainId = 103): string {
  return renderToStaticMarkup(
    <LiveView
      address={DROP}
      chainId={chainId}
      token={token}
      title={null}
      creator={creator}
      amountWei={amountWei}
      createdAt={1790838985}
      leafCount={2}
      paidCount={0}
      paid={[]}
      waiting={false}
    />,
  );
}

function after(token: TokenInfo | null, amountWei = "100000000"): string {
  const detail = {
    address: DROP,
    chain: { source: "rpc", available: true, indexed: false, data: null },
    ours: {
      source: "dropchad_api",
      known: true,
      data: { token, memeImageUrl: null, lastTxHash: null, activateTxHash: null },
    },
  } as unknown as DropDetail;
  return renderToStaticMarkup(
    <AfterView
      detail={detail}
      paid={[]}
      paidCount={0}
      leafCount={2}
      chainId={103}
      amountWei={amountWei}
      createdAt={1790838985}
      title={null}
      creator={creator}
      chip="DONE"
    />,
  );
}

describe("1. the headline row: picture, X logo, then the text, on every drop", () => {
  const order = (html: string) => {
    const picture = html.indexOf('aria-label="@samplechad"');
    const x = html.indexOf('aria-label="@samplechad on X"');
    const text = html.indexOf("<h1");
    return { picture, x, text };
  };

  for (const [name, html] of [
    ["live, token", () => live(TEST)],
    ["live, SOL", () => live(null, "3000000")],
    ["finished, token", () => after(TEST)],
    ["finished, SOL", () => after(null, "3000000")],
  ] as const) {
    it(name, () => {
      const o = order(html());
      expect(o.picture).toBeGreaterThan(-1);
      expect(o.picture).toBeLessThan(o.x);
      expect(o.x).toBeLessThan(o.text);
    });
  }

  it("the headline says $TEST; with no ticker, tokens; SOL unchanged", () => {
    const base = {
      title: null,
      handle: "samplechad",
      amountWei: "100000000",
      chainId: 103,
      createdAt: null,
      finished: false,
    };
    expect(dropLines({ ...base, token: TEST }).first).toBe("samplechad is dropping 1,000 $TEST");
    expect(dropLines({ ...base, token: { ...TEST, symbol: null } }).first).toBe(
      "samplechad is dropping 1,000 tokens",
    );
    expect(dropLines({ ...base, amountWei: "3000000", token: null }).first).toBe(
      "samplechad is dropping 0.003 SOL",
    );
  });
});

describe("2. the dropping part: the plain ticker, tokens only with none", () => {
  const progress = (token: TokenInfo | null) =>
    renderToStaticMarkup(
      <FedProgress
        paidCount={0}
        leafCount={2}
        amountWei="100000000"
        chainId={103}
        token={token}
        live
      />,
    );

  it("TEST, never $TEST", () => {
    const html = progress(TEST);
    expect(html).toMatch(/>TEST</);
    expect(html).not.toContain("$TEST");
  });

  it("tokens only when the token has no ticker", () => {
    expect(progress({ ...TEST, symbol: null })).toMatch(/>tokens</);
  });
});

describe("3. long tickers", () => {
  it("up to 6 normal, 7 to 10 smaller, over 10 cut to 10 and …", () => {
    expect(tickerShow("TEST")).toEqual({ text: "TEST", small: false });
    expect(tickerShow("SIXSIX")).toEqual({ text: "SIXSIX", small: false });
    expect(tickerShow("SEVENSE")).toEqual({ text: "SEVENSE", small: true });
    expect(tickerShow("TENLETTERS")).toEqual({ text: "TENLETTERS", small: true });
    expect(tickerShow("ELEVENLETTE")).toEqual({ text: "ELEVENLETT…", small: true });
  });

  it("the headline: the ticker in its own smaller span, cut over 10", () => {
    const input = {
      title: null,
      handle: "samplechad",
      amountWei: "100000000",
      chainId: 103,
      token: { ...TEST, symbol: "VERYLONGTICKER" },
      createdAt: null,
      finished: false,
    };
    expect(dropLines(input).first).toBe("samplechad is dropping 1,000 $VERYLONGTI…");
    expect(headlineParts(input)).toEqual({
      lead: "samplechad is dropping ",
      amount: "1,000",
      unit: "$VERYLONGTI…",
      small: true,
    });
    const html = live({ ...TEST, symbol: "VERYLONGTICKER" });
    expect(html).toMatch(/<span class="type-h2[^"]*">\$VERYLONGTI…<\/span>/);
  });

  it("a short ticker: no smaller span", () => {
    // The amount and the ticker in one unbroken piece since the phone fix.
    expect(live(TEST)).toMatch(
      /<h1[^>]*>samplechad is dropping <span class="whitespace-nowrap">1,000 \$TEST<\/span><\/h1>/,
    );
  });

  it("the dropping part: cut over 10, one size smaller from 7", () => {
    const html = renderToStaticMarkup(
      <FedProgress
        paidCount={0}
        leafCount={2}
        amountWei="100000000"
        chainId={103}
        token={{ ...TEST, symbol: "VERYLONGTICKER" }}
        live
      />,
    );
    expect(html).toMatch(/class="type-label[^"]*normal-case[^"]*">VERYLONGTI…</);
  });

  it("the share card bar: the same cut and size", () => {
    const card = (symbol: string | null): ShareCardData => ({
      chainKey: "solana-devnet",
      symbol: symbol ?? "tokens",
      decimals: 5,
      amount: "100000000",
      people: 1,
      sender: { handle: "samplechad", profileImageUrl: null },
      receivers: [],
      rest: 0,
      rank: null,
      token: { ...TEST, symbol },
    });
    expect(barSymbol(card("TEST"))).toEqual({ text: "TEST", small: false });
    expect(barSymbol(card("VERYLONGTICKER"))).toEqual({ text: "VERYLONGTI…", small: true });
    expect(barSymbol(card(null))).toEqual({ text: "tokens", small: false });
    const page = readFileSync(join(SRC, "components", "drops", "ShareCard.tsx"), "utf8");
    expect(page).toContain("barSymbol(card)");
  });
});

describe("4. the token row under who got fed", () => {
  it("the link: Solana explorer on devnet in testnet, the explorer on mainnet too", () => {
    expect(tokenPageLink(MINT, 103, true)).toEqual({
      href: `https://explorer.solana.com/address/${MINT}?cluster=devnet`,
      label: "explorer ↗",
    });
    // Dexscreener is its own button now, so the small link stays the explorer.
    expect(tokenPageLink(MINT, 101, false)).toEqual({
      href: `https://explorer.solana.com/address/${MINT}`,
      label: "explorer ↗",
    });
  });

  for (const [name, html] of [
    ["live", () => live(TEST)],
    ["finished", () => after(TEST)],
  ] as const) {
    it(`${name}: logo, name, ticker, CA in two halves with copy, explorer link, no launchpad`, () => {
      const page = html();
      const fed = page.indexOf("who got fed");
      const row = page.indexOf("Test Coin");
      expect(fed).toBeGreaterThan(-1);
      expect(row).toBeGreaterThan(fed);
      expect(page).toContain(`src="${TEST.logoUrl}"`);
      expect(page).toContain(">CA<");
      expect(page).toContain(
        `<span class="inline-block whitespace-nowrap">${MINT.slice(0, 22)}</span>`,
      );
      expect(page).toContain(
        `<span class="inline-block whitespace-nowrap">${MINT.slice(22)}</span>`,
      );
      // The launched on badge is off.
      expect(page).not.toContain("pump.fun");
      expect(page).toContain(`href="https://explorer.solana.com/address/${MINT}?cluster=devnet"`);
      expect(page).toContain("explorer ↗");
      expect(page).not.toMatch(/market cap|price/i);
    });
  }

  it("no launchpad known: no launchpad line", () => {
    expect(live({ ...TEST, launchpad: null })).not.toContain("pump.fun");
  });

  it("a SOL drop has no token row", () => {
    const html = live(null, "3000000");
    expect(html).not.toContain(">CA<");
    expect(html).not.toContain("explorer ↗");
  });
});
