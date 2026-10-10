/**
 * the web for Robinhood token drops (and
 * 12):
 * - the token box on Robinhood only when the api sends Robinhood `tokenFeeTiers`, so it stays
 *   hidden until `DropFactoryV3` is deployed; `ETH` or `token`; a `0x` address, checked with
 *   `?chain=robinhood`
 * - step 2's fee tile `≈ 0.00123 ETH` big from the api's `wei`, `$3` under it, no SOL grey line
 * - the funding card in two parts, the tokens then the ETH fee, both to the drop address, each
 *   with its QR, `copy amount` and `open in wallet`; `open in wallet` on Solana too
 * - the token row's `explorer ↗` opens the explorer's `/token/` page
 * - `no ETH price right now.`
 * - a token logo whose 404 came back before React listened shows the letter, not a broken image
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenBox } from "@/components/create/TokenBox";
import { explain } from "@/components/create/errors";
import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import { TOKEN_FEE_NOTE, aboutEth, mintOf, type TokenFeeTier } from "@/components/create/token";
import { FundingCardFrom } from "@/components/drops/FundingCard";
import { ApiError, getTokenCheck, type Funding, type TokenCheck } from "@/lib/api";
import { chainPills } from "@/lib/chains";
import { logoFailedEarly, tokenPageLink } from "@/lib/token";

const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;
const bothOn = { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true };

const ROBINHOOD_TESTNET = 46630;
const TEST = "0x7e57000000000000000000000000000000007E57";
const DROP = "0x00000000000000000000000000000000000d0000";

/** Robinhood tiers as `/api/chains` sends them once V3 is on: `wei`. */
const ETH_TIERS = [
  { upTo: 5, usd: "3", wei: "1230000000000000" },
  { upTo: 20, usd: "8", wei: "3270000000000000" },
  { upTo: 500, usd: "40", wei: "16330000000000000" },
] as const;

const TEST_COIN: TokenCheck = {
  mint: TEST,
  tokenProgram: "erc20",
  name: "Test Coin",
  symbol: "TEST",
  decimals: 18,
  logoUrl: null,
  launchpad: null,
  ok: true,
  reason: null,
};

/** Drop mode, both chains on, Robinhood picked. */
function robinhood(...actions: Parameters<typeof reduceForm>[1][]): FormState {
  return [{ type: "chain", key: "robinhood" } as const, ...actions].reduce(
    reduceForm,
    reduceForm(initialForm(pills), { type: "handleModes", value: bothOn }),
  );
}

const withTest = (...more: Parameters<typeof reduceForm>[1][]) =>
  robinhood(
    { type: "asset", value: "token" },
    { type: "mintText", value: ` ${TEST} ` },
    { type: "tokenCheck", result: { forMint: TEST, check: TEST_COIN } },
    ...more,
  );

const view = (state: FormState, tiers: readonly TokenFeeTier[] | null = ETH_TIERS) =>
  viewOf(state, pills, 100, 0n, null, tiers);

