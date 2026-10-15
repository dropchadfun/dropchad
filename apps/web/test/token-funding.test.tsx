/**
 * the funding card (,
 * ). The drop page builds the card from `ours.data.funding`, the same
 * object the create answer sent, for every drop, SOL drops too: never from `grossRequiredWei`,
 * which on a token drop is the token total (`DropPage.tsx` read it as SOL). A token drop has two
 * parts, both to the drop address: the tokens, with the vault address, and the SOL, the fee and
 * the receivers' token accounts, each with its own Solana Pay link.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DropPage } from "@/components/drops/DropPage";
import { fundingParts } from "@/components/drops/funding";
import type { DropDetail, Funding, Profile, TokenInfo } from "@/lib/api";

const SOLANA = 103;
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const VAULT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const BONK: TokenInfo = {
  mint: MINT,
  symbol: "BONK",
  name: "Bonk",
  decimals: 5,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
};

/** A SOL drop's funding, as `fundingInstructions` sends it. */
const SOL_FUNDING: Funding = {
  family: "svm",
  address: DROP,
  chainId: SOLANA,
  asset: "native",
  symbol: "SOL",
  decimals: 9,
  amountBaseUnits: "12500000001",
  amountDisplay: "12.500000001",
  paymentUri: `solana:${DROP}?amount=12.500000001`,
  fundingDeadline: "1790838985",
  amountWei: "12500000001",
  amountEth: "12.500000001",
};

/** A token drop: 1,000 BONK, and 0.0525 SOL for the fee and the token accounts. */
const TOKEN_FUNDING: Funding = {
  ...SOL_FUNDING,
  amountBaseUnits: "52500000",
  amountDisplay: "0.0525",
  paymentUri: `solana:${DROP}?amount=0.0525`,
  amountWei: "52500000",
  amountEth: "0.0525",
  token: {
    mint: MINT,
    vault: VAULT,
    tokenProgram: BONK.tokenProgram,
    name: "Bonk",
    symbol: "BONK",
    decimals: 5,
    amountBaseUnits: "100000000",
    amountDisplay: "1000",
    paymentUri: `solana:${DROP}?amount=1000&spl-token=${MINT}`,
  },
};

const creator = {
  xUserId: "1000000000000000001",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: null,
  kind: "kol",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

/** A Solana handle drop waiting for money. `funding: undefined` is an api before 4f. */
function created(options: {
  token: TokenInfo | null;
  funding: Funding | null | undefined;
  total: string;
  gross: string;
}): DropDetail {
  return {
    address: DROP,
    chain: {
      source: "rpc",
      available: true,
      indexed: true,
      data: {
        drop: {
          address: DROP,
          chainId: SOLANA,
          status: "Created",
          totalEntitlements: options.total,
          leafCount: 2,
          claimedCount: 0,
          createdAt: "1790838985",
        },
        claims: [],
        events: [],
      },
    },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        address: DROP,
        chainId: SOLANA,
        chainKey: "solana-devnet",
        asset: options.token?.mint ?? "11111111111111111111111111111111",
        token: options.token,
        ...(options.funding === undefined ? {} : { funding: options.funding }),
        title: null,
        memeImageUrl: null,
        state: "created",
        mode: "handle",
        totalEntitlementsWei: options.total,
        grossRequiredWei: options.gross,
        feeAmountWei: "0",
        leafCount: 2,
        paidCount: 0,
        failedIndexes: [],
        createTxHash: "5Rn383Wc",
        activateTxHash: null,
        lastTxHash: null,
        refundRecipient: "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH",
        merkleRoot: "0x00",
        manifestUrl: "",
        lastError: null,
        fundingDeadline: "1790838985",
        createdAt: "2026-10-03T07:16:25.000Z",
        creator,
        yours: true,
        fed: [],
      },
    },
  } as unknown as DropDetail;
}

