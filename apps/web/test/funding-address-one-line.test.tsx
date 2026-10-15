/**
 * The funding card's drop address on one line.
 *
 * First try, `caa1f62`: a smaller size from the screen width, `(100vw - 64px) / 26.9`, the two
 * halves kept. On a real iPhone in Safari it still wrapped into the two halves: the test had 8px
 * spare at 390 and the iOS mono font is wider.: the size comes from the width of the
 * box the address sits in, a container query, `100cqi / 29`, room for 44 letters at up to 0.66
 * of the size each; one unbroken line, `nowrap`, never cut or shortened; no halves on the card.
 * 14px at most, so a computer keeps `body`.
 *
 * Also here: `a plain transfer is enough, nothing to sign, no wallet to connect` once. The api's
 * first warning says it on `/create` step 3, so the card's own line drops that sentence when the
 * warnings are shown.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import type { Funding } from "@/lib/api";

const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
/** The api's three lines, `apps/api/src/drops/payment.ts`. */
const API_WARNINGS = [
  "Send 0.2125 SOL on Solana Devnet to the address above. Less than this and the drop does not " +
    "start. A plain transfer is enough. There is nothing to sign and no wallet to connect.",
  "Check the address character by character before you send. If you send more, the extra goes " +
    "back to your refund address at the end.",
  `Your refund address is ${DROP}. Unclaimed funds are sent there after the claim deadline.`,
];
const CSS = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");

function render(warnings?: string[]): string {
  return renderToStaticMarkup(
    <FundingCard
      address={DROP}
      chainId={103}
      amountWei="210000000"
      feeWei="2500000"
      grossWei="212500000"
      paymentUri={`solana:${DROP}?amount=0.2125`}
      {...(warnings === undefined ? {} : { warnings })}
    />,
  );
}

function renderToken(): string {
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
  return renderToStaticMarkup(
    <FundingCardFrom funding={funding} amountWei="2100000000" feeWei="0" />,
  );
}

function count(html: string, text: string): number {
  return html.toLowerCase().split(text).length - 1;
}

/** The whole address as one text node in its fit box, never split into halves. */
function expectOneLine(html: string) {
  expect(html).toContain(
    `<div class="funding-address-box mt-1"><p class="funding-address type-body font-mono">${DROP}</p></div>`,
  );
  expect(html).not.toContain(`<span class="inline-block whitespace-nowrap">${DROP.slice(0, 22)}`);
}

describe("the funding card's drop address, one line", () => {
  it("a SOL drop: the whole address, one unbroken line in its fit box", () => {
    expectOneLine(render());
  });

  it("a token drop: the same", () => {
    expectOneLine(renderToken());
  });

  it("the size follows the box: 100cqi / 29, at most 14px, nowrap", () => {
    expect(CSS).toMatch(/\.funding-address-box \{\s*container-type: inline-size;\s*\}/);
    const rule =
      /\.funding-address \{\s*font-size: min\(14px, calc\(100cqi \/ ([\d.]+)\)\);\s*white-space: nowrap;\s*\}/.exec(
        CSS,
      );
    expect(rule).not.toBeNull();
    const divisor = Number(rule?.[1]);
    // 44 letters fit while a letter is at most divisor / 44 of the size: 0.66 with 29, 10% over
    // the 0.6 of SF Mono and Menlo (not measured on a phone).
    expect(divisor / 44).toBeGreaterThanOrEqual(0.65);
    // At 360 the box is 296px (360 - 64): still readable.
    expect(296 / divisor).toBeGreaterThanOrEqual(10);
  });

  it("no screen width rule and no md rule left from the first try", () => {
    expect(CSS).not.toMatch(/\.funding-address \{\s*font-size: clamp/);
    expect(CSS).not.toMatch(/min-width: 768px\) \{\s*\.funding-address/);
  });

  it("on a phone the address column takes the full card width", () => {
    expect(render()).toContain('class="min-w-0 flex-1 self-stretch md:self-auto"');
  });
});

describe("the plain transfer sentence, once", () => {
  it("with the api warnings, it shows once", () => {
    const html = render(API_WARNINGS);
    expect(count(html, "a plain transfer is enough")).toBe(1);
    expect(html).toContain("the drop starts");
  });

  it("without warnings (the drop page), the card's own line still says it once", () => {
    const html = render();
    expect(count(html, "a plain transfer is enough")).toBe(1);
    expect(html).toContain("nothing to sign, no wallet to connect.");
    expect(html).toContain("the drop starts");
  });
});
