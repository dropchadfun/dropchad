/**
 * `pay with wallet` on the funding card, phones only. On a phone: a third button with the same link as
 * the QR, the funding answer's `paymentUri`, and one grey line under its row. On a computer, and
 * in the server rendered page, no button and no line. The QR, `copy address` and `copy amount`
 * always stay. `phone` stands in for the browser's own `(pointer: coarse)` read.
 *
 * The words: the button says what its link pays and where,
 * `pay 1.01 SOL to …pY3o`, so the sender can match it in the wallet. The amount is the one in the
 * link and in `copy amount`, every decimal, no comma; then the symbol; then the last 4 of the
 * address, as written.
 *
 * no wallet menu, no wallet page, no auto
 * start. A tap opens the wallet at once. On Solana the same link as the QR; on Robinhood
 * MetaMask's send link, the EIP 681 link with `ethereum:` swapped for
 * `https://link.metamask.io/send/`. The grey line says which app opens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import * as funding from "@/components/drops/funding";
import {
  metamaskSendLink,
  noWalletLine,
  payButtonShows,
  payLabel,
} from "@/components/drops/funding";
import type { Funding } from "@/lib/api";

const SOL_LINE =
  "opens your default wallet app. no wallet opened? scan the QR or copy the address.";
const EVM_LINE = "opens MetaMask. no wallet opened? scan the QR or copy the address.";
const MM = "https://link.metamask.io/send/";
const SRC = join(__dirname, "..", "src");

const SOL_DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const EVM_DROP = "0x00000000000000000000000000000000000d0000";
const TEST = "0x7e57000000000000000000000000000000007E57";

/** A SOL drop's funding, as the Solana `fundingInstructions` sends it. */
const SOL_FUNDING: Funding = {
  family: "svm",
  address: SOL_DROP,
  chainId: 103,
  asset: "native",
  symbol: "SOL",
  decimals: 9,
  amountBaseUnits: "125000000",
  amountDisplay: "0.125",
  paymentUri: `solana:${SOL_DROP}?amount=0.125`,
  fundingDeadline: "1790838985",
  amountWei: "125000000",
  amountEth: "0.125",
};

/** An ETH drop's funding on Robinhood testnet, EIP 681. */
const ETH_FUNDING: Funding = {
  family: "evm",
  address: EVM_DROP,
  chainId: 46630,
  asset: "native",
  symbol: "ETH",
  decimals: 18,
  amountBaseUnits: "120000000000000",
  amountDisplay: "0.00012",
  paymentUri: `ethereum:${EVM_DROP}@46630?value=120000000000000`,
  fundingDeadline: "1790838985",
  amountWei: "120000000000000",
  amountEth: "0.00012",
};

