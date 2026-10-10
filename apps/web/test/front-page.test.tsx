/**
 * The front page. The three tiles at the top as they
 * were, the make a drop button, then one line in normal size: `send crypto to anyone on X, just
 * by their @name.` white in Space Grotesk, the `@name` mint and changing through sample names,
 * then two grey sentences. Then one drops list with `latest` and `live` tabs, and top chads
 * with 5 rows. Rendered with `react-dom/server`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DropCardData } from "@/components/drops/drop-card-data";
import { dropTabs, tabFromHash } from "@/components/front/drop-tabs";
import {
  FRONT_LINE_FIRST,
  FRONT_LINE_MULTISEND,
  FRONT_LINE_REST,
} from "@/components/front/front-line";
import { FrontLine } from "@/components/front/FrontLine";
import { FrontPage } from "@/components/front/FrontPage";
import type { Board, BoardRow, Profile, Stats } from "@/lib/api";

const SRC = join(__dirname, "..", "src");

const stats: Stats = {
  chain: "all",
  droppedTotalWei: "400000000000000",
  dropCount: 2,
  uniqueReceivers: 3,
  claimCount: 3,
  usd: 1.2,
  finality: "final",
  totals: [],
  dropped: [{ kind: "coin", symbol: "ETH", decimals: 18, amount: "400000000000000" }],
};

const person = (n: number): Profile => ({
  xUserId: String(n),
  handle: `samplechad${String(n)}`,
  displayName: "sample",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
});

const board: Board = {
  range: "week",
  kind: "all",
  board: "fed",
  chain: "all",
  rankedBy: "uniqueReceivers",
  available: true,
  finality: "final",
  // 12 rows, so the front page's cut at 10 shows.
  rows: Array.from({ length: 12 }, (_, i): BoardRow => ({
    rank: i + 1,
    profile: person(i + 1),
    totalWei: "1",
    dropCount: 1,
    claimCount: 1,
    uniqueReceivers: 12 - i,
    biggestDropWei: "1",
    lastDropAt: 1,
    usd: 0,
    byChain: [],
  })),
};

const front = () =>
  renderToStaticMarkup(<FrontPage pills={[]} stats={stats} drops={[]} board={board} />);

describe("the line under the button, the words", () => {
  it("says it in three plain sentences", () => {
    expect(FRONT_LINE_FIRST).toBe(
      "send crypto and memecoins to anyone on X, just by their username.",
    );
    expect(FRONT_LINE_REST).toBe(
      "they sign in with X to receive. no wallet connect, free to claim. every drop is on chain, so everyone sees who really pays.",
    );
  });

  it("nothing in it moves: no changing name, no timer", () => {
    const src = readFileSync(join(SRC, "components", "front", "FrontLine.tsx"), "utf8");
    expect(src).not.toContain("setInterval");
    expect(src).not.toContain("useEffect");
    expect(src).not.toContain('"use client"');
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(css).not.toContain(".front-name");
  });
});

describe("the line under the button, rendered", () => {
  const html = renderToStaticMarkup(<FrontLine />);

  it("is one step over body, the h2 size, and never a big heading", () => {
    // one step bigger than body; still not a heading.
    expect(html).toMatch(/<p class="[^"]*type-h2[^"]*"/);
    expect(html).not.toContain("type-body");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("type-display");
    expect(html).not.toContain("<h1");
  });

  it("the first sentence is white in Space Grotesk, plain, no mint name", () => {
    expect(html).toMatch(
      /<span class="[^"]*font-title[^"]*text-chad-text[^"]*">send crypto and memecoins to anyone on X, just by their username\.<\/span>/,
    );
    expect(html).not.toContain("text-chad-accent");
    expect(html).not.toContain("@");
  });

  it("only the size moves: normal weight and body line height, after the type classes", () => {
    expect(html).toMatch(/<p class="[^"]*front-line[^"]*"/);
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const rule = /\.front-line \{([^}]*)\}/.exec(css);
    expect(rule?.[1] ?? "").toContain("font-weight: 400");
    expect(rule?.[1] ?? "").toContain("line-height: 1.5");
    // Later than `.type-h2` in the same layer, so it wins over the h2 weight and line height.
    expect(css.indexOf(".front-line {")).toBeGreaterThan(css.indexOf(".type-h2 {"));
  });

  it("never leaves one word alone on the last line: pretty wrapping, a wide box", () => {
    expect(html).toMatch(/<p class="[^"]*text-pretty[^"]*"/);
    expect(html).not.toContain("max-w-xl");
    expect(html).toMatch(/<p class="[^"]*md:max-w-3xl[^"]*"/);
  });

  it("X is always a capital in this text", () => {
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).not.toMatch(/\bx\b/);
    expect(text).toContain("on X,");
    expect(text).toContain("with X to receive");
  });

  it("ends with a quiet multisend link that opens the create page on multisend", () => {
    expect(FRONT_LINE_MULTISEND).toBe("paying wallets instead? use");
    expect(html).toMatch(
      /paying wallets instead\? use <a [^>]*href="\/create\?mode=multisend"[^>]*>multisend<\/a>\./,
    );
    // Quiet: grey like the text around it, underlined so it reads as a link, white on hover.
    expect(html).toMatch(
      /<a class="[^"]*underline[^"]*hover:text-chad-text[^"]*" href="\/create\?mode=multisend"/,
    );
  });

  it("the other two sentences are soft grey", () => {
    expect(html).toMatch(
      /<span class="[^"]*text-chad-text-dim[^"]*">they sign in with X to receive/,
    );
  });
});

describe("the front page order", () => {
  it("tiles at the top, the button, the line, the drops tabs, top chads", () => {
    const html = front();
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at("<dl")).toBeLessThan(at(">make a drop<"));
    expect(at(">make a drop<")).toBeLessThan(at("send crypto and memecoins to anyone on X"));
    expect(at("send crypto and memecoins to anyone on X")).toBeLessThan(at(">latest<"));
    expect(at(">latest<")).toBeLessThan(at(">top chads<"));
    expect(html).not.toContain("top chads this week");
    expect(html).not.toContain("drop bags on");
    expect(html).not.toContain("live now");
    expect(html).not.toContain("latest drops");
  });

  it("on desktop the line sits right of the button, centred on it; on the phone under it", () => {
    const html = front();
    // One row from lg up, the button and then the line; stacked below lg.
    expect(html).toMatch(
      /<div class="[^"]*lg:flex[^"]*lg:items-center[^"]*"><a [^>]*class="[^"]*shrink-0[^"]*"[^>]*>make a drop<\/a><p class="[^"]*lg:mt-0[^"]*"><span[^>]*>send crypto/,
    );
  });

  it("the tiles keep their size and their grey lines", () => {
    const html = front();
    expect(html).toContain("type-stat");
    expect(html).toContain("funded and paid");
    expect(html).not.toContain("x accounts that claimed");
  });

  it("the third tile: payouts big, the people under it", () => {
    const withTotals = {
      ...stats,
      totals: [{ chainKey: "robinhood-testnet", uniqueReceivers: 3, claimCount: 5 }],
    } as unknown as Stats;
    const html = renderToStaticMarkup(
      <FrontPage pills={[]} stats={withTotals} drops={[]} board={board} />,
    );
    expect(html).toContain(">payouts<");
    expect(html).not.toContain("people paid");
    expect(html).toMatch(/>payouts<[\s\S]*?>5<[\s\S]*?>3 people</);
  });

  it("one drops list with two tabs, latest first and on", () => {
    const html = front();
    expect(html).toMatch(/aria-pressed="true"[^>]*>latest</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>live/);
    expect(html).toContain('id="live"');
  });

  it("top chads shows the top 10 rows, and all boards opens the full board", () => {
    const html = front();
    for (let n = 1; n <= 10; n += 1) expect(html).toContain(`@samplechad${String(n)}<`);
    expect(html).not.toContain("@samplechad11<");
    expect(html).toMatch(
      /href="\/boards\?range=week&amp;board=fed&amp;chain=[^"]+"[^>]*>all boards →</,
    );
  });

  it("top chads has both tab rows, this week on, and the live line", () => {
    const html = front();
    expect(html).toMatch(/aria-pressed="true"[^>]*>best dropchad</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>24h</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>this week</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>all time</);
    expect(html).toContain("live · updated just now");
  });
});

describe("dropTabs, latest and live", () => {
  const card = (n: number, chip: DropCardData["chip"], createdAt: number): DropCardData => ({
    address: `0x${n.toString(16).padStart(40, "0")}`,
    chainId: 46630,
    title: null,
    imageUrl: null,
    creator: null,
    chip,
    amountWei: "1",
    receivers: 1,
    claimed: 0,
    createdAt,
  });

  it("latest is every drop newest first, live ones too, pages cut it; live is live only", () => {
    const cards = Array.from({ length: 15 }, (_, i) => card(i, i % 3 === 0 ? "LIVE" : "DONE", i));
    const tabs = dropTabs(cards);
    expect(tabs.latest).toHaveLength(15);
    expect(tabs.latest[0]?.createdAt).toBe(14);
    expect(tabs.latest.some((c) => c.chip === "LIVE")).toBe(true);
    expect(tabs.live.every((c) => c.chip === "LIVE")).toBe(true);
    expect(tabs.live).toHaveLength(5);
  });

  it("/#live, from old links, opens the live tab", () => {
    expect(tabFromHash("#live")).toBe("live");
    expect(tabFromHash("")).toBe("latest");
    expect(tabFromHash("#other")).toBe("latest");
  });
});

describe("two fonts: Space Grotesk for page titles, Inter for the rest", () => {
  it("the layout loads Space Grotesk next to Inter, through next/font", () => {
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("Space_Grotesk");
    expect(layout).toContain('variable: "--font-grotesk"');
    expect(layout).toContain("grotesk.variable");
  });

  it("page titles and the font-title class use it; the body stays Inter", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(css).toMatch(/--font-title: var\(--font-grotesk\)/);
    expect(/\.type-h1 \{([^}]*)\}/.exec(css)?.[1] ?? "").toContain(
      "font-family: var(--font-title)",
    );
    expect(css).toMatch(/\.font-title \{[^}]*font-family: var\(--font-title\)/);
    expect(css).toMatch(/--font-sans: var\(--font-inter\)/);
  });
});
