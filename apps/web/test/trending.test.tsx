/**
 * The trending block: three cards in one
 * row, chad of the day, top coin and just dropped, between the line by the button and the drops
 * list. Each card is one link, turns through its top 3 every 8 seconds and keeps every text on
 * one line. Chad of the day and top coin count the last 24 hours only and say `today`
 * just dropped shows the newest funded drops, how long ago each was funded. The compact desktop
 * look, no tag pill, the dots as buttons and the phone swipe. Rendered with `react-dom/server`;
 * the turns are the pure `turnReducer`, the swipe the pure `swipeStep`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrontPage } from "@/components/front/FrontPage";
import { StreamLinks } from "@/components/site/StreamLinks";
import { XLink } from "@/components/site/XLink";
import { DEXSCREENER_ICON_PX } from "@/lib/dexscreener";
import { TrendingBlock } from "@/components/front/Trending";
import {
  agoText,
  cardHref,
  chadLines,
  coinLines,
  dropLines,
  newestCoinLines,
  nextItem,
  shortAmount,
  swipeStep,
  tickerText,
  turnReducer,
  TURN_MS,
} from "@/components/front/trending-lines";
import type {
  Profile,
  TokenInfo,
  Trending,
  TrendingChad,
  TrendingCoin,
  TrendingDrop,
  TrendingNewestCoin,
} from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const NOW_S = NOW / 1000;

const person = (handle: string, tags: Profile["tags"] = []): Profile => ({
  xUserId: handle,
  handle,
  displayName: `${handle} name`,
  profileImageUrl: null,
  kind: "chad",
  tags,
  tagLockedUntil: null,
  badges: [],
  streams: [],
});

const token = (symbol: string | null): TokenInfo => ({
  mint: "So1anaMint1111111111111111111111111111111111",
  symbol,
  name: "Bonk Coin",
  decimals: 5,
  tokenProgram: "spl",
  logoUrl: "/api/tokens/So1anaMint1111111111111111111111111111111111/logo?chain=solana",
  launchpad: null,
});

const chad = (handle: string, people = 31): TrendingChad => ({
  profile: person(handle, ["streamer"]),
  people,
  drops: 2,
  lastDropAt: NOW_S - 12 * 60,
  chainKey: "solana-devnet",
  amount: "420000000",
});

const coin = (): TrendingCoin => ({
  token: token("BONK"),
  chainKey: "solana-devnet",
  drops: 14,
  people: 210,
  sender: person("firstchad"),
  newestDrop: "NewestDrop111111111111111111111111111111111",
  // 1,500,000 BONK at 5 decimals.
  total: "150000000000",
});

/** The newest coin drop: one drop, 3 days and 5 minutes old. */
const newest = (): TrendingNewestCoin => ({
  ...coin(),
  drops: 1,
  newestDrop: "OldCoinDrop11111111111111111111111111111111",
  createdAt: NOW_S - 3 * 86400 - 5 * 60,
});

const drop = (tokenInfo: TokenInfo | null = null): TrendingDrop => ({
  address: "BigDrop1111111111111111111111111111111111111",
  chainKey: "solana-devnet",
  sender: person("bigchad", ["dev"]),
  receivers: 200,
  total: tokenInfo === null ? "500000000" : "100000000000",
  token: tokenInfo,
  fundedAt: NOW_S - 2 * 60,
});

/** The devnet USDC, a quick token of `solana-devnet`. */
const usdc = (): TokenInfo => ({
  ...token("USDC"),
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  name: "USD Coin",
  decimals: 6,
});

/** Each big line as rendered: its classes, the number and the unit, if any. */
const bigs = (html: string) =>
  [
    ...html.matchAll(
      /<span data-trend-big="true" class="([^"]*)"><span class="([^"]*)">([^<]*)<\/span>(?:<span class="([^"]*)">([^<]*)<\/span>)?<\/span>/g,
    ),
  ].map((m) => ({
    cls: m[1] ?? "",
    numCls: m[2] ?? "",
    amount: m[3],
    unitCls: m[4] ?? "",
    unit: m[5],
  }));

const trending = (over: Partial<Trending> = {}): Trending => ({
  chain: "all",
  finality: "final",
  available: true,
  chad: { range: "day", items: [chad("alice"), chad("bob"), chad("carol")] },
  coin: { range: "day", items: [coin()] },
  drop: { items: [drop(), drop()] },
  ...over,
});

