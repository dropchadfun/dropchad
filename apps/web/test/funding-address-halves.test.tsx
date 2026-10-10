/**
 * The drop address on the funding card wraps evenly: the same two unbroken
 * halves as step 2's asset row, `assetHalves`, for token and SOL drops both, so on the phone no
 * character is ever alone on the last line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { assetHalves } from "@/components/create/token";
import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import type { Funding } from "@/lib/api";

const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const [FIRST, SECOND] = assetHalves(DROP);

/** The address as two unbroken halves, and never as one breakable block. */
function expectHalves(html: string) {
  expect(html).toContain(`<span class="inline-block whitespace-nowrap">${FIRST}</span>`);
  expect(html).toContain(`<span class="inline-block whitespace-nowrap">${SECOND}</span>`);
  expect(html).not.toContain(`font-mono break-all">${DROP}<`);
}

describe("the funding card's drop address, two even halves", () => {
  it("a SOL drop", () => {
    expectHalves(
      renderToStaticMarkup(
        <FundingCard
          address={DROP}
          chainId={103}
          amountWei="210000000"
          feeWei="2500000"
          grossWei="212500000"
          paymentUri={`solana:${DROP}?amount=0.2125`}
        />,
      ),
    );
  });

  it("a token drop", () => {
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
    expectHalves(
      renderToStaticMarkup(<FundingCardFrom funding={funding} amountWei="2100000000" feeWei="0" />),
    );
  });
});
