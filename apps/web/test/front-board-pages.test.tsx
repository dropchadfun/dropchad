/**
 * The front page `top chads` block has pages of 10
 * the same pager as `/boards` under its rows, on every tab and range, the rank from the api so
 * page 2 starts at 11. Its page is its own, `board_page=` in the url, apart from the drops list
 * page: a tap on one pager never moves the other. A tab, range or rail tap starts it on page 1.
 * The `all boards` link stays. Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BOARD_PAGE_PARAM,
  boardPageFromSearch,
  urlWithBoardPage,
} from "@/components/front/board-page";
import { FrontPage } from "@/components/front/FrontPage";
import type { Board, BoardRow, DropListEntry, Profile } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

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

const row = (rank: number): BoardRow => ({
  rank,
  profile: person(rank),
  totalWei: "1",
  dropCount: 1,
  claimCount: 1,
  uniqueReceivers: 100 - rank,
  biggestDropWei: "1",
  lastDropAt: 1,
  usd: 0,
  byChain: [],
});

const board = (page: number, total: number): Board => {
  const first = (page - 1) * 10 + 1;
  const last = Math.min(total, page * 10);
  return {
    range: "week",
    kind: "all",
    board: "fed",
    chain: "all",
    rankedBy: "uniqueReceivers",
    available: true,
    finality: "final",
    page,
    pageSize: 10,
    total,
    rows: Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => row(first + i)),
  };
};

/** A listed handle drop, made at second `n`. */
const entry = (n: number): DropListEntry => ({
  address: `0x${n.toString(16).padStart(40, "0")}`,
  chainId: 46630,
  status: "Finalized",
  asset: "0x0000000000000000000000000000000000000000",
  creatorCommitment: "0x",
  totalEntitlements: "1",
  leafCount: 1,
  totalClaimed: "1",
  claimedCount: 1,
  claimDeadline: null,
  fundingDeadline: "0",
  verified: true,
  createdAt: String(n),
  transactionHash: "0x",
  finality: "final",
  statusFinality: "final",
  dropchad: {
    address: `0x${n.toString(16).padStart(40, "0")}`,
    chainId: 46630,
    asset: "0x0000000000000000000000000000000000000000",
    token: null,
    title: `sample drop ${String(n)}`,
    state: "finished",
    mode: "handle",
    totalEntitlementsWei: "1",
    leafCount: 1,
    paidCount: 1,
    failedIndexes: [],
    createTxHash: "0x",
    activateTxHash: null,
    lastTxHash: null,
    fundingDeadline: "0",
    createdAt: "1970-01-01T00:00:00.000Z",
    creator: null,
  },
});

const front = (props: { board: Board; boardPage: number; drops: number }) =>
  renderToStaticMarkup(
    <FrontPage
      pills={[]}
      stats={null}
      drops={Array.from({ length: props.drops }, (_, i) => entry(i + 1))}
      board={props.board}
      boardPage={props.boardPage}
    />,
  );

describe("the board page in the url, its own value", () => {
  it("is board_page, never the drops list's", () => {
    expect(BOARD_PAGE_PARAM).toBe("board_page");
  });

  it("reads a whole number from 1, anything else is page 1", () => {
    expect(boardPageFromSearch("?board_page=3")).toBe(3);
    expect(boardPageFromSearch("?x=1&board_page=12")).toBe(12);
    for (const bad of ["", "?board_page=0", "?board_page=-2", "?board_page=1.5", "?board_page=a"]) {
      expect(boardPageFromSearch(bad), bad).toBe(1);
    }
    // `page` is the boards page's name, not this one.
    expect(boardPageFromSearch("?page=4")).toBe(1);
  });

  it("writes the board page and leaves everything else in the address as it was", () => {
    expect(urlWithBoardPage("/", "", "", 2)).toBe("/?board_page=2");
    expect(urlWithBoardPage("/", "?x=1&board_page=2", "#top", 4)).toBe("/?x=1&board_page=4#top");
    // Page 1 is the plain address.
    expect(urlWithBoardPage("/", "?board_page=3", "", 1)).toBe("/");
    expect(urlWithBoardPage("/", "?x=1&board_page=3", "", 1)).toBe("/?x=1");
  });
});