describe("the lines", () => {
  it("minutes, hours and days ago", () => {
    expect(agoText(NOW_S - 20, NOW)).toBe("just now");
    expect(agoText(NOW_S - 12 * 60, NOW)).toBe("12 min ago");
    expect(agoText(NOW_S - 3 * 3600, NOW)).toBe("3 h ago");
    expect(agoText(NOW_S - 2 * 86400, NOW)).toBe("2 d ago");
  });

  it("chad of the day: the amount in its chain's coin, people, the last drop", () => {
    expect(chadLines(chad("alice"), NOW)).toEqual({
      big: "0.42 SOL",
      amount: "0.42",
      unit: "SOL",
      middle: "dropped to 31 people today",
      people: "to 31 people",
      accent: "12 min ago",
      handle: "@alice",
      short: "12 min ago",
    });
    expect(chadLines(chad("alice", 1), NOW).middle).toBe("dropped to 1 person today");
  });

  it("top coin: people, its one sender, never +N", () => {
    // The big line is the short number and `coins`, the ticker is in the name spot; the line
    // under it is `to N people`, no drop count.
    // A coin item is one sender with one coin: `by @name`, never `+N`.
    expect(coinLines(coin())).toEqual({
      big: "1.5M coins",
      amount: "1.5M",
      unit: "coins",
      middle: "to 210 people today",
      people: "to 210 people",
      accent: "today",
      handle: "by @firstchad",
      short: "by @firstchad",
    });
    const alone = coinLines({ ...coin(), drops: 1, people: 1, total: "1200000" });
    expect(alone.big).toBe("12 coins");
    expect(alone.middle).toBe("to 1 person today");
    expect(alone.people).toBe("to 1 person");
    expect(coinLines({ ...coin(), token: token(null) }).big).toBe("1.5M coins");
    // Exactly 1 is `1 coin`.
    const one = coinLines({ ...coin(), total: "100000" });
    expect([one.big, one.amount, one.unit]).toEqual(["1 coin", "1", "coin"]);
    // The mint line always says today.
    expect(alone.accent).toBe("today");
    expect(alone.handle).toBe("by @firstchad");
    expect(alone.short).toBe("by @firstchad");
  });

  it("the newest coin drop: its age in whole days, no today", () => {
    expect(newestCoinLines(newest(), NOW)).toEqual({
      big: "1.5M coins",
      amount: "1.5M",
      unit: "coins",
      // The phone shows the age too, in the spot of `today`.
      middle: "to 210 people 3 d ago",
      people: "to 210 people",
      accent: "3 d ago",
      handle: "by @firstchad",
      short: "by @firstchad",
    });
    // Whole days, rounded down, in the just dropped form.
    const day = { ...newest(), createdAt: NOW_S - 47 * 3600 };
    expect(newestCoinLines(day, NOW).accent).toBe("1 d ago");
  });

  it("the top coin ticker: one $ in front, none for no ticker", () => {
    expect(tickerText("BONK")).toBe("$BONK");
    expect(tickerText("$TEST")).toBe("$TEST");
    expect(tickerText(null)).toBe("tokens");
    expect(tickerText(undefined)).toBe("tokens");
    expect(tickerText("")).toBe("tokens");
  });

  it("just dropped: the drop amount, to N people, how long ago it was funded", () => {
    expect(dropLines(drop(), NOW)).toEqual({
      big: "0.5 SOL",
      amount: "0.5",
      unit: "SOL",
      middle: "to 200 people",
      people: "to 200 people",
      accent: "2 min ago",
      handle: "@bigchad",
      short: "2 min ago",
    });
    expect(dropLines({ ...drop(), receivers: 1, fundedAt: NOW_S - 20 }, NOW)).toMatchObject({
      middle: "to 1 person",
      people: "to 1 person",
      accent: "just now",
      short: "just now",
    });
    expect(dropLines({ ...drop(), fundedAt: NOW_S - 3 * 3600 }, NOW).accent).toBe("3 h ago");
  });

  it("just dropped: a stablecoin short with its ticker, any other token short with coins", () => {
    // 1,500 USDC at 6 decimals.
    const stable = dropLines({ ...drop(usdc()), total: "1500000000" }, NOW);
    expect([stable.big, stable.amount, stable.unit]).toEqual(["1.5K USDC", "1.5K", "USDC"]);
    // 1,000,000 BONK at 5 decimals: the number and `coins`, never the ticker.
    const meme = dropLines(drop(token("BONK")), NOW);
    expect([meme.big, meme.amount, meme.unit]).toEqual(["1M coins", "1M", "coins"]);
    expect(dropLines(drop(token(null)), NOW).big).toBe("1M coins");
    expect(dropLines({ ...drop(token("BONK")), total: "100000" }, NOW).big).toBe("1 coin");
    // A token called USDC at another address is any token.
    expect(dropLines(drop(token("USDC")), NOW).big).toBe("1M coins");
  });

  it("short token amounts: K, M, B, T, one decimal at most, rounded down", () => {
    const cases: [string, number, string][] = [
      ["0", 0, "0"],
      ["950", 0, "950"],
      ["999", 0, "999"],
      ["1000", 0, "1K"],
      ["1050", 0, "1K"],
      ["1500", 0, "1.5K"],
      ["999999", 0, "999.9K"],
      ["1500000", 0, "1.5M"],
      ["2345678901", 0, "2.3B"],
      ["4000000000000", 0, "4T"],
      ["12345000000000000", 0, "12,345T"],
      // With decimals: 12.5, 0.42, a tiny amount.
      ["125", 1, "12.5"],
      ["42", 2, "0.4"],
      ["4", 2, "<0.1"],
      ["100000000000", 5, "1M"],
      ["1999999999999999999999", 18, "1.9K"],
    ];
    for (const [base, decimals, text] of cases) {
      expect(shortAmount(base, decimals), `${base} at ${String(decimals)}`).toBe(text);
    }
  });

  it("SOL and ETH keep their usual form", () => {
    expect(chadLines(chad("alice"), NOW).big).toBe("0.42 SOL");
    expect(dropLines({ ...drop(), total: "1234567000000000" }, NOW).big).toBe("1,234,567 SOL");
  });

  it("each card links to the profile, the coin's newest drop, the drop", () => {
    expect(cardHref("chad", chad("alice"))).toBe("/u/alice");
    expect(cardHref("coin", coin())).toBe("/d/NewestDrop111111111111111111111111111111111");
    expect(cardHref("drop", drop())).toBe("/d/BigDrop1111111111111111111111111111111111111");
  });

  it("turns every 8 seconds, round the top 3; one item stays still", () => {
    expect(TURN_MS).toBe(8000);
    expect(nextItem(0, 3)).toBe(1);
    expect(nextItem(2, 3)).toBe(0);
    expect(nextItem(0, 1)).toBe(0);
    expect(nextItem(0, 0)).toBe(0);
  });
});

