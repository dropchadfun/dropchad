/**
 * The profile's two tabs: `drops` and
 * `received` in the look of `latest` and `live` on the front page, `drops` open first, the count
 * next to each (`50+` at the api's cap), 10 rows a page with the front page's page numbers. The
 * rows, the tiles and the empty lines stay as they are. Rendered with `react-dom/server`, so the
 * first paint: the `drops` tab on page 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findChain } from "@dropchad/chains";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProfileLists } from "@/components/profile/ProfileLists";
import { tabCount } from "@/components/profile/profile-tabs";
import type { OwnDropCard, ReceivedItem, UserPage } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const SOLANA = findChain("solana-devnet")?.chainId ?? 0;

const sender = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "sample chad",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
  streams: [],
} as unknown as ReceivedItem["sender"];

const own = (n: number): OwnDropCard => ({
  address: `OwnDrop${String(n).padStart(37, "1")}`,
  chainId: SOLANA,
  asset: "11111111111111111111111111111111",
  token: null,
  title: `drop ${String(n)}`,
  state: "active",
  mode: "handle",
  totalEntitlementsWei: "100000000",
  leafCount: 2,
  paidCount: 1,
  failedIndexes: [],
  createTxHash: "5Rn383Wc",
  activateTxHash: "67kNjoxu",
  lastTxHash: "5D847vwi",
  fundingDeadline: "1790838985",
  createdAt: "2026-10-03T07:16:25.000Z",
  creator: sender,
});

const got = (n: number): ReceivedItem => ({
  address: `GotDrop${String(n).padStart(37, "1")}`,
  chainKey: "solana-devnet",
  title: `gift ${String(n)}`,
  createdAt: "2026-10-12T10:00:00.000Z",
  amount: "100000000",
  token: null,
  sender,
});

const received = (count: number): UserPage["received"] => ({
  available: true,
  items: Array.from({ length: count }, (_, i) => got(i + 1)),
});

const view = (drops: number, recv: UserPage["received"] = received(3)) =>
  renderToStaticMarkup(
    <ProfileLists drops={Array.from({ length: drops }, (_, i) => own(i + 1))} received={recv} />,
  );

/** Each tab button: whether it is pressed, its word and its count. */
const tabs = (html: string) =>
  [
    ...html.matchAll(
      /<button type="button" aria-pressed="(true|false)"[^>]*>(drops|received)(?:<span class="([^"]*)">([^<]*)<\/span>)?<\/button>/g,
    ),
  ].map((m) => ({ pressed: m[1] === "true", word: m[2], countCls: m[3] ?? "", count: m[4] }));

describe("the count next to each tab", () => {
  it("the rows the api sent, 50+ at its cap of 50", () => {
    expect(tabCount(0)).toBe("0");
    expect(tabCount(7)).toBe("7");
    expect(tabCount(49)).toBe("49");
    expect(tabCount(50)).toBe("50+");
  });
});

describe("the two tabs", () => {
  it("drops and received, drops open first, the front page tab look", () => {
    const html = view(23);
    expect(tabs(html).map((t) => [t.word, t.pressed])).toEqual([
      ["drops", true],
      ["received", false],
    ]);
    expect(html).toMatch(/role="group" aria-label="profile lists"/);
  });

  it("the count next to each word, in the accent like live", () => {
    const [drops, recv] = tabs(view(23));
    expect(drops).toMatchObject({ count: "23" });
    expect(recv).toMatchObject({ count: "3" });
    for (const t of [drops, recv]) {
      expect(t?.countCls).toContain("text-chad-accent");
      expect(t?.countCls).toContain("num");
    }
    expect(tabs(view(50))[0]?.count).toBe("50+");
  });

  it("received has no count while its chain cannot be read", () => {
    const [, recv] = tabs(view(3, { available: false }));
    expect(recv?.count).toBeUndefined();
  });

  it("10 rows a page, the front page's page numbers under it", () => {
    const html = view(23);
    expect(html.match(/class="row drop-row/g)).toHaveLength(10);
    expect(html).toContain(`href="/d/${own(1).address}"`);
    expect(html).not.toContain("drop 11<");
    const nav = /<nav aria-label="pages"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect([...nav.matchAll(/>(\d+|last)<\/button>/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    expect(nav).toMatch(/aria-current="page"[^>]*>1</);
    // Only the open tab's rows: no received row on the drops tab.
    expect(html).not.toContain("received-row group");
  });

  it("10 rows or fewer: no page numbers", () => {
    const html = view(10);
    expect(html.match(/class="row drop-row/g)).toHaveLength(10);
    expect(html).not.toContain('aria-label="pages"');
  });

  it("an empty drops tab keeps its line", () => {
    const html = view(0);
    expect(html).toContain("no drops yet.");
    expect(tabs(html)[0]?.count).toBe("0");
  });
});

describe("the page numbers are the front page's own", () => {
  it("one Pager, shared by the front page and the profile", () => {
    expect(read("components/front/FrontPage.tsx")).not.toMatch(/function Pager\(/);
    expect(read("components/front/FrontPage.tsx")).toContain(
      'import { Pager } from "@/components/site/Pager";',
    );
    expect(read("components/profile/ProfileLists.tsx")).toContain(
      'import { Pager } from "@/components/site/Pager";',
    );
  });

  it("the profile page shows the tabs under the tiles, no fourth tile", () => {
    const page = read("app/u/[handle]/page.tsx");
    expect(page).toContain("<ProfileLists drops={user.drops} received={user.received} />");
    expect(page).not.toContain('<Section title="received">');
    expect(page.match(/<Stat\b/g)).toHaveLength(3);
  });
});
