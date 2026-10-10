/**
 * the web shows tokens right. The api names the token on every
 * answer since 4f: one `token` object, `null` on a SOL or ETH drop. The web
 * shows a token drop's amounts in the token's ticker and decimals (the short mint with no
 * ticker), its logo with a letter fallback, `best token` rows without usd, the token logo
 * in the share card bar with the chain's mark small, and no more `tokens are not counted yet.`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardBlock } from "@/components/boards/BoardBlock";
import { BoardRows, usdAndDrops } from "@/components/boards/BoardRows";
import { DropPage } from "@/components/drops/DropPage";
import { DropRows } from "@/components/drops/DropRows";
import { fromListEntry, fromOwnCard } from "@/components/drops/drop-card-data";
import { dropLines, linesOfCard } from "@/components/drops/drop-lines";
import { barMark, postText, type ShareCardData } from "@/components/drops/share-card";
import { TokenLogo } from "@/components/site/TokenLogo";
import type {
  Board,
  BoardRow,
  DropDetail,
  DropListEntry,
  OwnDropCard,
  Profile,
  TokenInfo,
} from "@/lib/api";
import { dropUnit, tokenLetter } from "@/lib/token";

const SOLANA = 103;
const ROBINHOOD = 46630;
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";

/** A token with a ticker and a logo link, as the api sends it. 1,000 BONK is 100,000,000 units. */
const BONK: TokenInfo = {
  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  symbol: "BONK",
  name: "Bonk",
  decimals: 5,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  logoUrl: "/api/tokens/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/logo?chain=solana",
};

/** Devnet USDC: no ticker, no name. */
const NO_TICKER: TokenInfo = {
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  symbol: null,
  name: null,
  decimals: 6,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  logoUrl: "/api/tokens/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU/logo?chain=solana",
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

function own(token: TokenInfo | null | undefined, patch: Partial<OwnDropCard> = {}): OwnDropCard {
  return {
    address: DROP,
    chainId: SOLANA,
    asset: token?.mint ?? "11111111111111111111111111111111",
    ...(token === undefined ? {} : { token }),
    title: null,
    memeImageUrl: null,
    state: "active",
    mode: "handle",
    totalEntitlementsWei: "100000000",
    leafCount: 2,
    paidCount: 1,
    failedIndexes: [],
    createTxHash: "5Rn383Wc",
    activateTxHash: "67kNjoxu",
    lastTxHash: "5D847vwi",
    fundingDeadline: "1790838985",
    createdAt: "2026-10-03T07:16:25.000Z",
    creator,
    ...patch,
  };
}

/** Ignores ticker-free words like `Solana`: the coin's own ticker, standing alone. */
const SOL_TICKER = /\bSOL\b/;

describe("the unit of a drop", () => {
  it("a SOL or ETH drop keeps the chain's coin", () => {
    expect(dropUnit(SOLANA, null)).toEqual({ symbol: "SOL", decimals: 9 });
    expect(dropUnit(ROBINHOOD, null)).toEqual({ symbol: "ETH", decimals: 18 });
    expect(dropUnit(SOLANA, undefined)).toEqual({ symbol: "SOL", decimals: 9 });
  });

  it("a token drop is in its token", () => {
    expect(dropUnit(SOLANA, BONK)).toEqual({ symbol: "BONK", decimals: 5 });
  });

  it("no ticker: the word tokens, never the short mint", () => {
    expect(dropUnit(SOLANA, NO_TICKER)).toEqual({ symbol: "tokens", decimals: 6 });
  });

  it("the letter fallback: the ticker's first letter, else the mint's", () => {
    expect(tokenLetter(BONK)).toBe("B");
    expect(tokenLetter({ ...BONK, symbol: "wif" })).toBe("W");
    expect(tokenLetter(NO_TICKER)).toBe("4");
  });
});

describe("the token logo", () => {
  it("our own logo route, never a stranger's link", () => {
    const html = renderToStaticMarkup(<TokenLogo token={BONK} size={16} />);
    expect(html).toContain(`src="${BONK.logoUrl}"`);
    expect(html).toContain('width="16"');
    expect(html).toContain('alt=""');
  });
});

describe("drop rows", () => {
  it("our card and the list entry carry the token; an old answer has none", () => {
    expect(fromOwnCard(own(BONK)).token).toEqual(BONK);
    expect(fromOwnCard(own(null)).token).toBeNull();
    expect(fromOwnCard(own(undefined)).token).toBeNull();
    const entry = {
      address: DROP,
      chainId: SOLANA,
      status: "Active",
      totalEntitlements: "100000000",
      leafCount: 2,
      claimedCount: 1,
      createdAt: "1790838985",
      dropchad: own(BONK),
    } as unknown as DropListEntry;
    expect(fromListEntry(entry).token).toEqual(BONK);
    expect(fromListEntry({ ...entry, dropchad: null }).token).toBeNull();
  });

  it("no title: `BONK drop`, or the short mint", () => {
    expect(linesOfCard(fromOwnCard(own(BONK))).first).toBe("BONK drop");
    expect(linesOfCard(fromOwnCard(own(NO_TICKER))).first).toBe("token drop");
    expect(linesOfCard(fromOwnCard(own(null))).first).toBe("SOL drop");
  });

  it("the amount in the token with its logo, never SOL", () => {
    const html = renderToStaticMarkup(<DropRows rows={[fromOwnCard(own(BONK))]} />);
    expect(html).toContain("1,000");
    expect(html).toContain(">BONK<");
    expect(html).toContain(`src="${BONK.logoUrl}"`);
    expect(html).not.toMatch(SOL_TICKER);
  });

  it("a SOL drop is unchanged: SOL, no token logo", () => {
    const html = renderToStaticMarkup(
      <DropRows rows={[fromOwnCard(own(null, { totalEntitlementsWei: "3000000" }))]} />,
    );
    expect(html).toContain("0.003");
    expect(html).toContain(">SOL<");
    expect(html).not.toContain("/api/tokens/");
  });
});

describe("the drop page", () => {
  it("the headline speaks the token", () => {
    expect(
      dropLines({
        title: null,
        handle: "samplechad",
        amountWei: "100000000",
        chainId: SOLANA,
        token: BONK,
        createdAt: null,
        finished: false,
      }).first,
    ).toBe("samplechad is dropping 1,000 $BONK"); // the ticker with a dollar sign
  });

  function detail(state: "active" | "finished"): DropDetail {
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
            status: "Active",
            totalEntitlements: "100000000",
            leafCount: 2,
            claimedCount: 1,
            createdAt: "1790838985",
          },
          claims: [
            {
              index: 0,
              recipient: null,
              amount: "50000000",
              transactionHash: null,
              finality: "final",
            },
          ],
          events: [],
        },
      },
      ours: {
        source: "dropchad_api",
        known: true,
        data: {
          ...own(BONK, { state }),
          yours: false,
          chainKey: "solana-devnet",
          grossRequiredWei: "100000000",
          feeAmountWei: "0",
          refundRecipient: "6Bqo",
          merkleRoot: "0x00",
          manifestUrl: "",
          lastError: null,
          funding: null,
          fed: [{ index: 0, handle: "dropchadfun", profileImageUrl: null }],
        },
      },
    } as unknown as DropDetail;
  }

  for (const state of ["active", "finished"] as const) {
    it(`${state}: the total and each payout in BONK with its logo, never SOL`, () => {
      const html = renderToStaticMarkup(<DropPage initial={detail(state)} />);
      expect(html).toContain("1,000");
      expect(html).toContain("500");
      expect(html).toContain("BONK");
      expect(html).toContain(`src="${BONK.logoUrl}"`);
      expect(html).not.toMatch(SOL_TICKER);
    });
  }
});