describe("turning, the dots and the swipe", () => {
  const start = { index: 0, turned: false, epoch: 0 };

  it("the 8 second tick turns to the next item and flips, the timer runs on", () => {
    expect(turnReducer(start, { type: "tick", count: 3 })).toEqual({
      index: 1,
      turned: true,
      epoch: 0,
    });
    expect(turnReducer({ ...start, index: 2 }, { type: "tick", count: 3 }).index).toBe(0);
  });

  it("a dot tap jumps to that item and starts the 8 seconds again", () => {
    expect(turnReducer(start, { type: "pick", to: 2, count: 3 })).toEqual({
      index: 2,
      turned: true,
      epoch: 1,
    });
    // The dot already showing: no flip, but the 8 seconds still start again.
    expect(turnReducer(start, { type: "pick", to: 0, count: 3 })).toEqual({
      index: 0,
      turned: false,
      epoch: 1,
    });
    // A dot past the end is never a blank card.
    expect(turnReducer(start, { type: "pick", to: 5, count: 3 }).index).toBe(0);
  });

  it("a swipe steps to the next or the last item, round the list, and starts the 8 seconds again", () => {
    expect(turnReducer(start, { type: "step", by: 1, count: 3 })).toEqual({
      index: 1,
      turned: true,
      epoch: 1,
    });
    expect(turnReducer(start, { type: "step", by: -1, count: 3 }).index).toBe(2);
    expect(turnReducer({ ...start, index: 2 }, { type: "step", by: 1, count: 3 }).index).toBe(0);
  });

  it("one item, or none, never turns", () => {
    for (const count of [0, 1]) {
      expect(turnReducer(start, { type: "tick", count })).toEqual(start);
      expect(turnReducer(start, { type: "step", by: 1, count })).toEqual(start);
    }
  });

  it("a swipe is a clear sideways move: left is next, right is last, up and down is the page", () => {
    expect(swipeStep(-60, 5)).toBe(1);
    expect(swipeStep(60, -5)).toBe(-1);
    // Too short, or more up and down than sideways: the page scrolls, the card stays.
    expect(swipeStep(-20, 0)).toBe(0);
    expect(swipeStep(-60, 80)).toBe(0);
    expect(swipeStep(0, -200)).toBe(0);
  });
});