describe("the token box on Robinhood", () => {
  it("hidden while the api sends no Robinhood tiers: V3 is not deployed, the drop is ETH", () => {
    const v = view(robinhood({ type: "asset", value: "token" }), null);
    expect(v.tokenBox).toBe(false);
    expect(v.tokenChosen).toBe(false);
    expect(v.symbol).toBe("ETH");
    expect(v.asset).toBe("native");
    expect(view(robinhood(), []).tokenBox).toBe(false);
  });

  it("shown once the api sends Robinhood tiers, ETH by default", () => {
    const v = view(robinhood());
    expect(v.tokenBox).toBe(true);
    expect(v.tokenChosen).toBe(false);
    expect(v.symbol).toBe("ETH");
  });

  it("multisend: still no box", () => {
    expect(view(robinhood({ type: "mode", mode: "multisend" })).tokenBox).toBe(false);
  });

  it("a Robinhood token address is 0x and 40 hex characters, trimmed; base58 is not", () => {
    expect(mintOf(` ${TEST}\n`, "evm")).toBe(TEST);
    expect(mintOf("0x7e57", "evm")).toBeNull();
    expect(mintOf("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "evm")).toBeNull();
    // Solana as before.
    expect(mintOf(TEST)).toBeNull();
  });

  it("a checked token: its ticker and decimals, the address is what is sent", () => {
    const v = view(withTest({ type: "handleText", value: "@a 1.5\n@b 2" }));
    expect(v.tokenOk).toBe(true);
    expect(v.symbol).toBe("TEST");
    expect(v.decimals).toBe(18);
    expect(v.asset).toBe(TEST);
    expect(v.totalText).toBe("3.5 TEST");
  });

  it("the box says ETH or token, ETH first and pressed", () => {
    const html = renderToStaticMarkup(
      <TokenBox
        coin="ETH"
        asset="native"
        mintText=""
        check={null}
        error={null}
        quickTokens={[]}
        onAsset={() => undefined}
        onMintText={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="ETH or a token"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>ETH</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>token</);
  });
});

describe("the token check asks the right chain", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("?chain=robinhood for a Robinhood address, ?chain=solana as before", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(new Response(JSON.stringify(TEST_COIN), { status: 200 }));
      }),
    );
    await getTokenCheck(TEST, "robinhood");
    await getTokenCheck("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(urls[0]).toContain(`/api/tokens/${TEST}?chain=robinhood`);
    expect(urls[1]).toContain("?chain=solana");
  });
});

describe("step 2, the fee in usd, paid in ETH", () => {
  it("`≈ 0.00123 ETH` big from the api's wei, `$3` under it", () => {
    const v = view(withTest({ type: "handleText", value: "@a 1\n@b 1" }));
    expect(v.feeLabel).toBe("fee");
    expect(v.feeBig).toBe("≈ 0.00123 ETH");
    expect(v.feeSmall).toBe("$3");
  });

  it("the next tier for 6 people", () => {
    const six = Array.from({ length: 6 }, (_, i) => `@p${String(i)} 1`).join("\n");
    expect(view(withTest({ type: "handleText", value: six })).feeBig).toBe("≈ 0.00327 ETH");
  });

  it("the ETH number is shown as the api sent it, never rounded by the page", () => {
    expect(aboutEth("1230000000000000")).toBe("≈ 0.00123 ETH");
    expect(aboutEth("50000000000000000")).toBe("≈ 0.05 ETH");
    expect(aboutEth("10000000000000")).toBe("≈ 0.00001 ETH");
  });

  it("no grey line about token accounts on Robinhood; Solana keeps it", () => {
    expect(view(withTest()).tokenFeeNote).toBeNull();
    const solana = reduceForm(
      reduceForm(initialForm(pills), { type: "handleModes", value: bothOn }),
      { type: "asset", value: "token" },
    );
    expect(view(solana, null).tokenFeeNote).toBe(TOKEN_FEE_NOTE);
  });

  it("no price: `no ETH price right now.` on a Robinhood token drop", () => {
    const error = new ApiError(503, "price_unavailable", { error: "price_unavailable" });
    expect(explain(error, { decimals: 18, token: true, coin: "ETH" })).toBe(
      "no ETH price right now. try again in a minute.",
    );
    expect(explain(error, { decimals: 5, token: true })).toBe(
      "no SOL price right now. try again in a minute.",
    );
  });
});

/** A Robinhood token drop's funding, as the EVM `fundingInstructions` sends it. */
const ETH_TOKEN_FUNDING: Funding = {
  family: "evm",
  address: DROP,
  chainId: ROBINHOOD_TESTNET,
  asset: "native",
  symbol: "ETH",
  decimals: 18,
  amountBaseUnits: "1230000000000000",
  amountDisplay: "0.00123",
  paymentUri: `ethereum:${DROP}@46630?value=1230000000000000`,
  fundingDeadline: "1790838985",
  amountWei: "1230000000000000",
  amountEth: "0.00123",
  token: {
    mint: TEST,
    vault: DROP,
    tokenProgram: "erc20",
    name: "Test Coin",
    symbol: "TEST",
    decimals: 18,
    amountBaseUnits: "1000000000000000000000",
    amountDisplay: "1000",
    paymentUri: `ethereum:${TEST}@46630/transfer?address=${DROP}&uint256=1000000000000000000000`,
  },
};

