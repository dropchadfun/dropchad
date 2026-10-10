/**
 * The boards as a trending race: the
 * range tabs `24h` / `this week` / `all time`, a small live line that says when the board was
 * fetched, each row with people paid big and `$21.40 · 4 drops` small, the top 3 with a
 * stronger number and a thin mint line on the left, and the X link after every name. A board
 * row is tapped as a whole through a stretched profile link, never a link inside a link.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RANGE_TABS, rangeFromParam } from "@/components/boards/BoardTabs";
import { BoardRows } from "@/components/boards/BoardRows";
import { BOARD_REFRESH_MS, updatedLine } from "@/components/boards/live-line";
import type { BoardRow, Profile } from "@/lib/api";

const SRC = join(__dirname, "..", "src");

const person = (n: number): Profile => ({
  xUserId: String(n),
  handle: `samplechad${String(n)}`,
  displayName: "sample",
  profileImageUrl: null,
  kind: "chad",
  tags: n === 1 ? ["dev", "kol"] : [],
  tagLockedUntil: null,
  badges: [],
});

const row = (n: number, usd: number, dropCount: number, claimCount = dropCount): BoardRow => ({
  rank: n,
  profile: person(n),
  totalWei: "1",
  dropCount,
  claimCount,
  uniqueReceivers: 50 - n,
  biggestDropWei: "1",
  lastDropAt: 1,
  usd,
  byChain: [],
});

const rows = [row(1, 21.4, 4, 9), row(2, 0, 1, 1), row(3, 5, 2), row(4, 3, 3), row(5, 1, 1)];
const html = renderToStaticMarkup(<BoardRows rows={rows} rankedBy="uniqueReceivers" />);

/** The markup of one row, from its opening tag to the next row. */
function rowOf(n: number): string {
  const parts = html.split(/(?=<div class="[^"]*board-row)/);
  return parts.find((part) => part.includes(`@samplechad${String(n)}<`)) ?? "";
}

describe("the range tabs", () => {
  it("24h, this week, all time, in that order", () => {
    expect(RANGE_TABS).toEqual([
      { value: "day", label: "24h" },
      { value: "week", label: "this week" },
      { value: "all", label: "all time" },
    ]);
  });

  it("a url may name day, week or all; anything else is this week", () => {
    expect(rangeFromParam("day")).toBe("day");
    expect(rangeFromParam("all")).toBe("all");
    expect(rangeFromParam("week")).toBe("week");
    expect(rangeFromParam("24h")).toBe("week");
    expect(rangeFromParam(undefined)).toBe("week");
  });

  it("the boards page takes day from the url", () => {
    const page = readFileSync(join(SRC, "app", "boards", "page.tsx"), "utf8");
    expect(page).toContain("rangeFromParam(");
  });
});

describe("the live line", () => {
  const at = Date.parse("2026-10-01T12:00:00.000Z");

  it("says how long ago the board was fetched, in plain words", () => {
    expect(updatedLine(at, at)).toBe("live · updated just now");
    expect(updatedLine(at, at + 9_000)).toBe("live · updated just now");
    expect(updatedLine(at, at + 20_000)).toBe("live · updated 20s ago");
    expect(updatedLine(at, at + 125_000)).toBe("live · updated 2m ago");
    expect(updatedLine(at, at + 2 * 3_600_000)).toBe("live · updated 2h ago");
  });

  it("the board fetches itself again every 60 seconds", () => {
    expect(BOARD_REFRESH_MS).toBe(60_000);
  });
});

describe("a board row", () => {
  it("people paid big on the right, usd and drops small under the name", () => {
    expect(rowOf(1)).toContain("49");
    expect(rowOf(1)).toContain("people");
    // the payouts after the drops, still ranked and shown big by people.
    expect(rowOf(1)).toContain("$21.40 · 4 drops · 9 payouts");
    expect(rowOf(2)).toContain("$0.00 · 1 drop · 1 payout<");
  });

  it("the top 3 stand out: a stronger number and the thin mint line; the 4th does not", () => {
    for (const n of [1, 2, 3]) {
      expect(rowOf(n), String(n)).toMatch(/class="[^"]*board-top/);
      expect(rowOf(n), String(n)).toContain("type-stat");
    }
    for (const n of [4, 5]) {
      expect(rowOf(n), String(n)).not.toMatch(/class="[^"]*board-top/);
      expect(rowOf(n), String(n)).not.toContain("type-stat");
    }
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(/\.board-top \{([^}]*)\}/.exec(css)?.[1] ?? "").toContain("var(--chad-accent)");
  });

  it("the X link after every name, and the main tag alone, no +N", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(rowOf(n)).toContain(`href="https://x.com/samplechad${String(n)}"`);
    }
    expect(rowOf(1)).toMatch(/>dev<\/span>/);
    expect(rowOf(1)).not.toMatch(/>\+\d</);
    expect(rowOf(1)).not.toContain("more-tags");
  });

  it("on the phone the tag pill is hidden on board rows, the X logo stays", () => {
    // the names of the top 3 were cut on the phone. From md up it shows.
    expect(rowOf(1)).toMatch(
      /<span class="[^"]*\bhidden\b[^"]*md:inline-flex[^"]*"><span class="pill/,
    );
    expect(rowOf(1)).not.toMatch(/class="[^"]*\bhidden\b[^"]*"><a [^>]*x\.com/);
  });

  it("is tapped as a whole through the profile link, never a link inside a link", () => {
    // The profile link, stretched over the row; attribute order does not matter.
    expect(rowOf(1)).toMatch(/<a (?=[^>]*href="\/u\/samplechad1")(?=[^>]*after:absolute)[^>]*>/);
    // Every <a> closes before the next one opens.
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
  });
});