describe("the block", () => {
  const html = renderToStaticMarkup(<TrendingBlock initial={trending()} chain="all" />);

  it("three cards in order, one row on phone and desktop", () => {
    const labels = ["chad of the day", "top coin", "just dropped"].map((label) =>
      html.indexOf(label),
    );
    expect(labels.every((at) => at >= 0)).toBe(true);
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
    expect(html).toContain("grid-cols-3");
  });

  it("each card is one link to its page", () => {
    expect(html).toContain('href="/u/alice"');
    expect(html).toContain('href="/d/NewestDrop111111111111111111111111111111111"');
    expect(html).toContain('href="/d/BigDrop1111111111111111111111111111111111111"');
  });

  it("shows the first item of each card, its lines and the mint part", () => {
    expect(html).toContain("alice name");
    expect(html).toContain("@alice");
    expect(bigs(html)).toContainEqual(expect.objectContaining({ amount: "0.42", unit: "SOL" }));
    expect(html).toContain("BONK");
    expect(html).toContain("Bonk Coin");
    // The coin's big line, phone and desktop: the number and `coins`.
    expect(bigs(html).filter((b) => b.amount === "1.5M" && b.unit === "coins")).toHaveLength(2);
    expect(html).not.toContain("in 14 drops");
    // Chad of the day and just dropped keep their coin.
    expect(bigs(html).filter((b) => b.amount === "0.42" && b.unit === "SOL")).toHaveLength(2);
    expect(bigs(html).filter((b) => b.amount === "0.5" && b.unit === "SOL")).toHaveLength(2);
    // Just dropped: `to N people` on the phone too, never a claim count.
    expect(html.match(/>to 200 people</g)).toHaveLength(2);
    expect(html).not.toContain("150 of 200");
    expect(html).not.toContain("claimed");
    expect(html).not.toContain("one drop to");
    expect(html).not.toContain("this week");
  });

  it("desktop, compact: radius 14, padding 12 and 14, 10 between the cards", () => {
    expect(html).toContain("md:gap-[10px]");
    expect(html).toMatch(
      /md:rounded-\[14px\][^"]*md:px-3\.5[^"]*md:py-3|md:px-3\.5[^"]*md:py-3[^"]*md:rounded-\[14px\]|md:rounded-\[14px\][^"]*md:py-3[^"]*md:px-3\.5/,
    );
  });

  it("desktop: the right column, the big line, to N people, the mint line", () => {
    expect(bigs(html).some((b) => b.amount === "0.42" && b.cls.includes("text-[12px]"))).toBe(true);
    expect(html).toContain(">to 31 people<");
    // The page reads the real clock, so any "ago" text; the words are tested in chadLines.
    expect(html).toMatch(/text-chad-accent[^>]*>(?:just now|\d+ (?:min|h|d) ago)</);
    expect(html).toMatch(/text-chad-accent[^>]*>today</);
    // Chad of the day and just dropped, phone and desktop.
    expect(html.match(/text-chad-accent[^>]*>(?:just now|\d+ (?:min|h|d) ago)</g)).toHaveLength(4);
    // The top coin's handle spot: its one sender, never +N.
    expect(html).toMatch(/truncate[^>]*>by @firstchad</);
    expect(html).not.toMatch(/by @firstchad \+/);
  });

  it("desktop: the name, the ticker and the big line all 12px; phone all 11px", () => {
    const desk = bigs(html).filter((b) => b.cls.includes("text-[12px]"));
    const phone = bigs(html).filter((b) => b.cls.includes("text-[11px]"));
    // Three cards, one big line each on desktop and on the phone.
    expect(desk).toHaveLength(3);
    expect(phone).toHaveLength(3);
    for (const b of [...desk, ...phone]) expect(b.cls).toContain("font-bold");
    // The name and the coin's ticker, the card links: 12px and 11px, semibold.
    expect(html).toMatch(/class="[^"]*text-\[12px\][^"]*font-semibold[^"]*"[^>]*>alice name</);
    expect(html).toMatch(/class="[^"]*text-\[11px\][^"]*font-semibold[^"]*"[^>]*>alice name</);
    expect(html).toMatch(/class="[^"]*text-\[12px\][^"]*font-semibold[^"]*"[^>]*>\$BONK</);
    expect(html).toMatch(/class="[^"]*text-\[11px\][^"]*font-semibold[^"]*"[^>]*>\$BONK</);
    // No old size is left on a big line, a name or a ticker.
    expect(html).not.toMatch(/text-\[(?:15|14|13|10)px\][^"]*font-(?:bold|semibold)/);
  });

  it("the top coin name spot: $ and the ticker, the full text in title and aria-label", () => {
    for (const size of ["12px", "11px"]) {
      expect(html).toMatch(
        new RegExp(
          `<a [^>]*class="[^"]*text-\\[${size}\\][^"]*font-semibold[^"]*"[^>]*>\\$BONK</a>`,
        ),
      );
    }
    const names = html.match(/<a [^>]*>\$BONK<\/a>/g) ?? [];
    expect(names).toHaveLength(2);
    for (const a of names) {
      expect(a).toContain('title="$BONK"');
      expect(a).toContain('aria-label="$BONK"');
    }
    // A ticker that starts with $ gets no second one.
    const dollar = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({
          coin: { range: "day", items: [{ ...coin(), token: token("$TEST") }] },
        })}
        chain="all"
      />,
    );
    expect(dollar.match(/>\$TEST<\/a>/g)).toHaveLength(2);
    expect(dollar).not.toContain("$$TEST");
  });

  it("a long top coin ticker is cut in the name spot, its big line the number and coins", () => {
    const long = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({
          coin: { range: "day", items: [{ ...coin(), token: token("SOMEVERYLONGTICKER") }] },
        })}
        chain="all"
      />,
    );
    const names = long.match(/<a [^>]*>\$SOMEVERYLONGTICKER<\/a>/g) ?? [];
    expect(names).toHaveLength(2);
    for (const a of names) {
      expect(a).toMatch(/class="[^"]*\btruncate\b/);
      expect(a).toContain('title="$SOMEVERYLONGTICKER"');
      expect(a).toContain('aria-label="$SOMEVERYLONGTICKER"');
    }
    expect(bigs(long).filter((b) => b.amount === "1.5M" && b.unit === "coins")).toHaveLength(2);
    expect(long).toContain("grid-cols-3");
  });

  it("the just dropped big line keeps the number whole and cuts only the unit", () => {
    const long = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({
          drop: { items: [{ ...drop(usdc()), total: "1500000000" }] },
        })}
        chain="all"
      />,
    );
    const lines = bigs(long).filter((b) => b.unit === "USDC");
    expect(lines).toHaveLength(2);
    for (const b of lines) {
      expect(b.amount).toBe("1.5K");
      expect(b.numCls).toContain("shrink-0");
      expect(b.unitCls).toContain("truncate");
      expect(b.unitCls).toContain("min-w-0");
      expect(b.cls).toContain("min-w-0");
      expect(b.cls).toContain("max-w-full");
    }
    expect(long).toContain("grid-cols-3");
  });

  it("phone: the mint line sits 5px lower, measured on the rendered page; desktop rows", () => {
    // Headless Chrome at 390, the ink rows of each line: the white space above the mint line
    // was about 5px less than above the second line on every card, so it moves by margin. On
    // desktop it sits in the third row with the icons, no offset.
    expect(html).not.toContain("top-[5px]");
    expect(html.match(/class="[^"]*\bmt-\[5px\][^"]*text-chad-accent/g)?.length).toBe(3);
    expect(html).not.toMatch(
      /class="[^"]*\b(?:mt|top)-[^"]*text-chad-text-dim[^"]*"[^>]*>to 31 people</,
    );
  });

  it("desktop: three rows in two columns, each pair on the same line", () => {
    // One grid per card: name and big line, handle and grey line, icons and mint line, in that
    // order, so each pair shares one row.
    const grids = html.split("data-trend-rows").slice(1);
    expect(grids).toHaveLength(3);
    for (const grid of grids) {
      expect(grid).toMatch(
        /^="true" class="[^"]*\bgrid grid-cols-\[minmax\(0,1fr\)_fit-content\(50%\)\]/,
      );
    }
    const order = (grid: string, marks: string[]) => {
      const at = marks.map((mark) => grid.indexOf(mark));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    };
    const [chadGrid = "", coinGrid = "", dropGrid = ""] = grids;
    order(chadGrid, [
      ">alice name<",
      "data-trend-big",
      ">@alice<",
      ">to 31 people<",
      "data-trend-icons",
      " ago<",
    ]);
    order(coinGrid, [
      ">$BONK<",
      "data-trend-big",
      ">by @firstchad<",
      ">to 210 people<",
      "data-trend-icons",
      ">today<",
    ]);
    order(dropGrid, [
      ">bigchad name<",
      "data-trend-big",
      ">@bigchad<",
      ">to 200 people<",
      "data-trend-icons",
      " ago<",
    ]);
  });

  it("phone: the card label sits centred at the top; desktop keeps it left", () => {
    const rows = html.match(/<div class="[^"]*"><span class="[^"]*uppercase[^"]*">/g) ?? [];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toContain("justify-center");
      expect(row).toContain("md:justify-between");
    }
  });

  it("no tag pill in the trending cards", () => {
    expect(html).not.toContain(">streamer<");
    expect(html).not.toContain(">dev<");
    expect(html).not.toMatch(/class="[^"]*\bpill\b/);
  });

  it("dots for the items, none for a card with one item; desktop only", () => {
    expect(html.match(/data-trend-dot(?!s)/g)).toHaveLength(3 + 2);
    expect(html).toMatch(
      /class="hidden[^"]*md:flex[^"]*"[^>]*data-trend-dots|data-trend-dots[^>]*class="hidden[^"]*md:flex/,
    );
  });

  it("the dots are real buttons with a label, the one showing marked, never inside a link", () => {
    expect(html).toContain('<button type="button" aria-label="show 1 of 3" aria-current="true"');
    expect(html).toContain('aria-label="show 2 of 3"');
    expect(html).toContain('aria-label="show 3 of 3"');
    expect(html).toContain('aria-label="show 2 of 2"');
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/s);
  });

  it("a card lets the page scroll up and down over it", () => {
    expect(html.match(/touch-pan-y/g)?.length).toBe(3);
  });

  it("the rings in the card colours", () => {
    expect(html).toContain("trend-ring-chad");
    expect(html).toContain("trend-ring-coin");
    expect(html).toContain("trend-ring-drop");
  });

  it("every name, handle, ticker and line on one line with … at the end", () => {
    for (const text of ["alice name", "@alice", "\\$BONK"]) {
      expect(html).toMatch(new RegExp(`class="[^"]*truncate[^"]*"[^>]*>${text}<`));
    }
    for (const b of bigs(html)) {
      if (b.unit !== undefined) expect(b.unitCls).toContain("truncate");
    }
  });

  it("the X link on the chad card, never a link inside a link", () => {
    expect(html).toContain('aria-label="@alice on X"');
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
  });

  it("a testnet coin: the Dexscreener icon dimmed and not a link; no X icon without a link", () => {
    expect(html).toContain('src="/launchpads/dexscreener-logo.png"');
    expect(html).toContain('data-dexscreener="off"');
    expect(html).not.toContain("dexscreener.com");
    expect(html).not.toContain("BONK on X");
  });

  it("an empty card shows its label and one short grey line, not a link", () => {
    const empty = renderToStaticMarkup(
      <TrendingBlock initial={trending({ coin: { range: "day", items: [] } })} chain="all" />,
    );
    expect(empty).toContain("top coin");
    expect(empty).toMatch(/text-chad-text-dim[^"]*">no coin drops today\.</);
    expect(empty).not.toContain('href="/d/NewestDrop');
    expect(empty).toContain('href="/u/alice"');
    expect(empty).not.toContain("nothing dropped");

    const none = { range: "day" as const, items: [] };
    const all = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({ chad: none, coin: none, drop: { items: [] } })}
        chain="all"
      />,
    );
    for (const label of ["chad of the day", "top coin", "just dropped"]) {
      expect(all).toContain(label);
    }
    // Chad of the day counts SOL and ETH drops only, its line says so.
    expect(all.match(/>no SOL or ETH drops today\.</g)).toHaveLength(1);
    // Just dropped: no funded drop at all.
    expect(all.match(/>no drops yet\.</g)).toHaveLength(1);
    expect(all).not.toContain("no drops today.");
    expect(all.match(/>no coin drops today\.</g)).toHaveLength(1);
    expect(all).not.toContain("<a ");
  });

  it("top coin, nothing today: the newest coin drop as its one item", () => {
    // The block reads the real clock, as just dropped does.
    const old = { ...newest(), createdAt: Math.floor(Date.now() / 1000) - 3 * 86400 - 5 * 60 };
    const html = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({ coin: { range: "day", items: [], newest: old } })}
        chain="all"
      />,
    );
    expect(html).toContain('href="/d/OldCoinDrop11111111111111111111111111111111"');
    expect(html).toContain(">3 d ago<");
    expect(html).not.toContain("no coin drops today.");
    expect(html).toContain("$BONK");
    expect(bigs(html).filter((b) => b.amount === "1.5M" && b.unit === "coins")).toHaveLength(2);
    // The phone line under the big line: the age in the spot of `today`.
    expect(html).not.toContain("to 210 people today");
    expect(html).toContain(">to 210 people 3 d ago<");
    // One item: no dots on the coin card; chad of the day keeps its 3, just dropped its 2.
    expect(html.match(/data-trend-dot(?!s)/g)).toHaveLength(5);
  });

  it("top coin with an item today: the card as before, newest never shown", () => {
    const html = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({ coin: { range: "day", items: [coin()], newest: newest() } })}
        chain="all"
      />,
    );
    expect(html).toContain('href="/d/NewestDrop111111111111111111111111111111111"');
    expect(html).not.toContain("OldCoinDrop");
    expect(html).not.toContain("3 d ago");
    expect(html).toContain("to 210 people today");
  });

  it("top coin, newest null: the empty line", () => {
    const html = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({ coin: { range: "day", items: [], newest: null } })}
        chain="all"
      />,
    );
    expect(html).toMatch(/text-chad-text-dim[^"]*">no coin drops today\.</);
    expect(html).not.toContain('href="/d/NewestDrop');
  });

  it("top coin turns through up to 3 coins with the dots, like the other cards", () => {
    const one = { range: "day" as const };
    const dotsFor = (coins: number) =>
      renderToStaticMarkup(
        <TrendingBlock
          initial={trending({
            chad: { ...one, items: [chad("alice")] },
            coin: { ...one, items: Array.from({ length: coins }, () => coin()) },
            drop: { items: [drop()] },
          })}
          chain="all"
        />,
      ).match(/data-trend-dot(?!s)/g)?.length ?? 0;
    expect(dotsFor(3)).toBe(3);
    expect(dotsFor(2)).toBe(2);
    expect(dotsFor(1)).toBe(0);
  });

  it("the api down: one grey line", () => {
    for (const initial of [null, trending({ available: false })]) {
      const down = renderToStaticMarkup(<TrendingBlock initial={initial} chain="all" />);
      expect(down).toContain("trending cannot load right now.");
      expect(down).not.toContain("chad of the day");
    }
  });
});