const card = (funding: Funding) =>
  renderToStaticMarkup(<FundingCardFrom funding={funding} amountWei="0" feeWei="0" />);

describe("the Robinhood token funding card", () => {
  it("two parts: the tokens, then the ETH for the fee", () => {
    const html = card(ETH_TOKEN_FUNDING);
    expect(html).toContain("1. send the tokens");
    expect(html).toContain("2. send the ETH");
    expect(html).toContain("for the fee.");
    expect(html).not.toContain("token accounts");
    expect(html).not.toContain("SOL");
    expect(html.indexOf("1. send the tokens")).toBeLessThan(html.indexOf("2. send the ETH"));
  });

  it("each part has its own wallet link, the drop address once for both", () => {
    const html = card(ETH_TOKEN_FUNDING).replaceAll("&amp;", "&");
    expect(html).toContain(`href="${ETH_TOKEN_FUNDING.token?.paymentUri ?? ""}"`);
    expect(html).toContain(`href="${ETH_TOKEN_FUNDING.paymentUri}"`);
    expect(html.match(/open in wallet/g)).toHaveLength(2);
    expect(html.match(/copy amount/g)).toHaveLength(2);
    expect(html).toContain("send both to this address.");
  });

  it("Solana's token card gets open in wallet too, with its Solana Pay links", () => {
    const solDrop = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const html = card({
      ...ETH_TOKEN_FUNDING,
      family: "svm",
      address: solDrop,
      chainId: 103,
      symbol: "SOL",
      decimals: 9,
      amountBaseUnits: "52500000",
      paymentUri: `solana:${solDrop}?amount=0.0525`,
      token: {
        ...(ETH_TOKEN_FUNDING.token as NonNullable<Funding["token"]>),
        mint,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        decimals: 5,
        amountBaseUnits: "100000000",
        paymentUri: `solana:${solDrop}?amount=1000&spl-token=${mint}`,
      },
    }).replaceAll("&amp;", "&");
    expect(html).toContain("2. send the SOL");
    expect(html).toContain("for the fee and the token accounts.");
    expect(html.match(/open in wallet/g)).toHaveLength(2);
    expect(html).toContain(`href="solana:${solDrop}?amount=1000&spl-token=${mint}"`);
  });
});

describe("the token row's explorer link on Robinhood", () => {
  it("the token page of the Robinhood testnet explorer, /token/", () => {
    expect(tokenPageLink(TEST, ROBINHOOD_TESTNET, true)).toEqual({
      href: `https://explorer.testnet.chain.robinhood.com/token/${TEST}`,
      label: "explorer ↗",
    });
  });

  it("the explorer on Robinhood mainnet too, never dexscreener's Solana page", () => {
    expect(tokenPageLink(TEST, 4663, false)).toEqual({
      href: `https://robinhoodchain.blockscout.com/token/${TEST}`,
      label: "explorer ↗",
    });
  });
});

describe("a logo that failed before the page was ready", () => {
  // Robinhood tokens never have a logo: the route answers 404, sometimes before React has
  // attached `onError`. Then the image is done loading with no picture, and the letter shows.
  it("done loading with no picture: failed", () => {
    expect(logoFailedEarly({ complete: true, naturalWidth: 0 })).toBe(true);
  });

  it("still loading, or a real picture: not failed", () => {
    expect(logoFailedEarly({ complete: false, naturalWidth: 0 })).toBe(false);
    expect(logoFailedEarly({ complete: true, naturalWidth: 192 })).toBe(false);
  });
});