describe("the parts of a funding answer", () => {
  it("a SOL drop: one part, the whole amount, its own link", () => {
    expect(fundingParts(SOL_FUNDING)).toEqual([
      {
        kind: "native",
        amountBaseUnits: "12500000001",
        decimals: 9,
        symbol: "SOL",
        paymentUri: `solana:${DROP}?amount=12.500000001`,
      },
    ]);
  });

  it("a token drop: the tokens first, then the SOL, each with its own Solana Pay link", () => {
    expect(fundingParts(TOKEN_FUNDING)).toEqual([
      {
        kind: "token",
        amountBaseUnits: "100000000",
        decimals: 5,
        symbol: "BONK",
        paymentUri: `solana:${DROP}?amount=1000&spl-token=${MINT}`,
      },
      {
        kind: "native",
        amountBaseUnits: "52500000",
        decimals: 9,
        symbol: "SOL",
        paymentUri: `solana:${DROP}?amount=0.0525`,
      },
    ]);
  });

  it("a token with no ticker: the word tokens", () => {
    const parts = fundingParts({
      ...TOKEN_FUNDING,
      token: { ...TOKEN_FUNDING.token!, symbol: null },
    });
    expect(parts[0]?.symbol).toBe("tokens");
  });
});

describe("the drop page funding card, from ours.data.funding", () => {
  it("a SOL drop: send this amount is the funding amount, not grossRequiredWei", () => {
    const html = renderToStaticMarkup(
      <DropPage
        initial={created({ token: null, funding: SOL_FUNDING, total: "1", gross: "999" })}
      />,
    );
    expect(html).toContain("send this amount");
    expect(html).toContain(">12.500000001<");
    expect(html).not.toContain("0.000000999");
  });

  it("a token drop: two parts, the tokens with the vault, then the SOL", () => {
    const html = renderToStaticMarkup(
      <DropPage
        initial={created({
          token: BONK,
          funding: TOKEN_FUNDING,
          total: "100000000",
          gross: "100000000",
        })}
      />,
    );
    expect(html).toContain("send the tokens");
    expect(html).toContain(">1000<");
    expect(html).toContain(">BONK<");
    expect(html).toContain("send the SOL");
    expect(html).toContain(">0.0525<");
    // Only the drop address since, never the vault.
    expect(html).not.toContain(VAULT);
    // The drop address, in its two even halves since the funding card fix.
    expect(html).toContain(DROP.slice(0, 22));
    expect(html).toContain(DROP.slice(22));
    // The drop waits for both parts.
    expect(html).toContain("both");
    // The token total read as lamports, the old bug: 100,000,000 lamports is 0.1 SOL.
    expect(html).not.toContain(">0.1<");
    expect(html).not.toMatch(/>0\.1 ?<span[^>]*>SOL</);
  });

  it("the tokens part comes before the SOL part", () => {
    const html = renderToStaticMarkup(
      <DropPage
        initial={created({
          token: BONK,
          funding: TOKEN_FUNDING,
          total: "100000000",
          gross: "100000000",
        })}
      />,
    );
    expect(html.indexOf("send the tokens")).toBeLessThan(html.indexOf("send the SOL"));
  });

  it("a token drop with no funding answer: an honest line, never the token total as SOL", () => {
    for (const funding of [null, undefined]) {
      const html = renderToStaticMarkup(
        <DropPage
          initial={created({ token: BONK, funding, total: "100000000", gross: "100000000" })}
        />,
      );
      expect(html).toContain("the funding details cannot load right now");
      expect(html).not.toContain("send this amount");
      expect(html).not.toContain(">0.1<");
    }
  });

  it("a SOL drop from an api before 4f: the old card from grossRequiredWei, as before", () => {
    const html = renderToStaticMarkup(
      <DropPage
        initial={created({
          token: null,
          funding: undefined,
          total: "1",
          gross: "12500000001",
        })}
      />,
    );
    expect(html).toContain("send this amount");
    expect(html).toContain(">12.500000001<");
  });
});