describe("the coin icons and the pictures", () => {
  const one = (item: TrendingCoin) =>
    renderToStaticMarkup(
      <TrendingBlock initial={trending({ coin: { range: "day", items: [item] } })} chain="all" />,
    );
  const offOf = (html: string) => /<span[^>]*data-dexscreener="off"[^>]*>/.exec(html)?.[0] ?? "";

  it("a mainnet coin: the Dexscreener icon is a link to its chart, in a new tab", () => {
    const html = one({ ...coin(), chainKey: "solana" });
    expect(html).toContain(
      'href="https://dexscreener.com/solana/So1anaMint1111111111111111111111111111111111"',
    );
    expect(html).toContain('aria-label="BONK on dexscreener"');
    expect(html).toContain('data-dexscreener="on"');
    expect(html).not.toContain('data-dexscreener="off"');
  });

  it("a stablecoin on mainnet: dimmed and not a link", () => {
    const usdc = {
      ...token("USDC"),
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    };
    const html = one({ ...coin(), chainKey: "solana", token: usdc });
    expect(html).not.toContain("dexscreener.com");
    expect(offOf(html)).toContain("opacity-40");
  });

  it("dimmed on a testnet, and never inside a link", () => {
    const html = one(coin());
    expect(offOf(html)).toContain("opacity-40");
    expect(offOf(html)).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
  });

  it("the token's X link: the X icon, its own link, a new tab", () => {
    const html = one({ ...coin(), token: { ...token("BONK"), xUrl: "https://x.com/bonkcoin" } });
    expect(html).toMatch(/<a [^>]*href="https:\/\/x\.com\/bonkcoin"[^>]*>/);
    expect(html).toContain('aria-label="BONK on X"');
    expect(html).toMatch(/href="https:\/\/x\.com\/bonkcoin"[^>]*target="_blank"/);
    expect(html).toMatch(/href="https:\/\/x\.com\/bonkcoin"[^>]*rel="noopener noreferrer"/);
  });

  it("no X link, or none on Robinhood: no X icon", () => {
    expect(one({ ...coin(), token: { ...token("BONK"), xUrl: null } })).not.toContain("BONK on X");
    expect(one({ ...coin(), chainKey: "robinhood-testnet" })).not.toContain("BONK on X");
  });

  it("the chad and the sender pictures use the 400x400 file", () => {
    const picture = "https://pbs.twimg.com/profile_images/7/face_normal.jpg";
    const html = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({
          chad: {
            range: "day",
            items: [
              { ...chad("alice"), profile: { ...person("alice"), profileImageUrl: picture } },
            ],
          },
        })}
        chain="all"
      />,
    );
    expect(html).toContain('src="https://pbs.twimg.com/profile_images/7/face_400x400.jpg"');
    expect(html).not.toContain("face_normal.jpg");
  });
});

