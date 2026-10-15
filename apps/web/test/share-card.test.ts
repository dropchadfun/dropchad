/**
 * The share card, first version, the logic only.
 * `components/drops/share-card.ts`. The drawing itself is checked with screenshots: node has no
 * canvas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CARD_DESIGNS,
  CARD_HEIGHT,
  CARD_WIDTH,
  NAME_LIST_MAX,
  acceptUpload,
  CARD_AMOUNT_SIZES,
  cardAmountSize,
  cardChain,
  cardShortAmount,
  CARD_CLAIM_LINE,
  chadsLine,
  fitNames,
  nameMode,
  postIntentUrl,
  postText,
  rankLabel,
  sharePath,
  showShareCard,
  type ShareCardData,
} from "@/components/drops/share-card";

const r = (handle: string) => ({ handle, profileImageUrl: null });

function card(overrides: Partial<ShareCardData> = {}): ShareCardData {
  return {
    chainKey: "solana-devnet",
    symbol: "SOL",
    decimals: 9,
    amount: "500000000",
    people: 12,
    sender: { handle: "samplechad", profileImageUrl: null },
    receivers: [r("alice"), r("bob"), r("carol")],
    rest: 9,
    rank: null,
    ...overrides,
  };
}

describe("who sees the card", () => {
  it("the sender of a live handle drop", () => {
    for (const state of ["active", "paying", "finished", "claims_expired"]) {
      expect(showShareCard({ mode: "handle", yours: true, state }), state).toBe(true);
    }
  });

  it("never a multisend, never someone else, never before it is live", () => {
    expect(showShareCard({ mode: "address", yours: true, state: "active" })).toBe(false);
    expect(showShareCard({ mode: "handle", yours: false, state: "active" })).toBe(false);
    for (const state of ["created", "funded", "funding_expired"]) {
      expect(showShareCard({ mode: "handle", yours: true, state }), state).toBe(false);
    }
  });
});

describe("the post text", () => {
  // every listed receiver is named, `and N more`
  // only for the ones the api cannot list (`rest`), and the post ends `no wallet connection
  // needed to claim.` The tests here are on mainnet Solana; the testnet words are below.
  const main = (overrides: Partial<ShareCardData> = {}) =>
    card({ chainKey: "solana", ...overrides });
  const CLAIM = "they claim with their X, no wallet connection needed to claim.";

  it("just dropped, the amount and coin, every listed name, the rest, on dropchad, the claim line", () => {
    expect(postText(main())).toBe(
      `just dropped 0.5 SOL to @alice @bob @carol and 9 more on dropchad 🤌 ${CLAIM}`,
    );
  });

  it("the owner's examples: one receiver as before, more receivers every name", () => {
    const one = main({ amount: "1000000000", people: 1, receivers: [r("name")], rest: 0 });
    expect(postText(one)).toBe(`just dropped 1 SOL to @name on dropchad 🤌 ${CLAIM}`);
    expect(postText(main({ people: 3, rest: 0 }))).toBe(
      `just dropped 0.5 SOL to @alice @bob @carol on dropchad 🤌 ${CLAIM}`,
    );
    expect(
      postText(main({ amount: "10000000", people: 1, receivers: [r("dropchadfun")], rest: 0 })),
    ).toBe(`just dropped 0.01 SOL to @dropchadfun on dropchad 🤌 ${CLAIM}`);
  });

  it("and N more only for the receivers the api cannot list", () => {
    expect(postText(main({ people: 2, receivers: [r("alice"), r("bob")], rest: 0 }))).not.toContain(
      "more",
    );
    expect(postText(main({ people: 4, receivers: [r("alice")], rest: 3 }))).toBe(
      `just dropped 0.5 SOL to @alice and 3 more on dropchad 🤌 ${CLAIM}`,
    );
  });

  it("never the old words", () => {
    for (const t of [postText(main()), postText(main({ receivers: [] }))]) {
      expect(t.startsWith("sent ")).toBe(false);
      expect(t).not.toContain("sign in with X to claim");
      expect(t).not.toContain("no wallet needed");
    }
  });

  it("no handle known: the number of people instead", () => {
    expect(postText(main({ receivers: [], rest: 12 }))).toBe(
      `just dropped 0.5 SOL to 12 people on dropchad 🤌 ${CLAIM}`,
    );
    expect(postText(main({ people: 1, receivers: [], rest: 1 }))).toBe(
      `just dropped 0.5 SOL to 1 person on dropchad 🤌 ${CLAIM}`,
    );
  });

  it("the exact amount, like send this amount: every decimal, no comma", () => {
    expect(postText(main({ amount: "12500000001" }))).toContain("just dropped 12.500000001 SOL");
    expect(
      postText(main({ symbol: "ETH", decimals: 18, amount: "1234500000000000000000" })),
    ).toContain("just dropped 1234.5 ETH");
  });

  it("30 names on the card, 30 in the post", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => r(`chad${String(i)}`));
    const text = postText(main({ people: 30, receivers: thirty, rest: 0 }));
    expect(text).toBe(
      `just dropped 0.5 SOL to ${thirty.map((p) => `@${p.handle}`).join(" ")} on dropchad 🤌 ${CLAIM}`,
    );
  });

  it("500 names: every one, no length cut, never starts with @, no link, never airdropped", () => {
    const all = Array.from({ length: 500 }, (_, i) => r(`chad${String(i)}`));
    const text = postText(main({ people: 500, receivers: all, rest: 0 }));
    expect(text.match(/@/g)).toHaveLength(500);
    expect(text).toContain("@chad0 @chad1 ");
    expect(text).toContain(`@chad499 on dropchad 🤌 ${CLAIM}`);
    expect(text).not.toContain("more");
    expect(text.length).toBeGreaterThan(280);
    for (const t of [text, postText(main()), postText(main({ receivers: [] }))]) {
      expect(t.startsWith("@")).toBe(false);
      expect(t).not.toContain("airdropped");
      expect(t).not.toMatch(/https?:|dropchad\.fun|www\./);
    }
  });
});

describe("the post text on a testnet drop", () => {
  // the drop's own chain decides. `test SOL` or
  // `test ETH`, `on dropchad testnet`; a token keeps its ticker.
  const CLAIM = "they claim with their X, no wallet connection needed to claim.";

  it("Solana devnet: test SOL, on dropchad testnet", () => {
    expect(
      postText(card({ amount: "100000000", people: 1, receivers: [r("name")], rest: 0 })),
    ).toBe(`just dropped 0.1 test SOL to @name on dropchad testnet 🤌 ${CLAIM}`);
  });

  it("Robinhood testnet: test ETH, on dropchad testnet", () => {
    expect(
      postText(
        card({
          chainKey: "robinhood-testnet",
          symbol: "ETH",
          decimals: 18,
          amount: "1000000000000000",
          people: 3,
          rest: 0,
        }),
      ),
    ).toBe(`just dropped 0.001 test ETH to @alice @bob @carol on dropchad testnet 🤌 ${CLAIM}`);
  });

  it("mainnet never says test or testnet", () => {
    for (const chainKey of ["solana", "robinhood"]) {
      const t = postText(card({ chainKey, people: 3, rest: 0 }));
      expect(t, chainKey).not.toContain("test");
    }
  });
});

describe("the post text, the rest", () => {
  it("the X link carries the text only, never a url parameter", () => {
    const url = new URL(postIntentUrl("just dropped 0.5 SOL on @alice on dropchad"));
    expect(url.origin + url.pathname).toBe("https://x.com/intent/post");
    expect(url.searchParams.get("text")).toBe("just dropped 0.5 SOL on @alice on dropchad");
    expect(url.searchParams.has("url")).toBe(false);
  });
});

describe("the card itself", () => {
  it("is 1600 by 900", () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1600, 900]);
  });

  it("three designs to pick from", () => {
    expect(CARD_DESIGNS.map((d) => d.id)).toEqual(["clean", "center", "fun"]);
  });

  it("the bar is never bigger than on card-fun-500: 96px at most, smaller only to fit", () => {
    expect(CARD_AMOUNT_SIZES[0]).toBe(96);
    // A width function standing in for the canvas: 0.6 of the font size per character.
    const measure = (text: string, px: number) => text.length * px * 0.6;
    expect(cardAmountSize("0.5 SOL", 1000, measure)).toBe(96);
    expect(cardAmountSize("25.12 SOL", 1000, measure)).toBe(96);
    expect(cardAmountSize("1,234,567.89 SOL", 700, measure)).toBe(64);
  });

  it("the amount is short and readable: 2 decimals, never 0 for a small amount", () => {
    expect(cardShortAmount(card({ amount: "25123456789" }))).toBe("25.12 SOL");
    expect(cardShortAmount(card({ amount: "500000000" }))).toBe("0.5 SOL");
    expect(cardShortAmount(card({ amount: "2500000" }))).toBe("0.0025 SOL");
    expect(cardShortAmount(card({ amount: "1" }))).toBe("0.000000001 SOL");
    expect(
      cardShortAmount(card({ symbol: "ETH", decimals: 18, amount: "1200000000000000000" })),
    ).toBe("1.2 ETH");
    expect(
      cardShortAmount(card({ symbol: "ETH", decimals: 18, amount: "123456789012345678" })),
    ).toBe("0.12 ETH");
  });

  it("the chain's own logo goes in the bar: a Robinhood drop shows Robinhood, never ETH", () => {
    expect(cardChain("robinhood-testnet")).toEqual({
      key: "robinhood",
      name: "Robinhood",
      logo: "/chains/robinhood.svg",
    });
    expect(cardChain("solana-devnet")).toEqual({
      key: "solana",
      name: "Solana",
      logo: "/chains/solana.svg",
    });
    expect(cardChain("nowhere")).toBeNull();
  });

  it("sent to N chads on the chain, never airdropped or dropped on, the number and the word never split", () => {
    expect(chadsLine(12, "Solana")).toBe("sent to 12\u00a0chads on Solana");
    expect(chadsLine(1, "Solana")).toBe("sent to 1\u00a0chad on Solana");
    expect(chadsLine(1, "Robinhood")).toBe("sent to 1\u00a0chad on Robinhood");
    expect(chadsLine(500, "Solana")).toBe("sent to 500\u00a0chads on Solana");
    expect(chadsLine(3, null)).toBe("sent to 3\u00a0chads");
    expect(chadsLine(12, "Solana")).not.toMatch(/airdropped|dropped on/);
  });

  it("one small line under the names, drawn on every card", () => {
    expect(CARD_CLAIM_LINE).toBe("claim with X, no wallet connection needed");
    const source = readFileSync(
      join(import.meta.dirname, "..", "src", "components", "drops", "ShareCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/fillText\(CARD_CLAIM_LINE/);
  });

  it("draws dropchad.com, the main domain, never dropchad.fun", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "src", "components", "drops", "ShareCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/fillText\("dropchad\.com"/);
    expect(source).not.toContain("dropchad.fun");
  });
});

describe("the names", () => {
  it("up to 30 a list, from 31 a name wall", () => {
    expect(NAME_LIST_MAX).toBe(30);
    expect(nameMode(1)).toBe("list");
    expect(nameMode(30)).toBe("list");
    expect(nameMode(31)).toBe("wall");
    expect(nameMode(500)).toBe("wall");
    expect(nameMode(0)).toBe("none");
  });

  const measure = (text: string, px: number) => text.length * px * 0.6;
  const handles = (n: number) =>
    Array.from({ length: n }, (_, i) => `@longhandle${String(i).padStart(4, "0")}`);

  it("the list: 30 long handles fit a 620 by 520 box and stay readable, 20px or more", () => {
    const fit = fitNames(handles(30), { width: 620, height: 520 }, measure, { max: 40, min: 20 });
    expect(fit.px).toBeGreaterThanOrEqual(20);
    expect(fit.fits).toBe(true);
    expect(fit.lines.flat()).toEqual(handles(30));
  });

  it("one name gets the biggest size", () => {
    const fit = fitNames(["@alice"], { width: 620, height: 520 }, measure, { max: 40, min: 20 });
    expect(fit.px).toBe(40);
    expect(fit.lines).toEqual([["@alice"]]);
  });

  it("the wall: 500 handles fill the card, small, and not one is dropped", () => {
    const fit = fitNames(handles(500), { width: 1600, height: 900 }, measure, { max: 40, min: 8 });
    expect(fit.fits).toBe(true);
    expect(fit.px).toBeGreaterThanOrEqual(8);
    expect(fit.px).toBeLessThan(20);
    expect(fit.lines.flat()).toEqual(handles(500));
    // Every line fits the width.
    for (const line of fit.lines) {
      expect(measure(line.join("  "), fit.px)).toBeLessThanOrEqual(1600);
    }
  });

  it("a fuller wall uses bigger names than a full one", () => {
    const box = { width: 1600, height: 900 };
    const few = fitNames(handles(40), box, measure, { max: 40, min: 8 });
    const many = fitNames(handles(500), box, measure, { max: 40, min: 8 });
    expect(few.px).toBeGreaterThan(many.px);
  });
});

describe("the rank word, kept for later, not drawn now", () => {
  it("chad, gigachad, whale drop; no price, no stamp", () => {
    expect(rankLabel("chad")).toBe("chad drop");
    expect(rankLabel("gigachad")).toBe("gigachad drop");
    expect(rankLabel("whale")).toBe("whale drop");
    expect(rankLabel(null)).toBeNull();
  });
});

describe("the picture the sender picks", () => {
  it("an image up to 10 MB, anything else refused", () => {
    expect(acceptUpload({ type: "image/jpeg", size: 2_000_000 })).toBe(true);
    expect(acceptUpload({ type: "image/png", size: 10 * 1024 * 1024 })).toBe(true);
    expect(acceptUpload({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBe(false);
    expect(acceptUpload({ type: "application/pdf", size: 1000 })).toBe(false);
  });

  it("a GIF is taken; the card draws its first frame", () => {
    expect(acceptUpload({ type: "image/gif", size: 3_000_000 })).toBe(true);
  });
});

describe("how post on X goes out", () => {
  it("the share sheet when the phone can share a file, else download and X with the text", () => {
    expect(sharePath({ canShareFiles: true })).toBe("share-sheet");
    expect(sharePath({ canShareFiles: false })).toBe("download-and-intent");
  });
});
