/**
 * The boards
 * - `/boards` has pages of 10: the drops list pager under the rows, the page in the url, the
 *   rank from the api so page 2 starts at 11; the front page block has the same pager since
 *   `front-board-pages.test.tsx`
 * - the third tab `most dropped`, the api's usd board, with the line `ranked by usd dropped`
 * Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardBlock } from "@/components/boards/BoardBlock";
import { BOARD_TABS, pageFromParam, tabFromParam } from "@/components/boards/BoardTabs";
import { BoardsPage } from "@/components/boards/BoardsPage";
import { getBoard, type Board, type BoardRow, type Profile } from "@/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => "/boards",
}));

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
  usd: 1000 - rank,
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
  rows: [1, 2, 3].map(row),
  page: 1,
  pageSize: 10,
  total: 3,
  ...over,
});

const page = (props: { board: Board; page: number }) =>
  renderToStaticMarkup(
    <BoardsPage
      range="week"
      type={props.board.board}
      chain="all"
      pills={[]}
      board={props.board}
      page={props.page}
    />,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the third tab, most dropped", () => {
  it("comes after best dropchad and best token", () => {
    expect(BOARD_TABS).toEqual([
      { value: "fed", label: "best dropchad" },
      { value: "project", label: "best token" },
      { value: "dropper", label: "most dropped" },
    ]);
  });

  it("the url can pick it", () => {
    expect(tabFromParam("dropper")).toBe("dropper");
    expect(tabFromParam("whale")).toBe("fed");
  });

  it("says ranked by usd dropped, once, in the small grey line, and not people fed", () => {
    const html = renderToStaticMarkup(
      <BoardBlock board={board({ board: "dropper", rankedBy: "usd" })} empty="none" header />,
    );
    expect(html.split("ranked by usd dropped")).toHaveLength(2);
    expect(html).toMatch(
      /<p class="[^"]*type-small[^"]*text-chad-text-dim[^"]*">ranked by usd dropped<\/p>/,
    );
    expect(html).not.toContain("ranked by people fed");
  });

  it("the people boards keep their line and never say usd dropped", () => {
    for (const type of ["fed", "project"] as const) {
      const html = renderToStaticMarkup(
        <BoardBlock board={board({ board: type })} empty="none" header />,
      );
      expect(html).toContain("ranked by people fed");
      expect(html).not.toContain("ranked by usd dropped");
    }
  });
});

describe("the page in the url", () => {
  it("reads a whole number from 1, anything else is page 1", () => {
    expect(pageFromParam("2")).toBe(2);
    expect(pageFromParam("12")).toBe(12);
    for (const bad of [undefined, "", "0", "-3", "1.5", "abc", "2x"]) {
      expect(pageFromParam(bad), String(bad)).toBe(1);
    }
  });

  it("asks the api for that page, and for no page on page 1", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify(board()), { status: 200 }));
    });
    await getBoard("all", "dropper", "all", 2);
    await getBoard("week", "fed", "all");
    expect(urls[0]).toMatch(/\/api\/boards\?range=all&board=dropper&chain=all&page=2$/);
    expect(urls[1]).toMatch(/\/api\/boards\?range=week&board=fed&chain=all$/);
  });
});

describe("/boards has pages of 10", () => {
  it("shows the pager when there is more than one page, the current page marked", () => {
    const html = page({
      board: board({ rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(row), page: 2, total: 23 }),
      page: 2,
    });
    expect(html).toContain('aria-label="pages"');
    expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*>2<\/button>/);
    expect(html).toMatch(/>3<\/button>/);
  });

  it("shows the ranks the api sent: page 2 starts at 11", () => {
    const html = page({
      board: board({ rows: [11, 12].map(row), page: 2, total: 12 }),
      page: 2,
    });
    expect(html).toContain("samplechad11");
    expect(html).toMatch(/>11</);
    expect(html).not.toContain("samplechad1<");
  });

  it("no pager on one page", () => {
    expect(page({ board: board({ total: 3 }), page: 1 })).not.toContain('aria-label="pages"');
  });

  it("the same Pager as the drops list", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "components", "boards", "BoardsPage.tsx"),
      "utf8",
    );
    expect(source).toContain('import { Pager } from "@/components/site/Pager";');
  });

  it("the front page block uses the same Pager too, front-board-pages.test.tsx", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "components", "front", "FrontPage.tsx"),
      "utf8",
    );
    expect(source).toContain('import { Pager } from "@/components/site/Pager";');
    expect(source).toMatch(/<BoardBlock[\s\S]*?<Pager/);
  });
});
