/**
 * Pages on the front page `latest` tab: 10 rows a page,
 * the page numbers under the list, the current page marked. A tap shows those 10 drops in place.
 * 10 drops or fewer: no page numbers. A rail tap or a tab change goes back to page 1. The `live`
 * tab has no pages. Each page comes from the api, `front-drops-pages.test.tsx`, and
 * the page numbers move with you on every list: up to 7 pages every number, more `1 … 6 7 8 …
 * 19`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DropCardData } from "@/components/drops/drop-card-data";
import {
  LATEST_PAGE,
  dropTabs,
  latestPage,
  pageCount,
  pagerItems,
} from "@/components/front/drop-tabs";
import { FrontPage } from "@/components/front/FrontPage";
import type { DropListEntry, DropsPage } from "@/lib/api";

const SRC = join(__dirname, "..", "src");

const card = (n: number): DropCardData => ({
  address: `0x${n.toString(16).padStart(40, "0")}`,
  chainId: 46630,
  title: null,
  creator: null,
  chip: "DONE",
  amountWei: "1",
  receivers: 1,
  claimed: 0,
  createdAt: n,
});

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

/** Page 1 of `count` drops as the api sends it: the newest 10, drop `count` the newest. */
const firstPage = (count: number): DropsPage => ({
  page: 1,
  pageSize: 10,
  total: count,
  drops: Array.from({ length: Math.min(10, count) }, (_, i) => entry(count - i)),
});

const frontWith = (count: number) =>
  renderToStaticMarkup(
    <FrontPage
      pills={[]}
      stats={null}
      drops={Array.from({ length: count }, (_, i) => entry(i + 1))}
      board={null}
      latest={firstPage(count)}
      dropsPage={1}
    />,
  );

/** The pager row, or `null` when the page has none. */
const pager = (html: string) => /<nav aria-label="pages"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? null;

