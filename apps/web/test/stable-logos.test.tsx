/**
 * The stable tokens look real .
 * The logo comes only from the quick token list, by chain and exact address: the `stable`
 * buttons, the card under them (with the full address), the funding card and the claim page.
 * A pasted look alike never gets it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StableButtons, TokenBox, TokenCard } from "@/components/create/TokenBox";
import { ClaimView } from "@/components/drops/ClaimView";
import type { ClaimItem } from "@/components/drops/claim";
import { FundingCardFrom } from "@/components/drops/FundingCard";
import { QuickTokenLogo } from "@/components/site/QuickTokenLogo";
import type { Funding, TokenCheck } from "@/lib/api";
import { chainPills } from "@/lib/chains";

const DEVNET = 103;
const MAINNET = 101;
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const FAKE = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const pills = chainPills();
const solana = pills.find((pill) => pill.key === "solana");
const robinhood = pills.find((pill) => pill.key === "robinhood");

/** The token check as the api sends it for devnet USDC, our name and logo filled in. */
const USDC_CHECK: TokenCheck = {
  mint: DEVNET_USDC,
  tokenProgram: TOKEN_PROGRAM,
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  logoUrl: "/tokens/usdc.png",
  launchpad: null,
  ok: true,
  reason: null,
};

describe("the list in the pills carries the name and the logo", () => {
  it("solana devnet USDC and robinhood tUSDC both use the USDC logo", () => {
    expect(solana?.quickTokens[0]).toMatchObject({ name: "USD Coin", logo: "/tokens/usdc.png" });
    expect(robinhood?.quickTokens[0]).toMatchObject({
      symbol: "tUSDC",
      name: "Test USDC",
      logo: "/tokens/usdc.png",
    });
  });
});

describe("the stable buttons", () => {
  it("the logo, 20px round, left of the ticker", () => {
    const html = renderToStaticMarkup(
      <StableButtons tokens={solana?.quickTokens ?? []} mintText="" onPick={() => undefined} />,
    );
    const button = html.match(/<button[^>]*>.*?<\/button>/)?.[0] ?? "";
    expect(button).toMatch(/<img[^>]*src="\/tokens\/usdc.png"/);
    expect(button).toMatch(/<img[^>]*width="20"/);
    expect(button).toContain("rounded-full");
    expect(button.indexOf("<img")).toBeLessThan(button.indexOf("USDC<"));
  });

  it("tUSDC: the USDC logo, the ticker stays tUSDC", () => {
    const html = renderToStaticMarkup(
      <StableButtons tokens={robinhood?.quickTokens ?? []} mintText="" onPick={() => undefined} />,
    );
    expect(html).toContain('src="/tokens/usdc.png"');
    expect(html).toContain(">tUSDC<");
  });
});

describe("the card under the stable buttons", () => {
  it("the logo, our name, and the full address in mono with copy", () => {
    const html = renderToStaticMarkup(
      <TokenBox
        coin="SOL"
        asset="stable"
        mintText={DEVNET_USDC}
        check={USDC_CHECK}
        error={null}
        quickTokens={solana?.quickTokens ?? []}
        onAsset={() => undefined}
        onMintText={() => undefined}
      />,
    );
    expect(html).toContain("USD Coin");
    expect(html).toMatch(/<img[^>]*src="\/tokens\/usdc.png"[^>]*width="40"/);
    expect(html).toMatch(new RegExp(`font-mono[^"]*"[^>]*>${DEVNET_USDC}<`));
    expect(html).not.toContain("4zMM…ncDU");
    expect(html).toContain(">copy<");
  });

  it("the full address may wrap: break-all, no nowrap", () => {
    const html = renderToStaticMarkup(<TokenCard check={USDC_CHECK} fullAddress />);
    const line = html.match(new RegExp(`<span[^>]*>${DEVNET_USDC}</span>`))?.[0] ?? "";
    expect(line).toContain("break-all");
    expect(line).not.toContain("whitespace-nowrap");
  });

  it("a pasted token under token keeps the short address", () => {
    const html = renderToStaticMarkup(<TokenCard check={{ ...USDC_CHECK, mint: FAKE }} />);
    expect(html).toContain("DezX…B263");
    expect(html).not.toContain(`>${FAKE}<`);
  });
});

