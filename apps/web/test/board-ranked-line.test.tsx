/**
 * One small grey line `ranked by people fed` over the rows, on `/boards` and the front page
 * block, both tabs. Both pages
 * draw their rows through `BoardBlock`, so the line lives there. Rendered with
 * `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardBlock } from "@/components/boards/BoardBlock";
import type { Board, BoardRow, Profile } from "@/lib/api";

const LINE = "ranked by people fed";

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

const row = (n: number): BoardRow => ({
  rank: n,
  profile: person(n),
  totalWei: "1",
  dropCount: 1,
  claimCount: 1,
  uniqueReceivers: 10 - n,
  biggestDropWei: "1",
  lastDropAt: 1,
  usd: 0,
  byChain: [],
});

const board = (over: Partial<Board> = {}): Board => ({
  range: "week",
  kind: "all",
  board: "fed",
  chain: "all",
  rankedBy: "uniqueReceivers",
  available: true,
  finality: "final",
  rows: [row(1), row(2), row(3), row(4)],
  ...over,
});

describe("the ranked by people fed line", () => {
  it("shows on the boards page, over the rows", () => {
    const html = renderToStaticMarkup(<BoardBlock board={board()} empty="none" header />);
    expect(html).toContain(LINE);
    expect(html.indexOf(LINE)).toBeLessThan(html.indexOf("board-row"));
  });

  it("shows on the front page block, top rows only", () => {
    const html = renderToStaticMarkup(<BoardBlock board={board()} empty="none" limit={3} />);
    expect(html).toContain(LINE);
    expect(html.indexOf(LINE)).toBeLessThan(html.indexOf("board-row"));
  });

  it("shows on both tabs, best dropchad and best token", () => {
    for (const type of ["fed", "project"] as const) {
      const html = renderToStaticMarkup(
        <BoardBlock board={board({ board: type })} empty="none" header />,
      );
      expect(html).toContain(LINE);
    }
  });

  it("is one grey small line, said once", () => {
    const html = renderToStaticMarkup(<BoardBlock board={board()} empty="none" header />);
    expect(html.split(LINE)).toHaveLength(2);
    expect(html).toMatch(
      /<p class="[^"]*type-small[^"]*text-chad-text-dim[^"]*">ranked by people fed<\/p>/,
    );
  });

  it("is not said for a board that is not ranked by people", () => {
    const html = renderToStaticMarkup(
      <BoardBlock board={board({ board: "dropper", rankedBy: "usd" })} empty="none" header />,
    );
    expect(html).not.toContain(LINE);
  });

  it("is not said when there are no rows to rank", () => {
    const none = renderToStaticMarkup(<BoardBlock board={board({ rows: [] })} empty="none" />);
    const down = renderToStaticMarkup(<BoardBlock board={null} empty="none" />);
    const off = renderToStaticMarkup(
      <BoardBlock board={board({ available: false, rows: [] })} empty="none" />,
    );
    expect(none).not.toContain(LINE);
    expect(down).not.toContain(LINE);
    expect(off).not.toContain(LINE);
  });
});
