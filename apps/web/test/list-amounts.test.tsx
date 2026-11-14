/**
 * Short amounts and short tickers in tight lists. The drop rows, the
 * received rows, the board rows and the claim page list show an amount of 1,000 or more in the
 * short form (`1.5K`, `250K`, `1M`, `2.5B`), under 1,000 as before; the ticker is cut at about
 * 8 characters. On desktop the tag pill's column is the whole space between the name and the
 * amount, the pill centred in it, one centre line on every row. The token logo in a
 * list amount is 20px. The drop page keeps the full amount.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import { DropRows } from "@/components/drops/DropRows";
import type { DropCardData } from "@/components/drops/drop-card-data";
import { ReceivedRows } from "@/components/profile/ReceivedRows";
import { ROW_LOGO, RowAmount } from "@/components/site/Ticker";
import type { BoardRow, Profile, ReceivedItem, TokenInfo } from "@/lib/api";
import { formatAmount, listAmount } from "@/lib/format";

const SRC = join(__dirname, "..", "src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

/** Whole coins to base units. */
const units = (whole: string, decimals: number): bigint => {
  const [int = "0", frac = ""] = whole.split(".");
  return BigInt(int + frac.padEnd(decimals, "0").slice(0, decimals));
};

const person: Profile = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: null,
  kind: "chad",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
};

describe("listAmount", () => {
  it("1,000 and up in the short form, for every number of decimals", () => {
    for (const d of [0, 5, 6, 9, 18]) {
      expect(listAmount(units("1000", d), d)).toBe("1K");
      expect(listAmount(units("1500", d), d)).toBe("1.5K");
      expect(listAmount(units("250000", d), d)).toBe("250K");
      expect(listAmount(units("1000000", d), d)).toBe("1M");
      expect(listAmount(units("2500000000", d), d)).toBe("2.5B");
      expect(listAmount(units("4000000000000", d), d)).toBe("4T");
    }
  });

  it("rounds down, never shows more than the amount", () => {
    expect(listAmount(units("1999", 9), 9)).toBe("1.9K");
    expect(listAmount(units("999999.99", 6), 6)).toBe("999.9K");
    expect(listAmount(units("1000.9", 18), 18)).toBe("1K");
  });

  it("under 1,000 exactly as before", () => {
    for (const [v, d] of [
      ["999", 9],
      ["999.9999", 18],
      ["0.0003", 18],
      ["12.34567", 9],
      ["0.25", 6],
      ["0.000000001", 9],
    ] as const) {
      expect(listAmount(units(v, d), d)).toBe(formatAmount(units(v, d), d));
    }
    expect(listAmount("0", 9)).toBe("0");
  });

  it("takes a string of base units", () => {
    expect(listAmount("1500000000000", 9)).toBe("1.5K");
  });
});

describe("RowAmount", () => {
  it("cuts the ticker at about 8 characters, the full one in title", () => {
    const html = renderToStaticMarkup(<RowAmount amount="1.5K" symbol="AMERICANWOMEN" />);
    expect(html).toContain("max-w-[8ch]");
    expect(html).not.toContain("max-w-[10ch]");
    expect(html).toContain('title="AMERICANWOMEN"');
  });
});

const card = (amountWei: string): DropCardData => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  title: "gm",
  creator: person,
  chip: "LIVE",
  amountWei,
  receivers: 3,
  claimed: 1,
  createdAt: 1_700_000_000,
});

describe("drop rows", () => {
  it("1,500 ETH shows 1.5K, 0.0003 ETH as before", () => {
    expect(
      renderToStaticMarkup(<DropRows rows={[card(units("1500", 18).toString())]} />),
    ).toContain(">1.5K<");
    expect(renderToStaticMarkup(<DropRows rows={[card("300000000000000")]} />)).toContain(
      ">0.0003<",
    );
  });

  it("on desktop the pill has its own column, centred, not after the name", () => {
    const html = renderToStaticMarkup(<DropRows rows={[card("300000000000000")]} />);
    expect(html).not.toContain("md:inline-flex");
    expect(html).toMatch(
      /<span class="hidden justify-self-center md:block"><span class="pill[^"]*"[^>]*>dev</,
    );
    // no spacer cell after the pill
    expect(html).not.toContain('<span class="hidden md:block" aria-hidden="true"></span>');
    // the name cuts with … before the pill column
    expect(html).toMatch(/class="block truncate font-medium text-chad-text">gm</);
  });

  it("the header and the grid: name 3fr, pill 1fr at least 96px, then the amount", () => {
    const html = renderToStaticMarkup(<DropRows rows={[card("1")]} />);
    const header = html.slice(0, html.indexOf("</div>"));
    expect(header.match(/<span/g)).toHaveLength(8);
    expect(read("app/globals.css")).toContain(
      "grid-template-columns: minmax(0, 3fr) minmax(96px, 1fr) 128px 88px 80px 72px 84px 16px;",
    );
  });

  it("the token logo is 20px", () => {
    const html = renderToStaticMarkup(
      <DropRows rows={[{ ...card(units("250000", 6).toString()), token: TOKEN }]} />,
    );
    expect(html).toContain('width="20" height="20"');
    expect(html).not.toMatch(/<img[^>]*width="16"/);
  });
});

