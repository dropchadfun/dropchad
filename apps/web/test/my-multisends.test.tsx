/**
 * Your multisends
 * the signed in sender's own list at `/multisends`, and `your multisends` in the
 * account menu between `your drops` and `log out`. Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyMultisendList } from "@/components/drops/MyMultisends";
import { myMultisendRow, summaryLine } from "@/components/drops/multisend";
import { getMyMultisends, type MyMultisend } from "@/lib/api";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const A = "0x1111111111111111111111111111111111111111";
const B = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";

const evm: MyMultisend = {
  address: A,
  chainKey: "robinhood-testnet",
  title: null,
  asset: "0x0000000000000000000000000000000000000000",
  tokenSymbol: null,
  tokenDecimals: null,
  totalEntitlements: "50000000000000000",
  leafCount: 12,
  paidCount: 0,
  state: "created",
  createdAt: new Date(NOW - 3 * 60_000).toISOString(),
};
const sol: MyMultisend = {
  address: B,
  chainKey: "solana-devnet",
  title: "rent split",
  asset: "native",
  tokenSymbol: null,
  tokenDecimals: null,
  totalEntitlements: "120000000",
  leafCount: 12,
  paidCount: 7,
  state: "paying",
  createdAt: new Date(NOW - 60 * 60_000).toISOString(),
};

describe("getMyMultisends", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks GET /api/me/multisends and gives the rows", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ multisends: [sol] }), { status: 200 }),
        );
      }),
    );
    expect(await getMyMultisends()).toEqual({ multisends: [sol] });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/api/me/multisends");
  });
});

describe("one row", () => {
  it("links to /m/, the title, the grey line of the /m/ page, the chip and the progress", () => {
    const r = myMultisendRow(sol, NOW);
    expect(r.href).toBe(`/m/${B}`);
    expect(r.title).toBe("rent split");
    expect(r.line).toBe(
      summaryLine(
        {
          amountWei: "120000000",
          chainId: 103,
          receivers: 12,
          createdAt: Math.floor((NOW - 60 * 60_000) / 1000),
        },
        NOW,
      ),
    );
    expect(r.line).toContain("SOL to 12 wallets");
    expect(r.chip).toBe("LIVE");
    expect(r.progress).toBe("7 of 12 paid");
  });

  it("no title says multisend; a new one is FUNDING", () => {
    const r = myMultisendRow(evm, NOW);
    expect(r.title).toBe("multisend");
    expect(r.chip).toBe("FUNDING");
    expect(r.line).toContain("ETH to 12 wallets");
    expect(r.progress).toBe("0 of 12 paid");
  });
});

describe("the list as rendered", () => {
  it("the title, only you see this list, and one link per multisend, newest first", () => {
    const html = renderToStaticMarkup(<MyMultisendList rows={[evm, sol]} now={NOW} />);
    expect(html).toContain("your multisends");
    expect(html).toContain("only you see this list.");
    expect(html.indexOf(`href="/m/${A}"`)).toBeGreaterThan(-1);
    expect(html.indexOf(`href="/m/${B}"`)).toBeGreaterThan(html.indexOf(`href="/m/${A}"`));
    expect(html).toContain("rent split");
    expect(html).toContain("7 of 12 paid");
    expect(html).toContain("LIVE");
    expect(html).toContain("FUNDING");
  });

  it("none yet: the empty line and a quiet link to make one", () => {
    const html = renderToStaticMarkup(<MyMultisendList rows={[]} now={NOW} />);
    expect(html).toContain("no multisends yet.");
    expect(html).toContain('href="/create?mode=multisend"');
    expect(html).toContain("make a multisend");
    expect(html).not.toContain('aria-label="pages"');
  });
});

describe("10 rows a page", () => {
  /** `count` multisends, newest first, each its own address. */
  const many = (count: number): MyMultisend[] =>
    Array.from({ length: count }, (_, i) => ({
      ...evm,
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      title: `send ${String(i + 1)}`,
      createdAt: new Date(NOW - (i + 1) * 60_000).toISOString(),
    }));
  const page = (rows: MyMultisend[], on = 1) =>
    renderToStaticMarkup(<MyMultisendList rows={rows} now={NOW} page={on} onPick={() => {}} />);
  const links = (html: string) => [...html.matchAll(/href="\/m\/([^"]+)"/g)].map((m) => m[1]);
  const pager = (html: string) =>
    [
      ...(/<nav aria-label="pages"[^>]*>(.*?)<\/nav>/.exec(html)?.[1] ?? "").matchAll(
        /<button([^>]*)>([^<]*)<\/button>/g,
      ),
    ].map((m) => ((m[1] ?? "").includes('aria-current="page"') ? `[${m[2] ?? ""}]` : m[2]));

  it("the first 10, newest first, and the page numbers under them", () => {
    const rows = many(25);
    const html = page(rows);
    expect(links(html)).toEqual(rows.slice(0, 10).map((r) => r.address));
    expect(pager(html)).toEqual(["[1]", "2", "3"]);
    expect(html.indexOf('aria-label="pages"')).toBeGreaterThan(html.lastIndexOf('href="/m/'));
  });

  it("another page shows its own 10, the last page the rest", () => {
    const rows = many(25);
    expect(links(page(rows, 2))).toEqual(rows.slice(10, 20).map((r) => r.address));
    expect(links(page(rows, 3))).toEqual(rows.slice(20).map((r) => r.address));
    expect(pager(page(rows, 3))).toEqual(["1", "2", "[3]"]);
    // A page past the end is the last page, never empty.
    expect(links(page(rows, 9))).toEqual(rows.slice(20).map((r) => r.address));
  });

  it("the newest 100: the page numbers move with the page, 10 can be reached", () => {
    const rows = many(100);
    // The buttons only; a `…` between them is not one.
    expect(pager(page(rows))).toEqual(["[1]", "2", "10"]);
    expect(pager(page(rows, 10))).toEqual(["1", "9", "[10]"]);
    expect(pager(page(rows, 5))).toEqual(["1", "4", "[5]", "6", "10"]);
    expect(links(page(rows, 10))).toEqual(rows.slice(90).map((r) => r.address));
  });

  it("10 multisends or fewer: every row, no page numbers", () => {
    const rows = many(10);
    const html = page(rows);
    expect(links(html)).toHaveLength(10);
    expect(html).not.toContain('aria-label="pages"');
  });

  it("the rows themselves unchanged", () => {
    const html = page(many(12));
    expect(
      html.match(
        /class="row grid min-h-11 grid-cols-\[minmax\(0,1fr\)_auto\] items-center gap-3 px-2 py-2"/g,
      ),
    ).toHaveLength(10);
    expect(html).toContain('<ul class="type-table mt-6">');
  });

  it("the same Pager and paging as the front page and the profile tabs", () => {
    const list = readFileSync(
      join(__dirname, "..", "src", "components", "drops", "MyMultisends.tsx"),
      "utf8",
    );
    expect(list).toContain('import { Pager } from "@/components/site/Pager";');
    expect(list).toContain("latestPage(");
    expect(list).toContain("pageCount(");
  });
});

describe("the page and the menu", () => {
  const src = (...parts: string[]) => readFileSync(join(__dirname, "..", "src", ...parts), "utf8");

  it("/multisends is noindex and titled your multisends", async () => {
    const page = (await import("@/app/multisends/page")) as {
      metadata: { title: string; robots: { index: boolean; follow: boolean } };
    };
    expect(page.metadata.title).toBe("your multisends");
    expect(page.metadata.robots).toEqual({ index: false, follow: false });
  });

  it("signed out it asks to sign in with X, like /create", () => {
    const view = src("components", "drops", "MyMultisends.tsx");
    expect(view).toContain("sign in with X first.");
    expect(view).toContain('href="/api/auth/x/start"');
  });

  it("the account menu: your multisends between your drops and log out", () => {
    const header = src("components", "site", "Header.tsx");
    const drops = header.indexOf("your drops");
    const mine = header.indexOf('href="/multisends"');
    const out = header.indexOf("log out");
    expect(drops).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(drops);
    expect(out).toBeGreaterThan(mine);
    expect(header).toContain("your multisends");
  });
});