describe("top chads on the front page has pages of 10", () => {
  it("shows its own pager under the rows, the current page marked, the ranks from 11", () => {
    const html = front({ board: board(2, 23), boardPage: 2, drops: 0 });
    expect(html).toContain('aria-label="board pages"');
    const pager = /<nav aria-label="board pages"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(pager).toMatch(/aria-current="page"[^>]*>2<\/button>/);
    expect(pager).toMatch(/>3<\/button>/);
    expect(html).toContain("@samplechad11<");
    expect(html).toContain("@samplechad20<");
    expect(html).not.toContain("@samplechad10<");
  });

  it("no board pager on one page; the all boards link stays", () => {
    const html = front({ board: board(1, 7), boardPage: 1, drops: 0 });
    expect(html).not.toContain('aria-label="board pages"');
    expect(html).toMatch(/>all boards →</);
  });

  it("the two pagers stand apart: board page 2 while the drops list is on page 1", () => {
    // The drops list pages come from the api: page 1 of 25.
    const latest = {
      page: 1,
      pageSize: 10,
      total: 25,
      drops: Array.from({ length: 10 }, (_, i) => entry(25 - i)),
    };
    const html = renderToStaticMarkup(
      <FrontPage
        pills={[]}
        stats={null}
        drops={[]}
        board={board(2, 23)}
        boardPage={2}
        latest={latest}
        dropsPage={1}
      />,
    );
    const drops = /<nav aria-label="pages"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    const boards = /<nav aria-label="board pages"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(drops).toMatch(/aria-current="page"[^>]*>1<\/button>/);
    expect(boards).toMatch(/aria-current="page"[^>]*>2<\/button>/);
  });
});

describe("a tap on one pager never moves the other", () => {
  const src = read("components", "front", "FrontPage.tsx");

  it("the drops list pager sets only the drops page, through its own handler", () => {
    expect(src).toMatch(/tab === "latest" \? \(?\s*<Pager[\s\S]*?onPick=\{onDropsPage\}/);
    const handler = /const onDropsPage = \(next: number\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1];
    expect(handler).toBeDefined();
    expect(handler).not.toContain("setBoardPage");
  });

  it("the board pager sets only the board page, through its own handler", () => {
    expect(src).toMatch(/<Pager[\s\S]*?label="board pages"[\s\S]*?onPick=\{onBoardPage\}/);
    const handler = /const onBoardPage = \(next: number\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1];
    expect(handler).toBeDefined();
    expect(handler).not.toContain("setPage(");
    expect(handler).toContain("setBoardPage(next)");
  });

  it("the drops list's own page is never in the board handlers, the board page never in setPage", () => {
    // `setBoardPage` is only called by the board: its pager, its tabs, its range, the rail.
    const calls = src.match(/setBoardPage\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/setPage\(boardPage/);
  });

  it("a tab, range or rail tap starts the board on page 1", () => {
    for (const name of ["onTab", "onRange", "onRail"]) {
      const body = new RegExp(`const ${name} = \\([^)]*\\) => \\{([\\s\\S]*?)\\n {2}\\};`).exec(
        src,
      )?.[1];
      expect(body, name).toContain("setBoardPage(1)");
    }
  });
});

describe("the server reads the board page", () => {
  it("the home page fetches that page of the week board and hands it in", () => {
    const page = read("app", "page.tsx");
    expect(page).toContain("boardPageFrom");
    expect(page).toMatch(/getBoard\("week", "fed", "all", boardPage\)/);
    expect(page).toMatch(/boardPage=\{boardPage\}/);
  });
});
