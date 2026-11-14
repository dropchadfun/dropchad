/**
 * The `/how` fee line with the new fee, read live from
 * `GET /api/chains`, never typed into the page:
 * - `SOL drops: 1%, at least 0.0003 SOL per person, at most 0.5 SOL per drop.`, the same shape
 *   for ETH
 * - a minimum per person of 0 shows the old flat minimum, as today
 * - a max fee of 0 is no cap: no `at most` part
 * - a chain whose numbers did not come back gets no line, never a guess
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { feeLines } from "@/components/how/how";
import { HowPage } from "@/components/how/HowPage";
import type { ChainInfo } from "@/lib/api";

const ETH: ChainInfo = {
  key: "robinhood-testnet",
  chainId: 46630,
  family: "evm",
  nativeSymbol: "ETH",
  decimals: 18,
  defaultFeeBps: 100,
  minFee: "0",
  minFeePerReceiver: "10000000000000",
  maxFee: "20000000000000000",
  handleMode: true,
  tokenFeeTiers: [],
};

const SOL: ChainInfo = {
  key: "solana-devnet",
  chainId: 103,
  family: "svm",
  nativeSymbol: "SOL",
  decimals: 9,
  defaultFeeBps: 100,
  minFee: "0",
  minFeePerReceiver: "300000",
  maxFee: "500000000",
  handleMode: true,
  tokenFeeTiers: [],
};

describe("the /how fee line with the new fee", () => {
  it("1%, at least the minimum per person, at most the max fee per drop, Solana first", () => {
    expect(feeLines([ETH, SOL])?.coins).toEqual([
      "SOL drops: 1%, at least 0.0003 SOL per person, at most 0.5 SOL per drop.",
      "ETH drops: 1%, at least 0.00001 ETH per person, at most 0.02 ETH per drop.",
    ]);
  });

  it("a minimum per person of 0 shows the old flat minimum, as today", () => {
    const old = { ...SOL, minFee: "2500000", minFeePerReceiver: "0", maxFee: "0" };
    expect(feeLines([old])?.coins).toEqual(["SOL drops: 1%, at least 0.0025 SOL."]);
  });

  it("an api without the two numbers is the old line too", () => {
    const { minFeePerReceiver: _p, maxFee: _m, ...older } = { ...SOL, minFee: "2500000" };
    expect(feeLines([older])?.coins).toEqual(["SOL drops: 1%, at least 0.0025 SOL."]);
  });

  it("a max fee of 0 is no cap: no at most part", () => {
    expect(feeLines([{ ...SOL, maxFee: "0" }])?.coins).toEqual([
      "SOL drops: 1%, at least 0.0003 SOL per person.",
    ]);
  });

  it("the old flat minimum keeps a cap when the chain has one", () => {
    const flat = { ...ETH, minFee: "10000000000000", minFeePerReceiver: "0" };
    expect(feeLines([flat])?.coins).toEqual([
      "ETH drops: 1%, at least 0.00001 ETH, at most 0.02 ETH per drop.",
    ]);
  });

  it("a chain whose new numbers did not come back gets no line", () => {
    const quiet = { ...SOL, minFeePerReceiver: null, maxFee: null };
    expect(feeLines([quiet, ETH])?.coins).toEqual([
      "ETH drops: 1%, at least 0.00001 ETH per person, at most 0.02 ETH per drop.",
    ]);
  });

  it("the page shows the live lines", () => {
    const text = renderToStaticMarkup(<HowPage chains={[ETH, SOL]} />)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(text).toContain(
      "SOL drops: 1%, at least 0.0003 SOL per person, at most 0.5 SOL per drop.",
    );
    expect(text).toContain(
      "ETH drops: 1%, at least 0.00001 ETH per person, at most 0.02 ETH per drop.",
    );
  });
});