/** A Solana token drop: the tokens, then the SOL, two Solana Pay links. */
const SOL_TOKEN_FUNDING: Funding = {
  ...SOL_FUNDING,
  amountBaseUnits: "52500000",
  amountDisplay: "0.0525",
  paymentUri: `solana:${SOL_DROP}?amount=0.0525`,
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

/** A Robinhood token drop: the tokens, then the ETH fee, two EIP 681 links. */
const ETH_TOKEN_FUNDING: Funding = {
  ...ETH_FUNDING,
  amountBaseUnits: "1230000000000000",
  amountDisplay: "0.00123",
  paymentUri: `ethereum:${EVM_DROP}@46630?value=1230000000000000`,
  token: {
    mint: TEST,
    vault: EVM_DROP,
    tokenProgram: "erc20",
    name: "Test Coin",
    symbol: "TEST",
    decimals: 18,
    amountBaseUnits: "1000000000000000000000",
    amountDisplay: "1000",
    paymentUri: `ethereum:${TEST}@46630/transfer?address=${EVM_DROP}&uint256=1000000000000000000000`,
  },
};

const card = (funding: Funding, phone?: boolean) =>
  renderToStaticMarkup(
    <FundingCardFrom
      funding={funding}
      amountWei={funding.amountBaseUnits}
      feeWei="0"
      {...(phone === undefined ? {} : { phone })}
    />,
  ).replaceAll("&amp;", "&");

const count = (html: string, text: string) => html.split(text).length - 1;

describe("the phone check", () => {
  it("a coarse pointer is a phone: the button shows", () => {
    expect(payButtonShows({ coarsePointer: true })).toBe(true);
  });

  it("a fine pointer is a computer: no button", () => {
    expect(payButtonShows({ coarsePointer: false })).toBe(false);
  });
});

describe("the words on the button", () => {
  it("the owner's example: pay 1.01 SOL to …pY3o", () => {
    const address = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" + "pY3o";
    expect(payLabel({ amountBaseUnits: "1010000000", decimals: 9, symbol: "SOL", address })).toBe(
      "pay 1.01 SOL to …pY3o",
    );
  });

  it("a token part: the token amount and symbol, no comma, like the link", () => {
    const label = payLabel({
      amountBaseUnits: "100000000",
      decimals: 5,
      symbol: "PONS",
      address: SOL_DROP,
    });
    expect(label).toBe("pay 1000 PONS to …UE48");
    expect(label).not.toContain(",");
  });

  it("every decimal, never cut", () => {
    expect(
      payLabel({ amountBaseUnits: "12500000001", decimals: 9, symbol: "SOL", address: SOL_DROP }),
    ).toBe("pay 12.500000001 SOL to …UE48");
  });

  it("Robinhood: ETH from wei, the last 4 of the 0x address as written", () => {
    expect(
      payLabel({ amountBaseUnits: "120000000000000", decimals: 18, symbol: "ETH", address: TEST }),
    ).toBe("pay 0.00012 ETH to …7E57");
  });

  it("a token with no ticker says tokens", () => {
    expect(
      payLabel({ amountBaseUnits: "500", decimals: 0, symbol: "tokens", address: SOL_DROP }),
    ).toBe("pay 500 tokens to …UE48");
  });

  it("the same number as the Solana Pay link it opens", () => {
    for (const funding of [SOL_FUNDING, SOL_TOKEN_FUNDING]) {
      const part = funding.token ?? funding;
      const inLink = new URL(part.paymentUri.replace("solana:", "https://x/")).searchParams.get(
        "amount",
      );
      expect(
        payLabel({
          amountBaseUnits: part.amountBaseUnits,
          decimals: part.decimals,
          symbol: part.symbol ?? "tokens",
          address: funding.address,
        }),
      ).toBe(`pay ${inLink ?? ""} ${part.symbol ?? "tokens"} to …UE48`);
    }
  });
});

describe("the plain card on a phone", () => {
  it("Solana: pay with wallet opens the same solana: link as the QR", () => {
    const html = card(SOL_FUNDING, true);
    expect(count(html, "pay 0.125 SOL to …UE48")).toBe(1);
    expect(html).toContain(`href="${SOL_FUNDING.paymentUri}"`);
    expect(html).toContain(SOL_LINE);
    expect(html).not.toContain(EVM_LINE);
  });

  it("Robinhood: the button is MetaMask's send link, not the plain ethereum: link", () => {
    const html = card(ETH_FUNDING, true);
    expect(count(html, "pay 0.00012 ETH to …0000")).toBe(1);
    expect(html).toContain(`href="${MM}${EVM_DROP}@46630?value=120000000000000"`);
    expect(html).not.toContain(`href="${ETH_FUNDING.paymentUri}"`);
    expect(html).toContain(EVM_LINE);
    expect(html).not.toContain(SOL_LINE);
  });

  it("the third button, after copy address and copy amount, which stay", () => {
    const html = card(SOL_FUNDING, true);
    expect(html.indexOf("copy address")).toBeGreaterThan(-1);
    expect(html.indexOf("copy address")).toBeLessThan(html.indexOf("copy amount"));
    expect(html.indexOf("copy amount")).toBeLessThan(html.indexOf("pay 0.125 SOL to …UE48"));
  });

  it("a multisend card gets it too", () => {
    const html = renderToStaticMarkup(
      <FundingCard
        address={EVM_DROP}
        chainId={46630}
        amountWei="20000000000000"
        feeWei="100000000000000"
        grossWei="120000000000000"
        paymentUri={ETH_FUNDING.paymentUri}
        kind="multisend"
        phone
      />,
    );
    expect(count(html, "pay 0.00012 ETH to …0000")).toBe(1);
    expect(html.replaceAll("&amp;", "&")).toContain(
      `href="${MM}${EVM_DROP}@46630?value=120000000000000"`,
    );
    expect(html).toContain(EVM_LINE);
  });
});

describe("the token card on a phone", () => {
  it("Solana: one button per part, each its own Solana Pay link", () => {
    const html = card(SOL_TOKEN_FUNDING, true);
    expect(count(html, "pay 1000 BONK to …UE48")).toBe(1);
    expect(count(html, "pay 0.0525 SOL to …UE48")).toBe(1);
    expect(html).toContain(`href="${SOL_TOKEN_FUNDING.token?.paymentUri ?? ""}"`);
    expect(html).toContain(`href="${SOL_TOKEN_FUNDING.paymentUri}"`);
    expect(count(html, SOL_LINE)).toBe(2);
  });

  it("Robinhood: one button per part, each its own MetaMask send link, the token first", () => {
    const html = card(ETH_TOKEN_FUNDING, true);
    expect(count(html, "pay 1000 TEST to …0000")).toBe(1);
    expect(count(html, "pay 0.00123 ETH to …0000")).toBe(1);
    const token = `${MM}${TEST}@46630/transfer?address=${EVM_DROP}&uint256=1000000000000000000000`;
    const eth = `${MM}${EVM_DROP}@46630?value=1230000000000000`;
    expect(html).toContain(`href="${token}"`);
    expect(html).toContain(`href="${eth}"`);
    expect(html.indexOf(token)).toBeLessThan(html.indexOf(eth));
    expect(html).not.toMatch(/href="ethereum:/);
    expect(count(html, EVM_LINE)).toBe(2);
  });

  it("open in wallet and pay with wallet are gone from the buttons", () => {
    for (const funding of [SOL_TOKEN_FUNDING, ETH_TOKEN_FUNDING]) {
      expect(card(funding, true)).not.toContain("open in wallet");
      expect(card(funding, true)).not.toContain("pay with wallet");
    }
  });
});

describe("on a computer and in the server page: no button, no line", () => {
  const all = [SOL_FUNDING, ETH_FUNDING, SOL_TOKEN_FUNDING, ETH_TOKEN_FUNDING];

  it("a computer: no wallet link, the copy buttons stay", () => {
    for (const funding of all) {
      const html = card(funding, false);
      expect(html).not.toContain("pay with wallet");
      expect(html).not.toMatch(/pay [0-9]/);
      expect(html).not.toContain("open in wallet");
      expect(html).not.toContain("no wallet opened?");
      expect(html).not.toMatch(/href="(solana:|ethereum:|https:\/\/link\.metamask\.io)/);
      expect(html).toContain("copy amount");
      expect(html).toContain("copy address");
    }
  });

  it("the server rendered page, no phone known: no button", () => {
    for (const funding of all) {
      const html = card(funding);
      expect(html).not.toContain("pay with wallet");
      expect(html).not.toMatch(/pay [0-9]/);
      expect(html).not.toContain("open in wallet");
      expect(html).not.toContain("no wallet opened?");
      expect(html).not.toMatch(/href="(solana:|ethereum:|https:\/\/link\.metamask\.io)/);
    }
  });
});

describe("MetaMask's send link and the grey line", () => {
  it("ETH: link.metamask.io/send/<to>@<chainId>?value=<wei>", () => {
    expect(metamaskSendLink(ETH_FUNDING.paymentUri)).toBe(
      `${MM}${EVM_DROP}@46630?value=120000000000000`,
    );
  });

  it("a token: link.metamask.io/send/<token>@<chainId>/transfer?address=&uint256=", () => {
    expect(metamaskSendLink(ETH_TOKEN_FUNDING.token?.paymentUri ?? "")).toBe(
      `${MM}${TEST}@46630/transfer?address=${EVM_DROP}&uint256=1000000000000000000000`,
    );
  });

  it("the grey line says which app opens", () => {
    expect(noWalletLine("svm")).toBe(SOL_LINE);
    expect(noWalletLine("evm")).toBe(EVM_LINE);
  });
});

describe("no wallet menu, no wallet page, no auto start", () => {
  it("a phone: the button is a plain link, no menu, no named wallets", () => {
    for (const f of [SOL_FUNDING, ETH_FUNDING, SOL_TOKEN_FUNDING, ETH_TOKEN_FUNDING]) {
      const html = card(f, true);
      expect(html).not.toContain("<details");
      expect(html).not.toMatch(/>(Phantom|Solflare|Backpack|MetaMask|other wallet)</);
      expect(html).not.toMatch(/phantom\.com|solflare\.com|backpack\.app|metamask\.io\/dapp/);
      expect(html).not.toContain("data-pay-button");
    }
  });

  it("the menu, ?in= and the auto start are gone from the code", () => {
    for (const name of [
      "walletChoices",
      "walletPage",
      "walletAppLink",
      "inWalletFrom",
      "autoStartPayment",
      "autoStartLink",
    ]) {
      expect(name in funding).toBe(false);
    }
    const source = readFileSync(join(SRC, "components", "drops", "FundingCard.tsx"), "utf8");
    expect(source).not.toMatch(/location\.search|location\.assign|scrollIntoView|<details/);
  });
});