describe("QuickTokenLogo, by chain and exact address only", () => {
  it("devnet USDC on devnet: the logo", () => {
    const html = renderToStaticMarkup(
      <QuickTokenLogo chainId={DEVNET} mint={DEVNET_USDC} size={20} />,
    );
    expect(html).toContain('src="/tokens/usdc.png"');
  });

  it("a look alike, or the right address on another chain: nothing", () => {
    expect(renderToStaticMarkup(<QuickTokenLogo chainId={DEVNET} mint={FAKE} size={20} />)).toBe(
      "",
    );
    expect(
      renderToStaticMarkup(<QuickTokenLogo chainId={MAINNET} mint={DEVNET_USDC} size={20} />),
    ).toBe("");
  });
});

describe("after create", () => {
  const funding = (mint: string, symbol: string): Funding => ({
    family: "svm",
    address: DROP,
    chainId: DEVNET,
    asset: "native",
    symbol: "SOL",
    decimals: 9,
    amountBaseUnits: "52500000",
    amountDisplay: "0.0525",
    paymentUri: `solana:${DROP}?amount=0.0525`,
    fundingDeadline: "1790838985",
    amountWei: "52500000",
    amountEth: "0.0525",
    token: {
      mint,
      vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      tokenProgram: TOKEN_PROGRAM,
      name: "USD Coin",
      symbol,
      decimals: 6,
      amountBaseUnits: "3000000",
      amountDisplay: "3",
      paymentUri: `solana:${DROP}?amount=3&spl-token=${mint}`,
    },
  });

  it("the funding card: the logo and USDC by the token amount", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={funding(DEVNET_USDC, "USDC")} amountWei="3000000" feeWei="0" />,
    );
    expect(html).toContain('src="/tokens/usdc.png"');
    expect(html).toContain(">USDC<");
    expect(html).not.toContain(">tokens<");
  });

  it("the funding card for a look alike called USDC: no logo of ours", () => {
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={funding(FAKE, "USDC")} amountWei="3000000" feeWei="0" />,
    );
    expect(html).not.toContain("/tokens/usdc.png");
  });

  const claim = (mint: string): ClaimItem => ({
    drop: DROP,
    chainKey: "solana-devnet",
    chainId: DEVNET,
    title: null,
    sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
    amount: "3000000",
    symbol: "USDC",
    decimals: 6,
    index: 0,
    claimDeadline: "1791806400",
    state: "claimable",
    recipient: null,
    claimTxHash: null,
    token: {
      mint,
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM,
      logoUrl: "/tokens/usdc.png",
    },
  });

  const view = (item: ClaimItem, selected: string | null) =>
    renderToStaticMarkup(
      <ClaimView
        session={{ handle: "alice" }}
        claims={[item]}
        freshLoginSecondsLeft={600}
        selected={selected}
      />,
    );

  it("the claim list: 20px logo left of the amount", () => {
    const html = view(claim(DEVNET_USDC), null);
    expect(html).toMatch(/<img[^>]*src="\/tokens\/usdc.png"[^>]*width="20"/);
    expect(html.indexOf('src="/tokens/usdc.png"')).toBeLessThan(html.indexOf("3 USDC"));
  });

  it("one claim: 24px logo by the amount", () => {
    const html = view(claim(DEVNET_USDC), DROP);
    expect(html).toMatch(/<img[^>]*src="\/tokens\/usdc.png"[^>]*width="24"/);
  });

  it("a claim of a look alike: no logo of ours", () => {
    expect(view(claim(FAKE), null)).not.toContain("/tokens/usdc.png");
  });
});
