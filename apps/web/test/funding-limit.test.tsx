/**
 * Create and fund, item 5: the funding limit on every
 * funding card, `/create`, `/d/` and `/m/`, native and token. One grey `small` line: `fund it by
 * 15 oct, 12:00 UTC. if not, the drop is called off and anything you sent goes back to your
 * refund address.`, the day, month, hour and minute of the api's `fundingDeadline` (unix seconds)
 * in UTC. Never the length since: an older drop has 7 days, a new one 24 hours. A
 * multisend says `the multisend is called off`. After the deadline the worker cancels and
 * sends what arrived to the refund address, on both chains (`apps/api/src/worker/worker.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import { fundingLimitLine } from "@/components/drops/funding";
import type { Funding } from "@/lib/api";

const SRC = join(import.meta.dirname, "..", "src");
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** 12:00 UTC. */
const OCT_15 = "1792065600";
/** 00:30 UTC. */
const NOV_1 = "1793493000";

const LINE_DROP =
  "fund it by 15\u00a0oct, 12:00\u00a0UTC. if not, the drop is called off and anything you " +
  "sent goes back to your refund address.";
const LINE_MULTI =
  "fund it by 15\u00a0oct, 12:00\u00a0UTC. if not, the multisend is called off and anything " +
  "you sent goes back to your refund address.";

const SOL_FUNDING: Funding = {
  family: "svm",
  address: DROP,
  chainId: 103,
  asset: "native",
  symbol: "SOL",
  decimals: 9,
  amountBaseUnits: "12500000001",
  amountDisplay: "12.500000001",
  paymentUri: `solana:${DROP}?amount=12.500000001`,
  fundingDeadline: OCT_15,
  amountWei: "12500000001",
  amountEth: "12.500000001",
};

const TOKEN_FUNDING: Funding = {
  ...SOL_FUNDING,
  amountBaseUnits: "52500000",
  amountDisplay: "0.0525",
  paymentUri: `solana:${DROP}?amount=0.0525`,
  token: {
    mint: MINT,
    vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    name: "Bonk",
    symbol: "BONK",
    decimals: 5,
    amountBaseUnits: "100000000",
    amountDisplay: "1000",
    paymentUri: `solana:${DROP}?amount=1000&spl-token=${MINT}`,
  },
};

function native(kind: "drop" | "multisend", fundingDeadline?: string): string {
  return renderToStaticMarkup(
    <FundingCard
      address={DROP}
      chainId={103}
      amountWei="12000000000"
      feeWei="500000001"
      grossWei="12500000001"
      paymentUri={`solana:${DROP}?amount=12.500000001`}
      kind={kind}
      {...(fundingDeadline === undefined ? {} : { fundingDeadline })}
    />,
  );
}

/** The line as React writes it: the no-break space as itself, inside one grey small line. */
const grey = (line: string) =>
  new RegExp(`type-small[^"]*text-chad-text-dim[^>]*>${line.replace(/\./g, "\\.")}<`);

describe("item 5: the words", () => {
  it("a drop: fund it by the day, month and hour in UTC", () => {
    expect(fundingLimitLine(OCT_15, "drop")).toBe(LINE_DROP);
  });

  it("a multisend: the multisend is called off", () => {
    expect(fundingLimitLine(OCT_15, "multisend")).toBe(LINE_MULTI);
  });

  it("the hour and minute in UTC, two digits, never the year", () => {
    expect(fundingLimitLine(NOV_1, "drop")).toContain("by 1\u00a0nov, 00:30\u00a0UTC.");
    expect(fundingLimitLine(NOV_1, "drop")).not.toContain("2026");
  });

  it("never the length: an older drop has 7 days, a new one 24 hours", () => {
    for (const deadline of [OCT_15, NOV_1]) {
      const line = fundingLimitLine(deadline, "drop") ?? "";
      expect(line).not.toContain("within");
      expect(line).not.toMatch(/\d+ (days|hours)/);
    }
  });

  it("no number, no line", () => {
    expect(fundingLimitLine("", "drop")).toBeNull();
    expect(fundingLimitLine("soon", "drop")).toBeNull();
    expect(fundingLimitLine("0", "drop")).toBeNull();
  });
});

describe("item 5: on every funding card", () => {
  it("the native card, a drop", () => {
    expect(native("drop", OCT_15)).toMatch(grey(LINE_DROP));
  });

  it("the native card, a multisend", () => {
    expect(native("multisend", OCT_15)).toMatch(grey(LINE_MULTI));
  });

  it("the native card without a deadline has no line", () => {
    expect(native("drop")).not.toContain("fund it by");
  });

  it("the card from a funding answer, a SOL drop", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={SOL_FUNDING} amountWei="12000000000" feeWei="500000001" />,
    );
    expect(html).toMatch(grey(LINE_DROP));
  });

  it("the card from a funding answer, a multisend", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom
        funding={SOL_FUNDING}
        amountWei="12000000000"
        feeWei="500000001"
        kind="multisend"
      />,
    );
    expect(html).toMatch(grey(LINE_MULTI));
  });

  it("the token card", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={TOKEN_FUNDING} amountWei="100000000" feeWei="0" />,
    );
    expect(html).toMatch(grey(LINE_DROP));
  });
});

describe("item 5: /d/ and /m/ pass the deadline to the plain card", () => {
  it("DropPage, the card from our row", () => {
    const page = readFileSync(join(SRC, "components", "drops", "DropPage.tsx"), "utf8");
    expect(page).toMatch(/<FundingCard\s[\s\S]{0,400}fundingDeadline=\{ours\.fundingDeadline\}/);
  });

  it("MultisendView", () => {
    const page = readFileSync(join(SRC, "components", "drops", "MultisendView.tsx"), "utf8");
    expect(page).toMatch(/<FundingCard\s[\s\S]{0,400}fundingDeadline=\{ours\.fundingDeadline\}/);
  });
});
