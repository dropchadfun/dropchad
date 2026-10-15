/**
 * Pages on the front page `latest` tab: 10 rows a page,
 * page numbers `1 2 3 4` and `last` under the list, the current page marked. A tap shows those
 * 10 drops in place. 10 drops or fewer: no page numbers. A rail tap or a tab change goes back to
 * page 1. The `live` tab has no pages. The server reads the newest 50, so 5 pages at most.
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
import type { DropListEntry } from "@/lib/api";

const SRC = join(__dirname, "..", "src");

const card = (n: number): DropCardData => ({
  address: `0x${n.toString(16).padStart(40, "0")}`,
  chainId: 46630,
  title: null,
  imageUrl: null,
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
    memeImageUrl: null,
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

const frontWith = (count: number) =>
  renderToStaticMarkup(
    <FrontPage
      pills={[]}
      stats={null}
      drops={Array.from({ length: count }, (_, i) => entry(i + 1))}
      board={null}
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

  it("up to 4 pages: only the numbers", () => {
    expect(pagerItems(3, 2)).toEqual([
      { page: 1, label: "1", current: false },
      { page: 2, label: "2", current: true },
      { page: 3, label: "3", current: false },
    ]);
  });

  it("5 pages: 1 2 3 4 and last, last is page 5 and marked when on it", () => {
    expect(pagerItems(5, 1).map((i) => i.label)).toEqual(["1", "2", "3", "4", "last"]);
    expect(pagerItems(5, 1).find((i) => i.current)?.label).toBe("1");
    expect(pagerItems(5, 5).at(-1)).toEqual({ page: 5, label: "last", current: true });
    expect(pagerItems(5, 5).filter((i) => i.current)).toHaveLength(1);
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

  it("50 drops: 1 2 3 4 last, page 1 marked", () => {
    const nav = pager(frontWith(50)) ?? "";
    const labels = [...nav.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(["1", "2", "3", "4", "last"]);
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
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
    expect(src).toMatch(/onClick=\{\(\) => \{\s*setTab\("latest"\);\s*setPage\(1\);/);
    expect(src).toMatch(/onClick=\{\(\) => \{\s*setTab\("live"\);\s*setPage\(1\);/);
  });

  it("the live tab has no pages", () => {
    expect(src).toMatch(/tab === "latest" \? <Pager/);
  });
});
