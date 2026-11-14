/**
 * The drop page for token drops:
 * 1. the headline row on every drop; the headline first, `TEST drop`, then the
 *    picture, `@handle` and the X logo under it, as with a title;
 * 2. the dropping part shows the plain ticker, `tokens` only with none;
 * 3. long tickers: up to 16 in full, over 16 the first 15 and `…`, in the dropping
 *    part and the share card bar;
 * 4. a small token row under `who claimed`: logo, name,
 *    ticker, `CA` in two halves with copy, the launchpad, an explorer link (Dexscreener is its
 *    own button). Never a price.
 * 5. the token card waits for the money: hidden while the drop
 *    waits for funding and on `funding_expired`; shown once funded, `failed` included.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { FedProgress } from "@/components/drops/FedList";
import { LiveView } from "@/components/drops/LiveView";
import { tokenCardShows } from "@/components/drops/TokenRow";
import { dropLines } from "@/components/drops/drop-lines";
import { barSymbol, type ShareCardData } from "@/components/drops/share-card";
import type { DropDetail, Profile, TokenInfo } from "@/lib/api";
import { tickerCut, tokenPageLink } from "@/lib/token";

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

function live(
  token: TokenInfo | null,
  amountWei = "100000000",
  chainId = 103,
  waiting = false,
): string {
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
      waiting={waiting}
    />,
  );
}

/** A finished view's detail: ours with `state` when given, or the chain's row alone. */
function afterDetail(
  token: TokenInfo | null,
  state?: string,
  chainStatus?: "Created" | "Active" | "Finalized" | "Cancelled",
): DropDetail {
  const chainDrop = chainStatus
    ? { status: chainStatus, claimedCount: 0, leafCount: 2, fundingDeadline: "1" }
    : null;
  return {
    address: DROP,
    chain: {
      source: "rpc",
      available: true,
      indexed: false,
      data: chainDrop ? { drop: chainDrop, claims: [] } : null,
    },
    ours: {
      source: "dropchad_api",
      known: true,
      data: chainStatus
        ? null
        : { token, state, memeImageUrl: null, lastTxHash: null, activateTxHash: null },
    },
  } as unknown as DropDetail;
}

function after(
  token: TokenInfo | null,
  amountWei = "100000000",
  detail: DropDetail = afterDetail(token),
): string {
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

// The headline first, the sender line under it, as with a title.
describe("1. the headline, then the picture, @handle and the X logo, on every drop", () => {
  const order = (html: string) => {
    const text = html.indexOf("<h1");
    const handle = html.indexOf("@samplechad</a>");
    const x = html.indexOf('aria-label="@samplechad on X"');
    return { text, handle, x };
  };

  for (const [name, html] of [
    ["live, token", () => live(TEST)],
    ["live, SOL", () => live(null, "3000000")],
    ["finished, token", () => after(TEST)],
    ["finished, SOL", () => after(null, "3000000")],
  ] as const) {
    it(name, () => {
      const o = order(html());
      expect(o.text).toBeGreaterThan(-1);
      expect(o.text).toBeLessThan(o.handle);
      expect(o.handle).toBeLessThan(o.x);
    });
  }

  it("the headline is the rows' line one: TEST drop; with no ticker, token drop; SOL drop", () => {
    const base = { title: null, chainId: 103, createdAt: null };
    expect(dropLines({ ...base, token: TEST }).first).toBe("TEST drop");
    expect(dropLines({ ...base, token: { ...TEST, symbol: null } }).first).toBe("token drop");
    expect(dropLines({ ...base, token: null }).first).toBe("SOL drop");
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
  it("up to 16 in full, over 16 the first 15 and …", () => {
    expect(tickerCut("TEST")).toBe("TEST");
    expect(tickerCut("ELEVENLETTE")).toBe("ELEVENLETTE");
    expect(tickerCut("SEVENTEENLETTERSX")).toBe("SEVENTEENLETTER…");
  });

  it("the headline: the rows' line one with the full ticker, no smaller span", () => {
    expect(live({ ...TEST, symbol: "VERYLONGTICKER" })).toMatch(
      /<h1[^>]*>VERYLONGTICKER drop<\/h1>/,
    );
    expect(live(TEST)).toMatch(/<h1[^>]*>TEST drop<\/h1>/);
  });

  it("the dropping part: shown in full up to 16, the box shrinks it", () => {
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
    expect(html).toMatch(/class="block type-stat whitespace-nowrap[^"]*"/);
    expect(html).toContain(">VERYLONGTICKER<");
  });

  it("the share card bar: the same cut, smaller from 7", () => {
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
    expect(barSymbol(card("VERYLONGTICKER"))).toEqual({ text: "VERYLONGTICKER", small: true });
    expect(barSymbol(card("SEVENTEENLETTERSX"))).toEqual({
      text: "SEVENTEENLETTER…",
      small: true,
    });
    expect(barSymbol(card(null))).toEqual({ text: "tokens", small: false });
    const page = readFileSync(join(SRC, "components", "drops", "ShareCard.tsx"), "utf8");
    expect(page).toContain("barSymbol(card)");
  });
});

describe("4. the token row under who claimed", () => {
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
      const fed = page.indexOf("who claimed");
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

describe("5. the token card waits for the money", () => {
  const hidden = (page: string) => {
    expect(page).not.toContain(">CA<");
    expect(page).not.toContain("explorer ↗");
    expect(page).not.toContain("Test Coin");
  };
  const shown = (page: string) => {
    expect(page).toContain(">CA<");
    expect(page).toContain("explorer ↗");
    expect(page).toContain("Test Coin");
  };

  it("waiting for the money: no token card, for the sender and for everyone", () => {
    hidden(live(TEST, "100000000", 103, true));
  });

  it("funded and live: the token card", () => {
    shown(live(TEST, "100000000", 103, false));
  });

  for (const state of ["finished", "failed", "claims_expired"]) {
    it(`finished view, our state ${state}: the token card (the money arrived)`, () => {
      shown(after(TEST, "100000000", afterDetail(TEST, state)));
    });
  }

  it("finished view, our state funding_expired: no token card", () => {
    hidden(after(TEST, "100000000", afterDetail(TEST, "funding_expired")));
  });

  it("no row of ours: hidden on the chain's Created, shown from Active on", () => {
    hidden(after(TEST, "100000000", afterDetail(TEST, undefined, "Created")));
    expect(tokenCardShows(afterDetail(TEST, undefined, "Created"))).toBe(false);
    for (const status of ["Active", "Finalized", "Cancelled"] as const) {
      expect(tokenCardShows(afterDetail(TEST, undefined, status)), status).toBe(true);
    }
  });

  it("tokenCardShows, every state of ours", () => {
    const shows = Object.fromEntries(
      [
        "created",
        "funded",
        "active",
        "paying",
        "finished",
        "failed",
        "funding_expired",
        "claims_expired",
      ].map((state) => [state, tokenCardShows(afterDetail(TEST, state))]),
    );
    expect(shows).toEqual({
      created: false,
      funded: true,
      active: true,
      paying: true,
      finished: true,
      failed: true,
      funding_expired: false,
      claims_expired: true,
    });
  });

  it("neither side knows the drop: no token card", () => {
    const detail = {
      ...afterDetail(TEST),
      ours: { source: "dropchad_api", known: false, data: null },
    } as unknown as DropDetail;
    expect(tokenCardShows(detail)).toBe(false);
  });
});
