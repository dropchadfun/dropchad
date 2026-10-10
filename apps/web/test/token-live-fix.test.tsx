/**
 * after the live devnet token test (,
 * ). Aim: a kid or a grandmother can use it, short simple words.
 * the asset row (full address, `name · ticker` under it), no `change it with back`, the
 * fee tile (`≈ 0.08 SOL` big, `$15` small; a SOL drop its fee in SOL and `1%`), the grey
 * line. The token funding card: the ticker, one drop address, four short lines. Everywhere: a
 * token with no ticker says `tokens`, the post uses `$TICKER`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import { TOKEN_FEE_NOTE, aboutSol, assetSub } from "@/components/create/token";
import { DropRows } from "@/components/drops/DropRows";
import { FundingCardFrom } from "@/components/drops/FundingCard";
import { fromOwnCard } from "@/components/drops/drop-card-data";
import { dropLines, linesOfCard } from "@/components/drops/drop-lines";
import { cardSymbol, postText, type ShareCardData } from "@/components/drops/share-card";
import type { Funding, TokenCheck, TokenInfo } from "@/lib/api";
import { chainPills } from "@/lib/chains";

const SRC = join(__dirname, "..", "src");
const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const VAULT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const CHECK: TokenCheck = {
  mint: MINT,
  tokenProgram: TOKEN_PROGRAM,
  name: "Sample Bonk",
  symbol: "SBONK",
  decimals: 5,
  logoUrl: null,
  launchpad: null,
  ok: true,
  reason: null,
};

const TIERS = [
  { upTo: 5, usd: "15", lamports: "100000000" },
  { upTo: 20, usd: "25", lamports: "78947368" },
  { upTo: 50, usd: "37.50", lamports: null },
] as const;

const start = (): FormState =>
  reduceForm(initialForm(pills), {
    type: "handleModes",
    value: { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true },
  });
const run = (...actions: Parameters<typeof reduceForm>[1][]) => actions.reduce(reduceForm, start());
const handles = (n: number) =>
  Array.from({ length: n }, (_, i) => `@p${String(i)} 1000`).join("\n");
const withToken = (check: TokenCheck, people: number) =>
  run(
    { type: "asset", value: "token" },
    { type: "mintText", value: check.mint },
    { type: "tokenCheck", result: { forMint: check.mint, check } },
    { type: "handleText", value: handles(people) },
  );

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("1. the asset row on step 2", () => {
  it("name and ticker under the full address; nothing when the token has neither", () => {
    expect(assetSub(CHECK)).toBe("Sample Bonk · SBONK");
    expect(assetSub({ ...CHECK, symbol: null })).toBe("Sample Bonk");
    expect(assetSub({ ...CHECK, name: null })).toBe("SBONK");
    expect(assetSub({ ...CHECK, name: null, symbol: null })).toBeNull();
  });

  it("the page shows the full address and the line under it", () => {
    const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(page).toContain("assetHalves(view.tokenCheck.mint)");
    expect(page).toContain("assetSub(view.tokenCheck)");
    expect(page).not.toContain("shortMint(view.tokenCheck.mint)");
  });
});

describe("2. no change it with back, anywhere", () => {
  it("no source file says it", () => {
    const hits = sourceFiles(SRC).filter((file) =>
      readFileSync(file, "utf8").includes("change it with back"),
    );
    expect(hits).toEqual([]);
  });
});

describe("3. the fee tile: ≈ the SOL big, the usd small", () => {
  it("≈, rounded up to 2 decimals", () => {
    expect(aboutSol("100000000")).toBe("≈ 0.1 SOL");
    expect(aboutSol("78947368")).toBe("≈ 0.08 SOL");
    expect(aboutSol("250000001")).toBe("≈ 0.26 SOL");
    expect(aboutSol("400000000")).toBe("≈ 0.4 SOL");
  });

  it("a token drop: the api's estimate big, the tier's usd small", () => {
    const v = viewOf(withToken(CHECK, 3), pills, 100, 0n, null, TIERS);
    expect(v.feeBig).toBe("≈ 0.1 SOL");
    expect(v.feeSmall).toBe("$15");
    const v2 = viewOf(withToken(CHECK, 6), pills, 100, 0n, null, TIERS);
    expect(v2.feeBig).toBe("≈ 0.08 SOL");
    expect(v2.feeSmall).toBe("$25");
  });

  it("no price at the api: no SOL number, the usd still shows", () => {
    const v = viewOf(withToken(CHECK, 21), pills, 100, 0n, null, TIERS);
    expect(v.feeBig).toBeNull();
    expect(v.feeSmall).toBe("$37.50");
  });

  it("a SOL drop: its fee in SOL big, 1% or minimum fee small", () => {
    const v = viewOf(run({ type: "handleText", value: "@alice 1" }), pills, 100, 0n);
    expect(v.feeBig).toBe("0.01 SOL");
    expect(v.feeSmall).toBe("1%");
    const min = viewOf(
      run({ type: "handleText", value: "@alice 0.000000001" }),
      pills,
      100,
      2_500_000n,
    );
    expect(min.feeBig).toBe("0.0025 SOL");
    expect(min.feeSmall).toBe("minimum fee");
  });

  it("the tile's label is fee, the small line under the big one", () => {
    const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(page).toContain('label="fee"');
    expect(page).toContain("sub={view.feeSmall}");
  });
});

describe("4. people get: the amount and the ticker", () => {
  it("1,000 SBONK; no ticker, 1,000 tokens", () => {
    expect(viewOf(withToken(CHECK, 1), pills).totalText).toBe("1,000 SBONK");
    expect(viewOf(withToken({ ...CHECK, symbol: null }, 1), pills).totalText).toBe("1,000 tokens");
  });
});

describe("5. the grey line", () => {
  it("the words", () => {
    expect(TOKEN_FEE_NOTE).toBe(
      "you also pay ≈ 0.002 SOL per person for their token account. what is not used comes back after 7 days.",
    );
  });
});

/** A token drop's funding answer, the SOL part already rounded by the api. */
function funding(symbol: string | null): Funding {
  return {
    family: "svm",
    address: DROP,
    chainId: 103,
    asset: "native",
    symbol: "SOL",
    decimals: 9,
    amountBaseUnits: "127000000",
    amountDisplay: "0.127",
    paymentUri: `solana:${DROP}?amount=0.127`,
    fundingDeadline: "1",
    amountWei: "127000000",
    amountEth: "0.127",
    token: {
      mint: MINT,
      vault: VAULT,
      tokenProgram: TOKEN_PROGRAM,
      name: null,
      symbol,
      decimals: 5,
      amountBaseUnits: "100000000",
      amountDisplay: "1000",
      paymentUri: `solana:${DROP}?amount=1000&spl-token=${MINT}`,
    },
  };
}