describe("latest pages, the pure part", () => {
  it("10 rows a page", () => {
    expect(LATEST_PAGE).toBe(10);
  });

  it("latest is every drop newest first, no cut at 12 any more", () => {
    const tabs = dropTabs(Array.from({ length: 50 }, (_, i) => card(i)));
    expect(tabs.latest).toHaveLength(50);
    expect(tabs.latest[0]?.createdAt).toBe(49);
    expect(tabs.latest[49]?.createdAt).toBe(0);
  });

  it("page count: 10 or fewer is one page, 11 is two, 50 is five", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(11)).toBe(2);
    expect(pageCount(50)).toBe(5);
  });

  it("a page is its 10 drops; the last page holds the rest", () => {
    const all = Array.from({ length: 25 }, (_, i) => card(i));
    expect(latestPage(all, 1).map((c) => c.createdAt)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(latestPage(all, 2).map((c) => c.createdAt)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(latestPage(all, 3).map((c) => c.createdAt)).toEqual([20, 21, 22, 23, 24]);
  });

  it("a page past the end shows the last page, never an empty list", () => {
    const all = Array.from({ length: 15 }, (_, i) => card(i));
    expect(latestPage(all, 4).map((c) => c.createdAt)).toEqual([10, 11, 12, 13, 14]);
  });

  it("one page: no page numbers", () => {
    expect(pagerItems(1, 1)).toEqual([]);
  });

  it("up to 7 pages: every number", () => {
    expect(pagerItems(3, 2)).toEqual([
      { page: 1, label: "1", current: false },
      { page: 2, label: "2", current: true },
      { page: 3, label: "3", current: false },
    ]);
    expect(pagerItems(7, 7).map((i) => i.label)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("more pages: 1, the current page with one on each side, the last, and … between", () => {
    const labels = (pages: number, on: number) => pagerItems(pages, on).map((i) => i.label);
    expect(labels(19, 7)).toEqual(["1", "…", "6", "7", "8", "…", "19"]);
    expect(labels(19, 1)).toEqual(["1", "2", "…", "19"]);
    expect(labels(19, 19)).toEqual(["1", "…", "18", "19"]);
    // A gap of one page shows that page, never a `…` for it.
    expect(labels(19, 3)).toEqual(["1", "2", "3", "4", "…", "19"]);
    expect(labels(19, 4)).toEqual(["1", "2", "3", "4", "5", "…", "19"]);
    expect(labels(19, 17)).toEqual(["1", "…", "16", "17", "18", "19"]);
  });

  it("a … is not a page, and exactly one page is marked", () => {
    const items = pagerItems(19, 7);
    expect(items.filter((i) => i.label === "…").every((i) => i.page === null)).toBe(true);
    expect(items.filter((i) => i.current)).toEqual([{ page: 7, label: "7", current: true }]);
  });

  it("every page can be reached, by taps from page 1", () => {
    for (const pages of [8, 19, 250]) {
      const seen = new Set([1]);
      const todo = [1];
      while (todo.length > 0) {
        const on = todo.pop() as number;
        for (const item of pagerItems(pages, on)) {
          if (item.page !== null && !seen.has(item.page)) {
            seen.add(item.page);
            todo.push(item.page);
          }
        }
      }
      expect(seen.size, String(pages)).toBe(pages);
    }
  });
});

describe("latest pages, rendered", () => {
  it("10 drops or fewer: all of them, no page numbers", () => {
    const html = frontWith(10);
    for (let n = 1; n <= 10; n++) expect(html).toContain(`sample drop ${String(n)}<`);
    expect(pager(html)).toBeNull();
  });

  it("11 drops: the newest 10 on page 1, then 1 2 under the list, 1 marked", () => {
    const html = frontWith(11);
    for (let n = 2; n <= 11; n++) expect(html).toContain(`sample drop ${String(n)}<`);
    expect(html).not.toContain("sample drop 1<");
    const nav = pager(html);
    expect(nav).not.toBeNull();
    expect(nav).toMatch(/aria-current="page"[^>]*>1</);
    expect(nav).toMatch(/>2</);
    expect(nav).not.toContain(">last<");
  });

  it("50 drops: 1 2 3 4 5, page 1 marked", () => {
    const nav = pager(frontWith(50)) ?? "";
    const labels = [...nav.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(["1", "2", "3", "4", "5"]);
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("185 drops: 1 2 … 19, the … not a button", () => {
    const nav = pager(frontWith(185)) ?? "";
    const labels = [...nav.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(["1", "2", "19"]);
    expect(nav).toContain("…");
  });

  it("the page numbers sit under the list, inside the drops section, before top chads", () => {
    const html = frontWith(50);
    expect(html.indexOf("sample drop 41<")).toBeLessThan(html.indexOf('aria-label="pages"'));
    expect(html.indexOf('aria-label="pages"')).toBeLessThan(html.indexOf(">top chads<"));
  });

  it("a tap is a button, never a link: the front page stays", () => {
    const nav = pager(frontWith(50)) ?? "";
    expect(nav).not.toContain("<a ");
    expect(nav).toMatch(/<button type="button"/);
  });
});

describe("latest pages, in the source", () => {
  const src = readFileSync(join(SRC, "components", "front", "FrontPage.tsx"), "utf8");

  it("a rail tap and a tab tap go back to page 1", () => {
    expect(src).toMatch(/const onRail = [\s\S]*?setPage\(1\)[\s\S]*?\};/);
    // Page 1 goes through the drops pager's own handler, `front-drops-pages.test.tsx`.
    expect(src).toMatch(/onClick=\{\(\) => \{\s*setTab\("latest"\);\s*onDropsPage\(1\);/);
    expect(src).toMatch(/onClick=\{\(\) => \{\s*setTab\("live"\);\s*onDropsPage\(1\);/);
  });

  it("the live tab has no pages", () => {
    expect(src).toMatch(/tab === "latest" \? \(?\s*<Pager/);
  });
});
