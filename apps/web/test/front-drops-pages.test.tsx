/**
 * The front page `latest` tab reads its pages from the api
 * 10 drops a page, every page reachable, not only the newest 50. Its page
 * is its own, `drops_page=` in the url, apart from the `top chads` `board_page=`: neither pager
 * moves the other. The `live` tab stays as it was. A tab or rail tap, and the logo or `home`,
 * start it on page 1. Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DROPS_PAGE_PARAM,
  dropsPageFromSearch,
  urlWithDropsPage,
} from "@/components/front/drops-page";
import { FrontPage } from "@/components/front/FrontPage";
import { listDropsPage, type DropListEntry, type DropsPage } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

/** A listed handle drop, made at second `n`, its title `sample drop n`. */
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

/** Page `page` of `total` drops, newest first: drop `total` is the newest. */
const latest = (page: number, total: number): DropsPage => {
  const top = total - (page - 1) * 10;
  return {
    page,
    pageSize: 10,
    total,
    drops: Array.from({ length: Math.max(0, Math.min(10, top)) }, (_, i) => entry(top - i)),
  };
};

const front = (props: { latest: DropsPage | null; dropsPage: number; drops?: number }) =>
  renderToStaticMarkup(
    <FrontPage
      pills={[]}
      stats={null}
      drops={Array.from({ length: props.drops ?? 0 }, (_, i) => entry(i + 1))}
      board={null}
      latest={props.latest}
      dropsPage={props.dropsPage}
    />,
  );

const nav = (html: string) => /<nav aria-label="pages"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the drops page in the url, its own value", () => {
  it("is drops_page, never board_page", () => {
    expect(DROPS_PAGE_PARAM).toBe("drops_page");
  });

  it("reads a whole number from 1, anything else is page 1", () => {
    expect(dropsPageFromSearch("?drops_page=7")).toBe(7);
    expect(dropsPageFromSearch("?board_page=3&drops_page=2")).toBe(2);
    for (const bad of ["", "?drops_page=0", "?drops_page=-1", "?drops_page=x", "?board_page=4"]) {
      expect(dropsPageFromSearch(bad), bad).toBe(1);
    }
  });

  it("writes the drops page and never touches the board page", () => {
    expect(urlWithDropsPage("/", "?board_page=3", "", 2)).toBe("/?board_page=3&drops_page=2");
    expect(urlWithDropsPage("/", "?board_page=3&drops_page=2", "", 1)).toBe("/?board_page=3");
    expect(urlWithDropsPage("/", "", "#top", 5)).toBe("/?drops_page=5#top");
  });
});

describe("the api call for one page", () => {
  it("asks for that page and that chain", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify(latest(1, 3)), { status: 200 }));
    });
    await listDropsPage(4, "solana");
    expect(urls[0]).toMatch(/\/api\/drops\?page=4&chain=solana$/);
  });
});

describe("latest shows the page the api sent", () => {
  it("page 3 of 185: its 10 drops and the page numbers, 3 marked", () => {
    const html = front({ latest: latest(3, 185), dropsPage: 3 });
    expect(html).toContain("sample drop 165<");
    expect(html).toContain("sample drop 156<");
    expect(html).not.toContain("sample drop 166<");
    expect(nav(html)).toMatch(/aria-current="page"[^>]*>3<\/button>/);
    // 19 pages: the last one can be reached.
    expect(nav(html)).toMatch(/>19<\/button>/);
  });

  it("10 drops or fewer: no page numbers", () => {
    expect(nav(front({ latest: latest(1, 10), dropsPage: 1 }))).toBe("");
  });

  it("the api down: the list says it cannot load", () => {
    expect(front({ latest: null, dropsPage: 1 })).toContain(
      "drops cannot load right now. try again in a minute.",
    );
  });

  it("no drops at all on these chains: the empty line", () => {
    expect(front({ latest: latest(1, 0), dropsPage: 1 })).toContain(
      "no drops on these chains yet.",
    );
  });

  it("the live tab still counts the live drops of the newest list, as before", () => {
    const src = read("components", "front", "FrontPage.tsx");
    expect(src).toMatch(/const tabs = dropTabs\(cards\);/);
    expect(src).toMatch(/tab === "live" \? tabs\.live/);
  });
});

describe("a tap on one pager never moves the other", () => {
  const src = read("components", "front", "FrontPage.tsx");
  const body = (name: string) =>
    new RegExp(`const ${name} = \\([^)]*\\) => \\{([\\s\\S]*?)\\n {2}\\};`).exec(src)?.[1] ?? "";

  it("the drops pager has its own handler, and it never sets the board page", () => {
    expect(src).toMatch(/tab === "latest" \? \(?\s*<Pager[\s\S]*?onPick=\{onDropsPage\}/);
    expect(body("onDropsPage")).toContain("setPage(next)");
    expect(body("onDropsPage")).not.toContain("setBoardPage");
  });

  it("the board pager never sets the drops page", () => {
    expect(body("onBoardPage")).not.toContain("setPage(");
  });

  it("the logo or home tap starts the drops list on page 1 too, through the current handler", () => {
    const home = src.match(/const home = \(\) => \{([\s\S]*?)\};/)?.[1] ?? "";
    expect(home).toContain("dropsPageRef.current(1)");
    expect(src).toMatch(/dropsPageRef\.current = onDropsPage;/);
  });

  it("a rail tap reads page 1 of the new chain from the api", () => {
    expect(body("onRail")).toMatch(/loadLatest\(boardChainOf\(next\), 1\)/);
  });
});

describe("the server reads the drops page", () => {
  it("the home page fetches that page and hands it in, next to the newest list for live", () => {
    const page = read("app", "page.tsx");
    expect(page).toMatch(/dropsPageFromParam\(/);
    expect(page).toMatch(/listDropsPage\(dropsPage, "all"\)/);
    expect(page).toMatch(/listDrops\(50\)/);
    expect(page).toMatch(/latest=\{latest\}/);
    expect(page).toMatch(/dropsPage=\{dropsPage\}/);
  });
});
