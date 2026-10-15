/**
 * The stable tab follow-up: a token picked from `stable` whose chain gives no
 * ticker shows the button's ticker, so devnet USDC reads `USDC` in the receivers hint and the
 * total, never `tokens`. A ticker the chain does give still wins; a pasted token is unchanged.
 */
import { describe, expect, it } from "vitest";

import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import type { TokenCheck } from "@/lib/api";
import { chainPills } from "@/lib/chains";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const TIERS = [{ upTo: 500, usd: "20" }] as const;

/** Devnet USDC as the api reads it: no metadata account, so no name and no ticker. */
const NO_TICKER_CHECK: TokenCheck = {
  mint: DEVNET_USDC,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  name: null,
  symbol: null,
  decimals: 6,
  logoUrl: null,
  launchpad: null,
  ok: true,
  reason: null,
};

function picked(asset: "stable" | "token", check: TokenCheck): FormState {
  return [
    { type: "handleModes", value: { [SOLANA_KEY]: true } },
    { type: "asset", value: asset },
    { type: "mintText", value: DEVNET_USDC },
    { type: "tokenCheck", result: { forMint: DEVNET_USDC, check } },
  ].reduce(
    (state, action) => reduceForm(state, action as Parameters<typeof reduceForm>[1]),
    initialForm(pills),
  );
}

const view = (state: FormState) => viewOf(state, pills, 100, 0n, null, TIERS);

describe("the button's ticker when the chain has none", () => {
  it("stable, devnet USDC: USDC in the hint and the total, never tokens", () => {
    const v = view(picked("stable", NO_TICKER_CHECK));
    expect(v.symbol).toBe("USDC");
    expect(v.receiversHint).toBe(
      "one per line: an X handle, then amount in USDC. paste from a sheet, it will read it.",
    );
    expect(v.totalText).toBe("0 USDC");
    expect(v.receiversHint).not.toContain("tokens");
    expect(v.totalText).not.toContain("tokens");
  });

  it("a ticker the chain gives still wins", () => {
    const v = view(picked("stable", { ...NO_TICKER_CHECK, symbol: "USDC.d" }));
    expect(v.symbol).toBe("USDC.d");
  });

  it("the same address pasted under token: unchanged, the old no ticker word", () => {
    const v = view(picked("token", NO_TICKER_CHECK));
    expect(v.symbol).toBe("tokens");
  });
});