const TOKEN: TokenInfo = {
  mint: "0x00000000000000000000000000000000000000a1",
  symbol: "AMERICANWOMEN",
  name: "Pons",
  decimals: 6,
  tokenProgram: "erc20",
  logoUrl: "/api/tokens/0x00000000000000000000000000000000000000a1/logo?chain=robinhood",
  launchpad: null,
};

describe("the list token logo", () => {
  it("is one size, 20px, in every list", () => {
    expect(ROW_LOGO).toBe(20);
    for (const f of [
      "drops/DropRows.tsx",
      "profile/ReceivedRows.tsx",
      "boards/BoardRows.tsx",
      "drops/ClaimView.tsx",
    ]) {
      const src = read(`components/${f}`);
      expect(src, f).toContain("size={ROW_LOGO}");
      expect(src, f).not.toMatch(/Logo[^>]*size=\{(16|20)\}/);
    }
  });
});

const receivedItem = (amount: string): ReceivedItem => ({
  address: "0x0000000000000000000000000000000000000701",
  chainKey: "robinhood-testnet",
  title: "gm drop",
  createdAt: "2026-10-11T10:00:00.000Z",
  amount,
  token: TOKEN,
  sender: { ...person, streams: [] },
});

describe("received rows", () => {
  it("250,000 of a token shows 250K, the ticker cut at 8 characters", () => {
    const html = renderToStaticMarkup(
      <ReceivedRows
        received={{ available: true, items: [receivedItem(units("250000", 6).toString())] }}
      />,
    );
    expect(html).toContain(">250K<");
    expect(html).toContain("max-w-[8ch]");
  });

  it("on desktop the pill has its own column, centred, not after the title", () => {
    const html = renderToStaticMarkup(
      <ReceivedRows received={{ available: true, items: [receivedItem("1")] }} />,
    );
    expect(html).not.toContain("md:inline-flex");
    expect(html).toMatch(
      /<span class="hidden justify-self-center md:block"><span class="pill[^"]*"[^>]*>dev</,
    );
    expect(html).toContain('width="20" height="20"');
    const header = html.slice(0, html.indexOf("</div>"));
    expect(header.match(/<span/g)).toHaveLength(5);
    expect(read("app/globals.css")).toContain(
      "grid-template-columns: minmax(0, 3fr) minmax(96px, 1fr) 128px 72px 16px;",
    );
  });
});

const boardRow = (totalWei: string): BoardRow => ({
  rank: 1,
  profile: person,
  totalWei,
  dropCount: 1,
  claimCount: 1,
  uniqueReceivers: 3,
  biggestDropWei: totalWei,
  lastDropAt: 1_700_000_000,
  usd: 12400,
  byChain: [
    { chainKey: "solana-devnet", totalWei, dropCount: 1 },
  ] as unknown as BoardRow["byChain"],
});

describe("board rows", () => {
  it("a coin total of 1,000,000 shows 1M", () => {
    const html = renderToStaticMarkup(
      <BoardRows
        rows={[boardRow(units("1000000", 9).toString())]}
        rankedBy="totalWei"
        board="dropper"
        testnetOnly={false}
      />,
    );
    expect(html).toMatch(/>1M <span/);
  });

  it("usd stays as before", () => {
    const html = renderToStaticMarkup(
      <BoardRows rows={[boardRow("1")]} rankedBy="usd" board="fed" testnetOnly={false} />,
    );
    expect(html).toContain("$12,400");
  });

  it("the best token ticker is cut at 8 characters", () => {
    expect(read("components/boards/BoardRows.tsx")).toContain('edge className="max-w-[8ch]"');
  });
});

describe("the claim page list and the drop page", () => {
  it("the claim list rows use listAmount, the claim detail keeps the full amount", () => {
    const src = read("components/drops/ClaimView.tsx");
    expect(src).toContain("amount={listAmount(item.amount, item.decimals)}");
    expect(src).toContain("value={formatAmount(item.amount, item.decimals)}");
  });

  it("the drop page keeps the full amount", () => {
    expect(read("components/drops/FedList.tsx")).not.toContain("listAmount");
    expect(read("components/drops/DropPage.tsx")).not.toContain("listAmount");
  });
});
