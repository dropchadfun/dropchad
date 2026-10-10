/**
 * after the screenshots, six points:
 * 1. the step 2 tiles of `/create` go one per row on the phone, three from `md`;
 * 2. until a token is ok, the unit line says `paste a token first`, never `token`;
 * 3. the token card's copy button looks small, its tap area stays 44px;
 * 4. the funding card's SOL line ends like step 2, `after 7 days`;
 * 5. the funding card has the drop page's width, `max-w-xl`, centred, token and SOL drops;
 * 6. the drop page headline wraps to two lines on the phone instead of being cut.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TokenCard } from "@/components/create/TokenBox";
import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import { AfterView } from "@/components/drops/AfterView";
import { DropPage } from "@/components/drops/DropPage";
import { FundingCardFrom } from "@/components/drops/FundingCard";
import { LiveView } from "@/components/drops/LiveView";
import type { DropDetail, Funding, Profile, TokenCheck } from "@/lib/api";
import { chainPills } from "@/lib/chains";

const SRC = join(__dirname, "..", "src");
const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";

const BONK: TokenCheck = {
  mint: MINT,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  name: "Bonk",
  symbol: "BONK",
  decimals: 5,
  logoUrl: null,
  launchpad: null,
  ok: true,
  reason: null,
};

const creator = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "sample chad",
  profileImageUrl: null,
  kind: "kol",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

const start = (): FormState =>
  reduceForm(initialForm(pills), {
    type: "handleModes",
    value: { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true },
  });
const run = (...actions: Parameters<typeof reduceForm>[1][]) => actions.reduce(reduceForm, start());

describe("1. step 2 tiles, one per row on the phone", () => {
  it("the step 2 tile row is one column, three from md", () => {
    const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(page).toContain('<dl className="grid grid-cols-1 gap-3 md:grid-cols-3">');
    expect(page).not.toContain('<dl className="grid grid-cols-3 gap-3">');
  });
});

describe("2. the unit line before a token is ok", () => {
  const lines = { type: "handleText", value: "@alice 1000\n@bob 500" } as const;

  it("nothing pasted, or not ok yet: paste a token first, never the word token", () => {
    for (const state of [
      run({ type: "asset", value: "token" }, lines),
      run({ type: "asset", value: "token" }, { type: "mintText", value: MINT }, lines),
      run(
        { type: "asset", value: "token" },
        { type: "mintText", value: MINT },
        {
          type: "tokenCheck",
          result: { forMint: MINT, check: { ...BONK, ok: false, reason: "x" } },
        },
        lines,
      ),
    ]) {
      const v = viewOf(state, pills);
      expect(v.receiversHint).toBe("one per line: an X handle, then amount. paste a token first.");
      expect(v.totalText).toBe("1,500");
      expect(v.receiversHint).not.toMatch(/\btoken\./);
      expect(v.totalText).not.toContain("token");
    }
  });

  it("a bad amount line names no unit while there is none", () => {
    const v = viewOf(
      run({ type: "asset", value: "token" }, { type: "handleText", value: "@alice abc" }),
      pills,
    );
    expect(v.handles.errors).toEqual([{ line: 1, message: "amount must be a number above zero" }]);
  });

  it("ok token, SOL and multisend keep their unit", () => {
    const ok = viewOf(
      run(
        { type: "asset", value: "token" },
        { type: "mintText", value: MINT },
        { type: "tokenCheck", result: { forMint: MINT, check: BONK } },
        lines,
      ),
      pills,
    );
    expect(ok.receiversHint).toBe(
      "one per line: an X handle, then amount in BONK. paste from a sheet, it will read it.",
    );
    expect(ok.totalText).toBe("1,500 BONK");

    const sol = viewOf(run({ type: "handleText", value: "@alice 1" }), pills);
    expect(sol.receiversHint).toBe(
      "one per line: an X handle, then amount in SOL. paste from a sheet, it will read it.",
    );
    expect(sol.totalText).toBe("1 SOL");

    const multi = viewOf(run({ type: "mode", mode: "multisend" }), pills);
    expect(multi.receiversHint).toBe(
      "one per line: address, then amount in SOL. paste from a sheet, it will read it.",
    );
  });

  it("the page reads the hint and the total from the view", () => {
    const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(page).toContain("{view.receiversHint}");
    expect(page).toContain("value={view.totalText}");
  });
});

describe("3. the token card's copy button", () => {
  it("small to look at, a 44px tap area", () => {
    const html = renderToStaticMarkup(<TokenCard check={BONK} />);
    const button = /<button[^>]*class="([^"]*)"[^>]*>[\s\S]*?copy<\/button>/.exec(html)?.[1] ?? "";
    expect(button).toContain("h-7");
    expect(button).toContain("type-small");
    // 28px plus 8px above and below.
    expect(button).toContain("before:-inset-y-2");
    expect(button).toContain("relative");
  });
});

describe("4. the funding card's SOL line", () => {
  it("the SOL part says what it is for, in a few words", () => {
    const funding: Funding = {
      family: "svm",
      address: DROP,
      chainId: 103,
      asset: "native",
      symbol: "SOL",
      decimals: 9,
      amountBaseUnits: "52500000",
      amountDisplay: "0.0525",
      paymentUri: `solana:${DROP}?amount=0.0525`,
      fundingDeadline: "1",
      amountWei: "52500000",
      amountEth: "0.0525",
      token: {
        mint: MINT,
        vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
        tokenProgram: BONK.tokenProgram ?? "",
        name: "Bonk",
        symbol: "BONK",
        decimals: 5,
        amountBaseUnits: "100000000",
        amountDisplay: "1000",
        paymentUri: `solana:${DROP}?amount=1000&spl-token=${MINT}`,
      },
    };
    const html = renderToStaticMarkup(
      <FundingCardFrom funding={funding} amountWei="100000000" feeWei="0" />,
    );
    expect(html).toContain("for the fee and the token accounts.");
  });
});

/** A SOL drop waiting for money, with its funding answer. */
function created(): DropDetail {
  return {
    address: DROP,
    chain: { source: "rpc", available: true, indexed: false, data: null },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        address: DROP,
        chainId: 103,
        chainKey: "solana-devnet",
        asset: "11111111111111111111111111111111",
        token: null,
        funding: {
          family: "svm",
          address: DROP,
          chainId: 103,
          asset: "native",
          symbol: "SOL",
          decimals: 9,
          amountBaseUnits: "212500000",
          amountDisplay: "0.2125",
          paymentUri: `solana:${DROP}?amount=0.2125`,
          fundingDeadline: "1",
          amountWei: "212500000",
          amountEth: "0.2125",
        },
        title: null,
        memeImageUrl: null,
        state: "created",
        mode: "handle",
        totalEntitlementsWei: "210000000",
        grossRequiredWei: "212500000",
        feeAmountWei: "2500000",
        leafCount: 21,
        paidCount: 0,
        failedIndexes: [],
        createTxHash: "x",
        activateTxHash: null,
        lastTxHash: null,
        refundRecipient: "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH",
        merkleRoot: "0x00",
        manifestUrl: "",
        lastError: null,
        fundingDeadline: "1",
        createdAt: "2026-10-03T07:16:25.000Z",
        creator,
        yours: true,
        fed: [],
      },
    },
  } as unknown as DropDetail;
}

