/**
 * The beta cap words of the live mainnet chains only: on `/create`,
 * `/terms` and `/about` the caps name only the chains the beta card counts as live, Solana first.
 * With no api answer Solana alone: Robinhood is recorded but behind the api switch,
 * `test/live-switch.test.tsx`.
 */
import { describe, expect, it } from "vitest";

import { BETA_NOTICE, DROP_CAPS, dropCapWords } from "@/lib/beta";
import { liveMainnetKeys } from "@/lib/chains";

const SOLANA_ALONE = "2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana";

describe("the cap words per live chains", () => {
  it("Solana alone", () => {
    expect(dropCapWords(["solana"])).toBe(SOLANA_ALONE);
  });

  it("Solana and Robinhood: Solana first in the list order", () => {
    expect(dropCapWords(["robinhood", "solana"])).toBe(
      "2 SOL, 0.1 ETH, 200 USDG on robinhood, 200 USDC, 200 USDT or 200 USD1 on solana",
    );
  });

  it("Robinhood alone", () => {
    expect(dropCapWords(["robinhood"])).toBe("0.1 ETH, 200 USDG on robinhood");
  });
});

describe("this build with no api answer, Solana alone", () => {
  it("the live chains are Solana alone", () => {
    expect(liveMainnetKeys()).toEqual(["solana"]);
  });

  it("the words name Solana only, never Robinhood", () => {
    expect(DROP_CAPS).toBe(SOLANA_ALONE);
    expect(DROP_CAPS).not.toMatch(/robinhood|ETH|USDG/);
  });

  it("the /create notice, exactly", () => {
    expect(BETA_NOTICE).toBe(
      `dropchad is in beta. each drop has a limit while we grow: ${SOLANA_ALONE}. other tokens have no limit.`,
    );
  });
});