describe("the icons are the profile page's size", () => {
  const streamer = {
    ...chad("alice"),
    profile: {
      ...person("alice"),
      streams: [
        { platform: "kick" as const, channel: "alicekick" },
        { platform: "twitch" as const, channel: "alicetwitch" },
      ],
    },
  };
  const coinWithX = { ...coin(), token: { ...token("BONK"), xUrl: "https://x.com/bonkcoin" } };
  const html = renderToStaticMarkup(
    <TrendingBlock
      initial={trending({
        chad: { range: "day", items: [streamer] },
        coin: { range: "day", items: [coinWithX] },
      })}
      chain="all"
    />,
  );
  const rows = html.match(/<span[^>]*data-trend-icons[^>]*>/g) ?? [];

  it("X 18px, Kick 13px, Twitch 21px, about 15 percent under the profile page", () => {
    // The chad, the coin and just dropped, each on the phone and on desktop.
    expect(html.match(/class="size-\[18px\]"/g)?.length).toBe(6);
    expect(html.match(/kick-logo\.png" alt="" width="13" height="13"/g)?.length).toBe(2);
    expect(html.match(/twitch-logo\.png" alt="" width="21" height="21"/g)?.length).toBe(2);
    expect(html).not.toContain('class="size-[21px]"');
    // Each still in its 44px target.
    expect(html.match(/aria-label="@alice on X" class="[^"]*size-11/g)?.length).toBe(2);
    // Nothing small is left.
    expect(html).not.toContain('class="size-3"');
    expect(html).not.toContain('width="12"');
  });

  it("just dropped: the sender's X, Kick and Twitch, as on chad of the day", () => {
    const sender = {
      ...person("bigchad"),
      streams: [
        { platform: "kick" as const, channel: "bigkick" },
        { platform: "twitch" as const, channel: "bigtwitch" },
      ],
    };
    const only = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({
          chad: { range: "day", items: [] },
          drop: { items: [{ ...drop(), sender }] },
        })}
        chain="all"
      />,
    );
    // Phone and desktop, the same sizes as the chad card.
    expect(only.match(/href="https:\/\/kick\.com\/bigkick"/g)?.length).toBe(2);
    expect(only.match(/href="https:\/\/www\.twitch\.tv\/bigtwitch"/g)?.length).toBe(2);
    expect(only.match(/kick-logo\.png" alt="" width="13" height="13"/g)?.length).toBe(2);
    expect(only.match(/twitch-logo\.png" alt="" width="21" height="21"/g)?.length).toBe(2);
    expect(only.match(/aria-label="@bigchad on X"/g)?.length).toBe(2);
    // Not connected: only the X.
    const plain = renderToStaticMarkup(
      <TrendingBlock
        initial={trending({
          chad: { range: "day", items: [] },
          drop: { items: [drop()] },
        })}
        chain="all"
      />,
    );
    expect(plain).not.toContain("kick-logo");
    expect(plain).not.toContain("twitch-logo");
    expect(plain.match(/aria-label="@bigchad on X"/g)?.length).toBe(2);
  });

  it("the profile page keeps its own sizes", () => {
    const profile = renderToStaticMarkup(
      <>
        <XLink handle="alice" />
        <StreamLinks streams={[{ platform: "kick", channel: "alicekick" }]} />
      </>,
    );
    expect(profile).toContain('class="size-[21px]"');
    expect(profile).toContain('width="15" height="15"');
  });

  it("8px apart, as on the profile page, and always in one row", () => {
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toContain("gap-2");
      expect(row).toContain("flex-nowrap");
    }
  });

  it("Dexscreener one step bigger than the X, so its mark looks as big as the X icons", () => {
    expect(DEXSCREENER_ICON_PX).toBe(19);
    // Phone and desktop, in the same dimmed spot on a testnet.
    expect(html.match(/dexscreener-logo\.png" alt="" width="19" height="19"/g)?.length).toBe(2);
    expect(html.match(/data-dexscreener="off"/g)?.length).toBe(2);
    expect(html).toContain('aria-label="BONK on X"');
  });
});

describe("the front page order", () => {
  it("sits between the line by the button and the drops list", () => {
    const page = renderToStaticMarkup(
      <FrontPage pills={[]} stats={null} drops={[]} board={null} trending={trending()} />,
    );
    const line = page.indexOf("make a drop");
    const block = page.indexOf("chad of the day");
    const list = page.indexOf('id="live"');
    expect(line).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(line);
    expect(list).toBeGreaterThan(block);
  });
});

describe("the colours and the motion", () => {
  it("the gold and soft blue tokens", () => {
    expect(css).toContain("--chad-trend-gold: #f2c14e;");
    expect(css).toContain("--chad-trend-blue: #6ec1ff;");
  });

  it("the rings: brand mint, gold, blue, a 2px ring and a glow of the same colour", () => {
    for (const [name, color] of [
      ["chad", "--chad-brand-mint"],
      ["coin", "--chad-trend-gold"],
      ["drop", "--chad-trend-blue"],
    ] as const) {
      const rule = new RegExp(`\\.trend-ring-${name} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(rule).toContain(`var(${color})`);
    }
    const ring = /\.trend-ring \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(ring).toContain("0 0 0 2px var(--trend-color)");
  });

  it("desktop: a 2px surface gap, then a 1px ring and the glow", () => {
    const compact = /\.trend-ring-compact \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(compact).toContain("0 0 0 2px var(--chad-surface)");
    expect(compact).toContain("0 0 0 3px var(--trend-color)");
    expect(compact).toContain("var(--trend-color)");
  });

  it("the flip is 400ms on the Y axis with the enter easing", () => {
    const flip = /\.trend-flip \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(flip).toContain("400ms");
    expect(flip).toContain("cubic-bezier(0.2, 0, 0, 1)");
    expect(css).toMatch(/@keyframes trend-flip \{[^]*rotateY/);
  });

  it("reduced motion: no flip", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.trend-flip \{\s*animation: none;/,
    );
  });
});
