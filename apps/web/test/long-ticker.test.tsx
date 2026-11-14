/**
 * A long ticker never breaks a box. The number is never cut. Up to 16 characters
 * the ticker shows in full, over 16 the first 15 and `…`, the full ticker in `title` and
 * `aria-label`. Boxes shrink with `FitNumber`; rows and cards stay one size and cut the ticker at
 * their edge.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FedProgress } from "@/components/drops/FedList";
import { payLabel } from "@/components/drops/funding";
import { barSymbol, type ShareCardData } from "@/components/drops/share-card";
import { FitNumber } from "@/components/site/FitNumber";
import { RowAmount, Ticker } from "@/components/site/Ticker";
import type { TokenInfo } from "@/lib/api";
import { tickerCut } from "@/lib/token";

const SRC = join(__dirname, "..", "src");
const MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";
const SIXTEEN = "SIXTEENCHARACTER";
const LONG = "AVERYVERYLONGTICKERNAME";

const TOKEN: TokenInfo = {
  mint: MINT,
  symbol: "AMERICANWOMEN",
  name: "American Women",
  decimals: 5,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
  launchpad: "pump.fun",
};

function source(...path: string[]): string {
  return readFileSync(join(SRC, ...path), "utf8");
}

describe("tickerCut", () => {
  it("up to 16 characters in full", () => {
    expect(tickerCut("SOL")).toBe("SOL");
    expect(tickerCut("AMERICANWOMEN")).toBe("AMERICANWOMEN");
    expect(SIXTEEN).toHaveLength(16);
    expect(tickerCut(SIXTEEN)).toBe(SIXTEEN);
  });

  it("over 16 the first 15 and …", () => {
    expect(tickerCut(`${SIXTEEN}X`)).toBe("SIXTEENCHARACTE…");
    expect(tickerCut(LONG)).toBe("AVERYVERYLONGTI…");
  });
});

describe("Ticker", () => {
  it("a normal ticker is plain, no title", () => {
    const html = renderToStaticMarkup(<Ticker symbol="TEST" />);
    expect(html).toBe("<span>TEST</span>");
  });

  it("a long ticker keeps its full text in title and aria-label", () => {
    const html = renderToStaticMarkup(<Ticker symbol={LONG} />);
    expect(html).toContain(">AVERYVERYLONGTI…<");
    expect(html).toContain(`title="${LONG}"`);
    expect(html).toContain(`aria-label="${LONG}"`);
  });

  it("at a row's edge it ends in … by css", () => {
    const html = renderToStaticMarkup(<Ticker symbol="AMERICANWOMEN" edge />);
    expect(html).toMatch(/class="[^"]*min-w-0[^"]*truncate/);
    expect(html).toContain('title="AMERICANWOMEN"');
  });
});

describe("rows: the number whole, the ticker cut", () => {
  it("RowAmount keeps the number from shrinking and cuts the ticker", () => {
    const html = renderToStaticMarkup(<RowAmount amount="100,000" symbol="AMERICANWOMEN" />);
    expect(html).toMatch(/<span class="shrink-0[^"]*">100,000<\/span>/);
    expect(html).toMatch(/class="[^"]*truncate[^"]*"[^>]*>AMERICANWOMEN</);
    expect(html).toContain('title="AMERICANWOMEN"');
  });

  it.each([
    ["drops", "DropRows.tsx"],
    ["drops", "FedList.tsx"],
    ["drops", "ClaimView.tsx"],
    ["profile", "ReceivedRows.tsx"],
    ["create", "CreateDrop.tsx"],
  ])("%s/%s uses RowAmount", (folder, file) => {
    expect(source("components", folder, file)).toContain("<RowAmount");
  });

  it.each([
    ["boards", "BoardRows.tsx"],
    ["drops", "TokenRow.tsx"],
    ["create", "TokenBox.tsx"],
    ["front", "Trending.tsx"],
  ])("%s/%s cuts the ticker with Ticker", (folder, file) => {
    expect(source("components", folder, file)).toMatch(/<Ticker[^>]*edge/);
  });
});

describe("boxes: the value and its ticker shrink together", () => {
  it("FitNumber measures a logo before the value", () => {
    const html = renderToStaticMarkup(
      <FitNumber value="100,000" logo={<i data-logo="" />} unit={<Ticker symbol="TEST" />} />,
    );
    expect(html).toMatch(/^<span class="block[^"]*"><i data-logo=""><\/i><span>100,000<\/span>/);
  });

  it("the drop page dropping part fits the box, the full ticker shown", () => {
    const html = renderToStaticMarkup(
      <FedProgress
        paidCount={0}
        leafCount={2}
        amountWei="10000000000"
        chainId={103}
        token={TOKEN}
        live
      />,
    );
    expect(html).toMatch(/class="block type-stat whitespace-nowrap[^"]*"/);
    expect(html).toContain("100,000");
    expect(html).toContain(">AMERICANWOMEN<");
    expect(html).toContain('title="AMERICANWOMEN"');
  });

  it.each([
    ["drops", "ClaimView.tsx"],
    ["drops", "FundingCard.tsx"],
    ["create", "CreateDrop.tsx"],
  ])("%s/%s puts the ticker in FitNumber", (folder, file) => {
    expect(source("components", folder, file)).toMatch(/unit=\{[^}]*<Ticker/);
  });
});

describe("the share card and the pay button", () => {
  const card = (symbol: string): ShareCardData => ({
    chainKey: "solana-devnet",
    symbol,
    decimals: 5,
    amount: "100000000",
    people: 1,
    sender: { handle: "samplechad", profileImageUrl: null },
    receivers: [],
    rest: 0,
    rank: null,
    token: { ...TOKEN, symbol },
  });

  it("the share card bar uses the 16 character cut", () => {
    expect(barSymbol(card("AMERICANWOMEN")).text).toBe("AMERICANWOMEN");
    expect(barSymbol(card(LONG)).text).toBe("AVERYVERYLONGTI…");
  });

  it("the pay button keeps the whole number and cuts the ticker over 16", () => {
    expect(payLabel({ amountBaseUnits: "100000", decimals: 0, symbol: LONG, address: MINT })).toBe(
      "pay 100000 AVERYVERYLONGTI… to …pump",
    );
  });
});
