/**
 * the token box on `/create`. Drop mode on
 * Solana only, at the top of step 1: `SOL` or `token`. A pasted address is checked with
 * `GET /api/tokens/:mint` and shown as one card (logo, name, ticker, launchpad, short address
 * with copy, `ok to drop` or the reason in red). The amounts are typed in the token, 500 people
 * at most. Step 2 shows `fee $15, paid in SOL` from
 * `tokenFeeTiers`. Plain words for the api's refusals.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TokenBox, TokenCard } from "@/components/create/TokenBox";
import { explain } from "@/components/create/errors";
import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import { TOKEN_FEE_NOTE, mintOf, tierFor, tokenLine, tokenMax } from "@/components/create/token";
import { ApiError, type TokenCheck } from "@/lib/api";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;
const bothOn = { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true };

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const OTHER_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const TIERS = [
  { upTo: 5, usd: "15" },
  { upTo: 20, usd: "25" },
  { upTo: 50, usd: "37.50" },
  { upTo: 100, usd: "45" },
  { upTo: 500, usd: "60" },
] as const;

const BONK: TokenCheck = {
  mint: MINT,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  name: "Bonk",
  symbol: "BONK",
  decimals: 5,
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
  launchpad: "pump.fun",
  ok: true,
  reason: null,
};

const FROZEN: TokenCheck = {
  ...BONK,
  ok: false,
  reason: "the creator can freeze it",
  logoUrl: null,
  launchpad: null,
};

/** Drop mode, both chains on, Solana picked: the page as a signed in sender first sees it. */
function start(): FormState {
  return reduceForm(initialForm(pills), { type: "handleModes", value: bothOn });
}

function run(...actions: Parameters<typeof reduceForm>[1][]): FormState {
  return actions.reduce(reduceForm, start());
}

/** Solana, `token`, the BONK address pasted and checked ok. */
const withBonk = (...more: Parameters<typeof reduceForm>[1][]) =>
  run(
    { type: "asset", value: "token" },
    { type: "mintText", value: ` ${MINT} ` },
    { type: "tokenCheck", result: { forMint: MINT, check: BONK } },
    ...more,
  );

const view = (state: FormState) => viewOf(state, pills, 100, 0n, null, TIERS);

const handles = (n: number, amount = "1") =>
  Array.from({ length: n }, (_, i) => `@p${String(i)} ${amount}`).join("\n");

describe("the small rules", () => {
  it("a token address is base58, 32 to 44 characters, trimmed", () => {
    expect(mintOf(` ${MINT}\n`)).toBe(MINT);
    expect(mintOf("0x1111111111111111111111111111111111111111")).toBeNull();
    expect(mintOf("hello")).toBeNull();
    expect(mintOf("")).toBeNull();
  });

  it("`ok to drop`, or `not ok:` with the reason", () => {
    expect(tokenLine(BONK)).toEqual({ ok: true, text: "ok to drop" });
    expect(tokenLine(FROZEN)).toEqual({ ok: false, text: "not ok: the creator can freeze it." });
  });

  it("the tier by the number of people; past the last tier there is none", () => {
    expect(tierFor(TIERS, 1)).toEqual({ upTo: 5, usd: "15" });
    expect(tierFor(TIERS, 5)).toEqual({ upTo: 5, usd: "15" });
    expect(tierFor(TIERS, 6)).toEqual({ upTo: 20, usd: "25" });
    expect(tierFor(TIERS, 50)).toEqual({ upTo: 50, usd: "37.50" });
    expect(tierFor(TIERS, 500)).toEqual({ upTo: 500, usd: "60" });
    expect(tierFor(TIERS, 501)).toBeNull();
    expect(tierFor(null, 3)).toBeNull();
  });

  it("the cap is the end of the last tier, 500 when the api sends none", () => {
    expect(tokenMax(TIERS)).toBe(500);
    expect(tokenMax([{ upTo: 3, usd: "10" }])).toBe(3);
    expect(tokenMax(null)).toBe(500);
    expect(tokenMax(undefined)).toBe(500);
  });

  it("the grey line under the tiles, the words", () => {
    expect(TOKEN_FEE_NOTE).toBe(
      "you also pay ≈ 0.002 SOL per person for their token account. what is not used comes back after 7 days.",
    );
  });
});

describe("where the box shows", () => {
  it("drop mode on Solana: the box, SOL by default", () => {
    const v = view(start());
    expect(v.tokenBox).toBe(true);
    expect(v.tokenChosen).toBe(false);
    expect(v.symbol).toBe("SOL");
    expect(v.asset).toBe("native");
  });

  it("Robinhood with no Robinhood tiers: no box, the drop is ETH even if token was picked before", () => {
    // the box shows on Robinhood once the api sends its tiers,
    // `robinhood-token-web.test.tsx`.
    const v = viewOf(
      run({ type: "asset", value: "token" }, { type: "chain", key: "robinhood" }),
      pills,
      100,
      0n,
      null,
      null,
    );
    expect(v.tokenBox).toBe(false);
    expect(v.tokenChosen).toBe(false);
    expect(v.symbol).toBe("ETH");
    expect(v.asset).toBe("native");
  });

  it("multisend: no box, tokens come to multisend later", () => {
    const v = view(withBonk({ type: "mode", mode: "multisend" }));
    expect(v.tokenBox).toBe(false);
    expect(v.symbol).toBe("SOL");
    expect(v.asset).toBe("native");
  });
});

