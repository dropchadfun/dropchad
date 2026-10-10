/**
 * The small after the live test screenshots
 * 1. the token address 's asset row wraps evenly on the phone: two equal halves that
 *    never break inside, so no character is ever alone on the last line; one line on desktop;
 * 2. the token funding card has no `people get` line, it repeated the big amount above it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { assetHalves } from "@/components/create/token";
import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import type { Funding } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";

describe("1. the asset address wraps evenly", () => {
  it("two halves, equal, or the first one longer by one", () => {
    expect(assetHalves(MINT)).toEqual([MINT.slice(0, 22), MINT.slice(22)]);
    expect(assetHalves("abcdefghi")).toEqual(["abcde", "fghi"]);
    expect(assetHalves("ab")).toEqual(["a", "b"]);
  });

  it("the row draws each half unbroken, never break-all", () => {
    const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(page).toContain("assetHalves(view.tokenCheck.mint)");
    expect(page).not.toContain(
      '<p className="type-body font-mono break-all">{view.tokenCheck.mint}</p>',
    );
    expect(page).toMatch(/className="inline-block whitespace-nowrap"/);
  });
});

describe("2. the token funding card has no people get line", () => {
  const funding: Funding = {
    family: "svm",
    address: DROP,
    chainId: 103,
    asset: "native",
    symbol: "SOL",
    decimals: 9,
    amountBaseUnits: "143000000",
    amountDisplay: "0.143",
    paymentUri: `solana:${DROP}?amount=0.143`,
    fundingDeadline: "1",
    amountWei: "143000000",
    amountEth: "0.143",
    token: {
      mint: MINT,
      vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      name: null,
      symbol: "SBONK",
      decimals: 5,
      amountBaseUnits: "2100000000",
      amountDisplay: "21000",
      paymentUri: `solana:${DROP}?amount=21000&spl-token=${MINT}`,
    },
  };

  it("token card: the big amount only, the chain line stays", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={funding} amountWei="2100000000" feeWei="0" />,
    );
    expect(html).not.toContain("people get");
    expect(html).not.toContain("21,000 SBONK");
    expect(html).toContain(">21000<");
    expect(html).toContain(">chain<");
  });

  it("the SOL card keeps its people get line", () => {
    const html = renderToStaticMarkup(
      <FundingCard
        address={DROP}
        chainId={103}
        amountWei="210000000"
        feeWei="2500000"
        grossWei="212500000"
        paymentUri={`solana:${DROP}?amount=0.2125`}
      />,
    );
    expect(html).toContain(">people get<");
  });
});
