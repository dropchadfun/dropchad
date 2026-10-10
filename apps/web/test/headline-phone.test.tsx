/**
 * The drop page headline on the phone is never cut: the amount and the
 * ticker, `21,000 $TEST`, always show in full and stay together; the name and `is dropping` may
 * wrap to a new line. Long tickers keep the 10 letter rule. Desktop stays one line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { LiveView } from "@/components/drops/LiveView";
import { headlineParts } from "@/components/drops/drop-lines";
import type { DropDetail, Profile, TokenInfo } from "@/lib/api";

const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";

const creator = {
  xUserId: "1",
  handle: "averylonghandle",
  displayName: "long",
  profileImageUrl: null,
  kind: "kol",
  tags: [],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

const token = (symbol: string | null): TokenInfo => ({
  mint: MINT,
  symbol,
  name: "Test Coin",
  decimals: 5,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
  launchpad: null,
});

const live = (t: TokenInfo | null, amountWei = "2100000000") =>
  renderToStaticMarkup(
    <LiveView
      address={DROP}
      chainId={103}
      token={t}
      title={null}
      creator={creator}
      amountWei={amountWei}
      createdAt={1790838985}
      leafCount={2}
      paidCount={0}
      paid={[]}
      waiting={false}
    />,
  );

const after = (t: TokenInfo | null) =>
  renderToStaticMarkup(
    <AfterView
      detail={
        {
          address: DROP,
          chain: { source: "rpc", available: true, indexed: false, data: null },
          ours: {
            source: "dropchad_api",
            known: true,
            data: { token: t, memeImageUrl: null, lastTxHash: null, activateTxHash: null },
          },
        } as unknown as DropDetail
      }
      paid={[]}
      paidCount={0}
      leafCount={2}
      chainId={103}
      amountWei="2100000000"
      createdAt={1790838985}
      title={null}
      creator={creator}
      chip="DONE"
    />,
  );

const h1 = (html: string) => /<h1 class="([^"]*)">([\s\S]*?)<\/h1>/.exec(html);

describe("the headline parts: the words, then the amount and the unit apart", () => {
  it("the amount is its own part", () => {
    expect(
      headlineParts({
        title: null,
        handle: "samplechad",
        amountWei: "2100000000",
        chainId: 103,
        token: token("TEST"),
        createdAt: null,
        finished: false,
      }),
    ).toEqual({ lead: "samplechad is dropping ", amount: "21,000", unit: "$TEST", small: false });
  });
});

describe("on the phone: never cut, the amount and the ticker whole", () => {
  for (const [name, html, verb] of [
    ["live", () => live(token("TEST")), "is dropping"],
    ["finished", () => after(token("TEST")), "dropped"],
  ] as const) {
    it(`${name}: no two line cut on the phone, one line from md`, () => {
      const m = h1(html());
      expect(m?.[1]?.split(" ")).not.toContain("line-clamp-2");
      expect(m?.[1]).toContain("md:line-clamp-1");
    });

    it(`${name}: 21,000 $TEST in one unbroken piece after the words`, () => {
      const m = h1(html());
      expect(m?.[2]).toBe(
        `averylonghandle ${verb} <span class="whitespace-nowrap">21,000 $TEST</span>`,
      );
    });
  }

  it("a long ticker: still whole, cut at 10 letters, the smaller size inside the piece", () => {
    expect(h1(live(token("VERYLONGTICKER")))?.[2]).toBe(
      'averylonghandle is dropping <span class="whitespace-nowrap">21,000 <span class="type-h2 font-semibold">$VERYLONGTI…</span></span>',
    );
  });

  it("no ticker and a SOL drop: the same unbroken piece", () => {
    expect(h1(live(token(null)))?.[2]).toContain(
      '<span class="whitespace-nowrap">21,000 tokens</span>',
    );
    expect(h1(live(null, "3000000"))?.[2]).toContain(
      '<span class="whitespace-nowrap">0.003 SOL</span>',
    );
  });
});