describe("the amounts are in the token", () => {
  it("a checked token: its ticker and decimals, the mint is what is sent", () => {
    const v = view(withBonk({ type: "handleText", value: "@alice 1000\n@bob 0.00001" }));
    expect(v.tokenChosen).toBe(true);
    expect(v.tokenOk).toBe(true);
    expect(v.symbol).toBe("BONK");
    expect(v.decimals).toBe(5);
    expect(v.handles.errors).toEqual([]);
    expect(v.totalWei).toBe(100_000_001n);
    expect(v.asset).toBe(MINT);
    expect(v.step1Ok).toBe(true);
  });

  it("more decimals than the token has: refused on that line, in the token", () => {
    const v = view(withBonk({ type: "handleText", value: "@alice 0.000001" }));
    expect(v.handles.errors).toEqual([
      { line: 1, message: "amount must be a number above zero, in BONK" },
    ]);
  });

  it("no ticker: the word tokens", () => {
    const v = view(
      run(
        { type: "asset", value: "token" },
        { type: "mintText", value: OTHER_MINT },
        {
          type: "tokenCheck",
          result: { forMint: OTHER_MINT, check: { ...BONK, mint: OTHER_MINT, symbol: null } },
        },
      ),
    );
    expect(v.symbol).toBe("tokens");
  });

  it("`next` waits for `ok to drop`: nothing pasted, not checked yet, refused, or check failed", () => {
    const lines = { type: "handleText", value: "@alice 1" } as const;
    expect(view(run({ type: "asset", value: "token" }, lines)).step1Ok).toBe(false);
    expect(
      view(run({ type: "asset", value: "token" }, { type: "mintText", value: MINT }, lines))
        .step1Ok,
    ).toBe(false);
    const refused = view(
      run(
        { type: "asset", value: "token" },
        { type: "mintText", value: MINT },
        { type: "tokenCheck", result: { forMint: MINT, check: FROZEN } },
        lines,
      ),
    );
    expect(refused.tokenOk).toBe(false);
    expect(refused.tokenCheck).toEqual(FROZEN);
    expect(refused.step1Ok).toBe(false);
    const failed = view(
      run(
        { type: "asset", value: "token" },
        { type: "mintText", value: MINT },
        {
          type: "tokenCheck",
          result: {
            forMint: MINT,
            error: "cannot check this token right now. try again in a minute.",
          },
        },
        lines,
      ),
    );
    expect(failed.tokenError).toBe("cannot check this token right now. try again in a minute.");
    expect(failed.step1Ok).toBe(false);
  });

  it("an answer for an address no longer in the box is ignored", () => {
    const state = run(
      { type: "asset", value: "token" },
      { type: "mintText", value: OTHER_MINT },
      { type: "tokenCheck", result: { forMint: MINT, check: BONK } },
    );
    expect(view(state).tokenCheck).toBeNull();
  });

  it("a new paste forgets the old check", () => {
    const state = withBonk({ type: "mintText", value: OTHER_MINT });
    expect(view(state).tokenCheck).toBeNull();
    expect(view(state).tokenOk).toBe(false);
  });

  it("back to SOL, or another chain, clears the token; the typed lines stay", () => {
    const lines = { type: "handleText", value: "@alice 1" } as const;
    const sol = withBonk(lines, { type: "asset", value: "native" });
    expect(sol.mintText).toBe("");
    expect(sol.tokenCheck).toBeNull();
    expect(sol.handleText).toBe("@alice 1");
    expect(view(sol).symbol).toBe("SOL");

    const moved = withBonk(
      lines,
      { type: "chain", key: "robinhood" },
      { type: "chain", key: "solana" },
    );
    expect(moved.asset).toBe("native");
    expect(moved.mintText).toBe("");
    expect(moved.tokenCheck).toBeNull();
    expect(moved.handleText).toBe("@alice 1");
  });
});

describe("500 people at most, the end of the last tier", () => {
  it("500 is fine, 501 is too many", () => {
    expect(view(withBonk({ type: "handleText", value: handles(500) })).handles.tooMany).toBe(false);
    const over = view(withBonk({ type: "handleText", value: handles(501) }));
    expect(over.handles.tooMany).toBe(true);
    expect(over.maxPeople).toBe(500);
    expect(over.step1Ok).toBe(false);
  });

  it("follows the tiers the api sends", () => {
    const v = viewOf(withBonk({ type: "handleText", value: handles(4) }), pills, 100, 0n, null, [
      { upTo: 3, usd: "10" },
    ]);
    expect(v.maxPeople).toBe(3);
    expect(v.handles.tooMany).toBe(true);
  });
});