describe("best token rows", () => {
  const row = {
    rank: 1,
    profile: creator,
    totalWei: "0",
    dropCount: 3,
    uniqueReceivers: 5,
    claimCount: 5,
    biggestDropWei: "0",
    lastDropAt: 0,
    usd: 3.61,
    byChain: [],
  } as unknown as BoardRow;

  it("no usd part on `best token`; `best dropchad` keeps it", () => {
    expect(usdAndDrops({ ...row, usd: 0 }, "project")).toBe("3 drops · 5 payouts");
    expect(usdAndDrops(row, "fed")).toBe("$3.61 · 3 drops · 5 payouts");
    expect(usdAndDrops(row)).toBe("$3.61 · 3 drops · 5 payouts");
  });

  it("the rows of a `best token` board show no dollar sign", () => {
    const board = {
      range: "week",
      kind: "all",
      board: "project",
      chain: "all",
      rankedBy: "uniqueReceivers",
      available: true,
      finality: "final",
      rows: [{ ...row, usd: 0 }],
    } as unknown as Board;
    const html = renderToStaticMarkup(<BoardBlock board={board} empty="none" />);
    expect(html).toContain("3 drops · 5 payouts");
    expect(html).not.toContain("$");
    const fed = renderToStaticMarkup(
      <BoardRows rows={[row]} rankedBy="uniqueReceivers" board="fed" />,
    );
    expect(fed).toContain("$3.61 · 3 drops · 5 payouts");
  });
});

describe("the share card bar", () => {
  const card = (token: TokenInfo | null | undefined): ShareCardData => ({
    chainKey: "solana-devnet",
    symbol: token ? (token.symbol ?? "4zMM…ncDU") : "SOL",
    decimals: token ? token.decimals : 9,
    amount: "100000000",
    people: 1,
    sender: { handle: "samplechad", profileImageUrl: null },
    receivers: [{ handle: "dropchadfun", profileImageUrl: null }],
    rest: 0,
    rank: null,
    ...(token === undefined ? {} : { token }),
  });

  it("a token drop: the token's logo and letter in the bar, the chain's mark small on it", () => {
    expect(barMark(card(BONK))).toEqual({
      kind: "token",
      logoUrl: BONK.logoUrl,
      letter: "B",
      chainBadge: true,
    });
  });

  it("a SOL drop, or an old answer: the chain's mark as before", () => {
    expect(barMark(card(null))).toEqual({ kind: "chain" });
    expect(barMark(card(undefined))).toEqual({ kind: "chain" });
  });

  it("the post speaks the token, the bottom line stays", () => {
    expect(postText(card(BONK))).toBe(
      "sent 1000 $BONK to @dropchadfun on dropchad. sign in with X to claim, no wallet needed.",
    );
  });
});

describe("the profile", () => {
  it("`tokens are not counted yet.` is gone: token drops count since 4e", () => {
    const page = readFileSync(
      join(__dirname, "..", "src", "app", "u", "[handle]", "page.tsx"),
      "utf8",
    );
    expect(page).not.toContain("tokens are not counted yet");
  });
});