describe("6 to 9. the token funding card", () => {
  const render = (symbol: string | null) =>
    renderToStaticMarkup(
      <FundingCardFrom
        funding={funding(symbol)}
        amountWei="100000000"
        feeWei="0"
        warnings={["Send at least 0.127 SOL on Solana Devnet to the address above."]}
      />,
    );

  it("6. the ticker, or the word tokens; never the short address", () => {
    expect(render("SBONK")).toContain(">SBONK<");
    const none = render(null);
    expect(none).toContain(">tokens<");
    expect(none).not.toContain("DezX…");
  });

  it("7. the SOL part as the api rounded it, 0.127", () => {
    expect(render("SBONK")).toContain(">0.127<");
  });

  it("8. one drop address, no token account, no long wallet warning", () => {
    const html = render("SBONK");
    // The drop address, in its two even halves since the funding card fix.
    expect(html).toContain(DROP.slice(0, 22));
    expect(html).toContain(DROP.slice(22));
    expect(html).not.toContain(VAULT);
    expect(html).not.toContain("token account of the drop");
    expect(html).not.toContain("some wallets warn");
  });

  it("9. four short lines, no repeats, the api's long warnings not shown here", () => {
    const html = render("SBONK");
    for (const line of [
      "send both to this address.",
      "check it before you send.",
      "unused money goes back to your wallet.",
      "never use an exchange address.",
    ]) {
      expect(html).toContain(line);
    }
    expect(html).not.toContain("Send at least");
    expect(html).not.toContain("a plain transfer is enough");
  });
});

const NO_TICKER: TokenInfo = {
  mint: MINT,
  symbol: null,
  name: null,
  decimals: 5,
  tokenProgram: TOKEN_PROGRAM,
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
};

describe("10. no ticker: tokens everywhere; the post uses $TICKER", () => {
  it("headline and rows", () => {
    expect(
      dropLines({
        title: null,
        handle: "samplechad",
        amountWei: "100000000",
        chainId: 103,
        token: NO_TICKER,
        createdAt: null,
        finished: false,
      }).first,
    ).toBe("samplechad is dropping 1,000 tokens");
    const card = fromOwnCard({
      address: DROP,
      chainId: 103,
      asset: MINT,
      token: NO_TICKER,
      title: null,
      memeImageUrl: null,
      state: "active",
      mode: "handle",
      totalEntitlementsWei: "100000000",
      leafCount: 1,
      paidCount: 0,
      failedIndexes: [],
      createTxHash: "x",
      activateTxHash: null,
      lastTxHash: null,
      fundingDeadline: "1",
      createdAt: "2026-10-03T07:16:25.000Z",
      creator: null,
    });
    expect(linesOfCard(card).first).toBe("token drop");
    const html = renderToStaticMarkup(<DropRows rows={[card]} />);
    expect(html).toContain(">tokens<");
    expect(html).not.toContain("DezX…");
  });

  const share = (token: TokenInfo | null, symbol: string): ShareCardData => ({
    chainKey: "solana-devnet",
    symbol,
    decimals: token ? token.decimals : 9,
    amount: "100000000",
    people: 1,
    sender: { handle: "samplechad", profileImageUrl: null },
    receivers: [{ handle: "dropchadfun", profileImageUrl: null }],
    rest: 0,
    rank: null,
    token,
  });

  it("the share card bar: the ticker, or tokens even from an api that sends the short mint", () => {
    expect(cardSymbol(share({ ...NO_TICKER, symbol: "TEST" }, "TEST"))).toBe("TEST");
    expect(cardSymbol(share(NO_TICKER, "DezX…B263"))).toBe("tokens");
    expect(cardSymbol(share(null, "SOL"))).toBe("SOL");
  });

  it("the post: $TEST with a ticker, tokens without, SOL unchanged", () => {
    expect(postText(share({ ...NO_TICKER, symbol: "TEST" }, "TEST"))).toBe(
      "sent 1000 $TEST to @dropchadfun on dropchad. sign in with X to claim, no wallet needed.",
    );
    expect(postText(share(NO_TICKER, "DezX…B263"))).toBe(
      "sent 1000 tokens to @dropchadfun on dropchad. sign in with X to claim, no wallet needed.",
    );
    expect(postText({ ...share(null, "SOL"), amount: "500000000" })).toBe(
      "sent 0.5 SOL to @dropchadfun on dropchad. sign in with X to claim, no wallet needed.",
    );
  });

  it("the card draws the bar with barSymbol, the cut and sized cardSymbol", () => {
    const page = readFileSync(join(SRC, "components", "drops", "ShareCard.tsx"), "utf8");
    expect(page).toContain("barSymbol(card)");
    expect(page).not.toContain("card.symbol");
  });
});