describe("step 2, the fee in usd, paid in SOL", () => {
  it("the tier for the number of people, never a SOL number from the page", () => {
    const v = view(withBonk({ type: "handleText", value: handles(6) }));
    expect(v.tokenTier).toEqual({ upTo: 20, usd: "25" });
    expect(v.feeWei).toBeNull();
    expect(v.grossWei).toBeNull();
  });

  it("an api with no tiers: no tier, the page says not sure", () => {
    const v = viewOf(
      withBonk({ type: "handleText", value: handles(2) }),
      pills,
      100,
      0n,
      null,
      null,
    );
    expect(v.tokenTier).toBeNull();
  });

  it("a SOL drop keeps its percent fee", () => {
    const v = view(run({ type: "handleText", value: "@alice 1" }));
    expect(v.tokenTier).toBeNull();
    expect(v.feeWei).toBe(10_000_000n);
  });
});

describe("plain words for the api's refusals", () => {
  const token = { decimals: 5, token: true };
  const err = (code: string, body: unknown = { error: code }) => new ApiError(400, code, body);

  it("token_refused carries the reason", () => {
    expect(
      explain(
        err("token_refused", { error: "token_refused", reason: "the creator can freeze it" }),
        token,
      ),
    ).toBe("this token cannot be dropped: the creator can freeze it.");
  });

  it("price_unavailable on a token drop", () => {
    expect(explain(err("price_unavailable"), token)).toBe(
      "no SOL price right now. try again in a minute.",
    );
  });

  it("fee_too_high", () => {
    expect(explain(err("fee_too_high"), token)).toBe(
      "the fee is too high right now. try again later.",
    );
  });

  it("too_many on a token drop", () => {
    expect(explain(err("too_many"), token)).toBe(
      "a token drop takes 500 people at most. remove some names.",
    );
  });

  it("the token check cannot be reached", () => {
    expect(explain(new ApiError(503, "solana_unavailable", null), token)).toBe(
      "cannot check this token right now. try again in a minute.",
    );
  });

  it("a SOL drop keeps its own words", () => {
    expect(explain(err("too_many", { error: "too_many", max: 500 }), { decimals: 9 })).toBe(
      "500 people per drop at most.",
    );
  });
});

describe("the token card", () => {
  it("logo, name, ticker, launchpad, short address with copy, ok to drop in mint", () => {
    const html = renderToStaticMarkup(<TokenCard check={BONK} />);
    expect(html).toContain(`src="${BONK.logoUrl ?? ""}"`);
    expect(html).toContain(">Bonk<");
    expect(html).toContain(">BONK<");
    expect(html).toContain("pump.fun");
    expect(html).toContain("DezX…B263");
    expect(html).toContain("copy");
    expect(html).toMatch(/class="[^"]*text-chad-accent[^"]*"[^>]*>ok to drop</);
  });

  it("refused: the reason in red, the first letter when there is no logo", () => {
    const html = renderToStaticMarkup(<TokenCard check={FROZEN} />);
    expect(html).toMatch(
      /class="[^"]*text-chad-error[^"]*"[^>]*>not ok: the creator can freeze it\.</,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain(">B<");
    expect(html).not.toContain("ok to drop");
  });

  it("the box: two choices, SOL first and pressed; token opens the paste box", () => {
    const sol = renderToStaticMarkup(
      <TokenBox
        coin="SOL"
        asset="native"
        mintText=""
        check={null}
        error={null}
        quickTokens={[]}
        onAsset={() => undefined}
        onMintText={() => undefined}
      />,
    );
    expect(sol.indexOf(">SOL<")).toBeLessThan(sol.indexOf(">token<"));
    expect(sol).toMatch(/aria-pressed="true"[^>]*>SOL</);
    expect(sol).not.toContain("paste a token address");

    const token = renderToStaticMarkup(
      <TokenBox
        coin="SOL"
        asset="token"
        mintText={MINT}
        check={BONK}
        error={null}
        quickTokens={[]}
        onAsset={() => undefined}
        onMintText={() => undefined}
      />,
    );
    expect(token).toMatch(/aria-pressed="true"[^>]*>token</);
    expect(token).toContain("paste a token address");
    expect(token).toContain("ok to drop");
  });

  it("the check failed: its line in red", () => {
    const html = renderToStaticMarkup(
      <TokenBox
        coin="SOL"
        asset="token"
        mintText={MINT}
        check={null}
        error="cannot check this token right now. try again in a minute."
        quickTokens={[]}
        onAsset={() => undefined}
        onMintText={() => undefined}
      />,
    );
    expect(html).toMatch(/text-chad-error[^"]*"[^>]*>cannot check this token right now/);
  });
});
