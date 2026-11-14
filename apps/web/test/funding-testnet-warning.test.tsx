/**
 * The funding card warning: a mint
 * bordered box right above the amount to send, every time, the text exactly, only the
 * drop's own chain; a multisend says multisend. It replaces the old grey testnet line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import type { Funding } from "@/lib/api";

const SOLANA = 103;
const ROBINHOOD = 46630;
const EVM_DROP = "0x1111111111111111111111111111111111111111";
const SOL_DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function card(chainId: number, kind: "drop" | "multisend" = "drop"): string {
  const address = chainId === SOLANA ? SOL_DROP : EVM_DROP;
  return renderToStaticMarkup(
    <FundingCard
      address={address}
      chainId={chainId}
      amountWei="20000000000000"
      feeWei="100000000000000"
      grossWei="120000000000000"
      paymentUri={`pay:${address}`}
      kind={kind}
    />,
  );
}

const TOKEN_FUNDING: Funding = {
  family: "svm",
  address: SOL_DROP,
  chainId: SOLANA,
  asset: "native",
  symbol: "SOL",
  decimals: 9,
  amountBaseUnits: "52500000",
  amountDisplay: "0.0525",
  paymentUri: `solana:${SOL_DROP}?amount=0.0525`,
  fundingDeadline: "1790838985",
  amountWei: "52500000",
  amountEth: "0.0525",
  token: {
    mint: MINT,
    vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    name: "Bonk",
    symbol: "BONK",
    decimals: 5,
    amountBaseUnits: "100000000",
    amountDisplay: "1000",
    paymentUri: `solana:${SOL_DROP}?amount=1000&spl-token=${MINT}`,
  },
};

const TITLE = "almost there 🤌";
const LAST = "real coins sent here can not come back, so keep those for mainnet.";

describe("testnetWarningLines, the text exactly", () => {
  it("a Solana drop names solana devnet only", async () => {
    const { testnetWarningLines } = await import("@/components/drops/testnet-warning");
    expect(testnetWarningLines(SOLANA, "drop")).toEqual([
      TITLE,
      "this is a testnet drop, so fund it with test coins.",
      "quick check: set your wallet to solana devnet before you send.",
      LAST,
    ]);
  });

  it("a Robinhood drop names robinhood chain testnet only", async () => {
    const { testnetWarningLines } = await import("@/components/drops/testnet-warning");
    expect(testnetWarningLines(ROBINHOOD, "drop")).toEqual([
      TITLE,
      "this is a testnet drop, so fund it with test coins.",
      "quick check: set your wallet to robinhood chain testnet before you send.",
      LAST,
    ]);
  });

  it("a multisend says multisend in the second line", async () => {
    const { testnetWarningLines } = await import("@/components/drops/testnet-warning");
    expect(testnetWarningLines(ROBINHOOD, "multisend")[1]).toBe(
      "this is a testnet multisend, so fund it with test coins.",
    );
  });
});

// The site runs mainnet since the solana registry entry is live: the
// box shows only while `TESTNET_ONLY`, so no card has it now.
describe("the box on the card, a mainnet site", () => {
  it("Solana: no testnet box, send this amount stays", () => {
    const html = card(SOLANA);
    expect(html).not.toContain('data-testnet-warning=""');
    expect(html).not.toContain("set your wallet to solana devnet before you send.");
    expect(html.indexOf(TITLE)).toBe(-1);
    expect(html).toContain(">send this amount<");
  });

  it("Robinhood: no testnet box", () => {
    const html = card(ROBINHOOD);
    expect(html).not.toContain("set your wallet to robinhood chain testnet before you send.");
  });

  it("a multisend card: no testnet box", () => {
    const html = card(ROBINHOOD, "multisend");
    expect(html).not.toContain("this is a testnet multisend, so fund it with test coins.");
  });

  it("a token drop: no testnet box, 1. send the tokens stays", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={TOKEN_FUNDING} amountWei="0" feeWei="0" />,
    );
    expect(html).not.toContain("set your wallet to solana devnet before you send.");
    expect(html.indexOf(TITLE)).toBe(-1);
    expect(html).toContain(">1. send the tokens<");
  });

  it("the old grey testnet line is gone", () => {
    for (const html of [card(SOLANA), card(ROBINHOOD, "multisend")]) {
      expect(html).not.toContain("this is testnet money");
    }
  });
});