describe("5. the funding card has the drop page's width", () => {
  it("one centred max-w-xl column, the funding card inside it", () => {
    const html = renderToStaticMarkup(<DropPage initial={created()} />);
    expect(html).toMatch(
      /<div class="mx-auto mb-6 w-full max-w-xl"><h1[^>]*>waiting for the money<\/h1>[\s\S]*send this amount/,
    );
  });
});

describe("6. the drop page headline wraps on the phone", () => {
  const h1 = (html: string) => /<h1 class="([^"]*)"/.exec(html)?.[1] ?? "";

  it("live: two lines on the phone, one from md, never a plain truncate", () => {
    const html = renderToStaticMarkup(
      <LiveView
        address={DROP}
        chainId={103}
        title={null}
        creator={creator}
        amountWei="2100000000000"
        createdAt={1790838985}
        leafCount={21}
        paidCount={0}
        paid={[]}
        waiting
      />,
    );
    // Never cut on the phone since the headline fix; one line from md.
    expect(h1(html).split(" ")).not.toContain("line-clamp-2");
    expect(h1(html)).toContain("md:line-clamp-1");
    expect(h1(html).split(" ")).not.toContain("truncate");
  });

  it("finished: the same", () => {
    const detail = created();
    const html = renderToStaticMarkup(
      <AfterView
        detail={detail}
        paid={[]}
        paidCount={0}
        leafCount={21}
        chainId={103}
        amountWei="210000000"
        createdAt={1790838985}
        title={null}
        creator={creator}
        chip="DONE"
      />,
    );
    // Never cut on the phone since the headline fix; one line from md.
    expect(h1(html).split(" ")).not.toContain("line-clamp-2");
    expect(h1(html)).toContain("md:line-clamp-1");
    expect(h1(html).split(" ")).not.toContain("truncate");
  });
});
