/**
 * the `stable` tab on `/create`
 * Three tabs: the coin, `stable`, `token`. `stable` shows the chain's quick
 * tokens as big buttons, the ticker only, no paste box and no address; the picked one is mint,
 * and the same card shows under them. `token` is the paste box only. No quick tokens, no
 * `stable` tab. Moving between `stable` and `token` empties the address.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StableButtons, TokenBox } from "@/components/create/TokenBox";
import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import type { TokenCheck } from "@/lib/api";
import { chainPills } from "@/lib/chains";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TUSDC = "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C";
// No logo here, so a button is the ticker alone; the logos are in `stable-logos.test.tsx`.
const USDC = {
  symbol: "USDC",
  address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  name: "USD Coin",
  logo: null,
};
const USDT = {
  symbol: "USDT",
  address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  name: "Tether USD",
  logo: null,
};

const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;

const TIERS = [{ upTo: 500, usd: "20" }] as const;

const CHECK: TokenCheck = {
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

function box(props: Partial<Parameters<typeof TokenBox>[0]>): string {
  return renderToStaticMarkup(
    <TokenBox
      coin="SOL"
      asset="stable"
      mintText=""
      check={null}
      error={null}
      quickTokens={[USDC, USDT]}
      onAsset={() => undefined}
      onMintText={() => undefined}
      {...props}
    />,
  );
}

/** Every element in a tree a component returned, depth first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"] as ReactNode)];
}

/** Drop mode, Solana picked, as a signed in sender first sees the page. */
function start(): FormState {
  return reduceForm(initialForm(pills), { type: "handleModes", value: { [SOLANA_KEY]: true } });
}

const run = (...actions: Parameters<typeof reduceForm>[1][]) => actions.reduce(reduceForm, start());
const view = (state: FormState) => viewOf(state, pills, 100, 0n, null, TIERS);

describe("the pills carry the chain's quick tokens", () => {
  it("solana: the devnet USDC; robinhood: tUSDC; a chain with nothing deployed: none", () => {
    expect(pills.find((p) => p.key === "solana")?.quickTokens).toEqual([
      { symbol: "USDC", address: DEVNET_USDC, name: "USD Coin", logo: "/tokens/usdc.png" },
    ]);
    expect(pills.find((p) => p.key === "robinhood")?.quickTokens).toEqual([
      { symbol: "tUSDC", address: TUSDC, name: "Test USDC", logo: "/tokens/usdc.png" },
    ]);
    expect(pills.find((p) => p.key === "ton")?.quickTokens).toEqual([]);
  });
});

describe("the three tabs", () => {
  it("the coin, then stable, then token", () => {
    const html = box({ asset: "native" });
    expect(html.indexOf(">SOL<")).toBeLessThan(html.indexOf(">stable<"));
    expect(html.indexOf(">stable<")).toBeLessThan(html.indexOf(">token<"));
    expect(html).toContain('aria-label="SOL, stable or a token"');
  });

  it("stable picked: its tab is pressed", () => {
    expect(box({})).toMatch(/aria-pressed="true"[^>]*>stable</);
  });

  it("no quick tokens: no stable tab, the coin and token only", () => {
    const html = box({ asset: "native", quickTokens: [] });
    expect(html).not.toContain(">stable<");
    expect(html).toContain(">token<");
    expect(html).toContain('aria-label="SOL or a token"');
  });
});

describe("stable", () => {
  it("big buttons, the ticker only, in list order; no paste box and no address", () => {
    const html = box({});
    expect(html.indexOf(">USDC<")).toBeLessThan(html.indexOf(">USDT<"));
    expect(html).not.toContain("paste a token address");
    expect(html).not.toContain(USDC.address);
    expect(html).not.toContain("$");
    const button = html.match(/<button[^>]*>USDC<\/button>/)?.[0] ?? "";
    expect(button).toMatch(/\bh-12\b/);
    expect(button).toContain("flex-1");
  });

  it("the picked one is mint and pressed, the other is a plain card", () => {
    const html = box({ mintText: USDT.address });
    const usdt = html.match(/<button[^>]*>USDT<\/button>/)?.[0] ?? "";
    const usdc = html.match(/<button[^>]*>USDC<\/button>/)?.[0] ?? "";
    expect(usdt).toContain('aria-pressed="true"');
    expect(usdt).toContain("bg-chad-accent");
    expect(usdt).toContain("text-chad-accent-ink");
    expect(usdc).toContain('aria-pressed="false"');
    expect(usdc).not.toContain("bg-chad-accent");
  });

  it("the same card with ok to drop shows under the buttons", () => {
    const html = box({
      quickTokens: [{ symbol: "USDC", address: DEVNET_USDC, name: "USD Coin", logo: null }],
      mintText: DEVNET_USDC,
      check: CHECK,
    });
    expect(html).toContain("ok to drop");
    expect(html.indexOf(">USDC<")).toBeLessThan(html.indexOf("ok to drop"));
  });

  it("a tap fills the exact address, like a paste", () => {
    const filled: string[] = [];
    const tree = StableButtons({
      tokens: [USDC, USDT],
      mintText: "",
      onPick: (text) => filled.push(text),
    });
    const buttons = elements(tree).filter((el) => el.type === "button");
    expect(buttons).toHaveLength(2);
    (buttons[1]?.props["onClick"] as () => void)();
    expect(filled).toEqual([USDT.address]);
  });
});

describe("token", () => {
  it("the paste box only: no quick token buttons and no or pick one", () => {
    const html = box({ asset: "token" });
    expect(html).toContain("paste a token address");
    expect(html).not.toContain("or pick one");
    expect(html).not.toContain(">USDC<");
    expect(html).not.toContain(">USDT<");
  });
});

describe("the form", () => {
  it("stable is a token drop: the same check, the same token rules", () => {
    const v = view(
      run(
        { type: "asset", value: "stable" },
        { type: "mintText", value: DEVNET_USDC },
        { type: "tokenCheck", result: { forMint: DEVNET_USDC, check: CHECK } },
      ),
    );
    expect(v.tokenChosen).toBe(true);
    expect(v.asset).toBe(DEVNET_USDC);
  });

  it("before a pick the grey line says pick a stable first; token still says paste", () => {
    expect(view(run({ type: "asset", value: "stable" })).receiversHint).toBe(
      "one per line: an X handle, then amount. pick a stable first.",
    );
    expect(view(run({ type: "asset", value: "token" })).receiversHint).toBe(
      "one per line: an X handle, then amount. paste a token first.",
    );
  });

  it("moving between stable and token empties the address and the check", () => {
    const picked = run(
      { type: "asset", value: "stable" },
      { type: "mintText", value: DEVNET_USDC },
      { type: "tokenCheck", result: { forMint: DEVNET_USDC, check: CHECK } },
    );
    const toToken = reduceForm(picked, { type: "asset", value: "token" });
    expect(toToken.asset).toBe("token");
    expect(toToken.mintText).toBe("");
    expect(toToken.tokenCheck).toBeNull();

    const pasted = reduceForm(toToken, { type: "mintText", value: DEVNET_USDC });
    const toStable = reduceForm(pasted, { type: "asset", value: "stable" });
    expect(toStable.asset).toBe("stable");
    expect(toStable.mintText).toBe("");
  });

  it("back to the coin clears the token, as before", () => {
    const back = reduceForm(
      run({ type: "asset", value: "stable" }, { type: "mintText", value: DEVNET_USDC }),
      {
        type: "asset",
        value: "native",
      },
    );
    expect(back.asset).toBe("native");
    expect(back.mintText).toBe("");
  });
});
