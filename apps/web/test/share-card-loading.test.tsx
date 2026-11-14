/**
 * While the sender's card is not ready, one grey line `your cards are loading` with 3 moving
 * dots where the card will be.
 * It covers the wait for the drop to go live, the card facts and the card images; the
 * card replaces it. A wait that ends with no card shows nothing, as before. The real timing is
 * checked in a browser; here, the pure wait rule and the static markup.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CardsLoading, ShareCardEditor } from "@/components/drops/ShareCard";
import { shareCardWait, type ShareCardData } from "@/components/drops/share-card";

const LINE = "your cards are loading";

const CARD: ShareCardData = {
  chainKey: "solana-devnet",
  symbol: "SOL",
  decimals: 9,
  amount: "20000000",
  people: 2,
  sender: { handle: "samplesender", profileImageUrl: null },
  receivers: [
    { handle: "samplechad", profileImageUrl: null },
    { handle: "sampledev", profileImageUrl: null },
  ],
  rest: 0,
  rank: null,
};

const mine = (state: string) => ({ mode: "handle", yours: true, state });

describe("the wait rule", () => {
  it("is the card once the drop is live", () => {
    for (const state of ["active", "paying", "finished", "claims_expired"]) {
      expect(shareCardWait(mine(state))).toBe("card");
    }
  });

  it("waits while the sender's drop is on its way to live", () => {
    expect(shareCardWait(mine("created"))).toBe("wait");
    expect(shareCardWait(mine("funded"))).toBe("wait");
  });

  it("is nothing for a drop never funded", () => {
    expect(shareCardWait(mine("funding_expired"))).toBe("none");
  });

  it("is nothing for somebody else's drop, a multisend or no drop of ours", () => {
    expect(shareCardWait({ mode: "handle", yours: false, state: "created" })).toBe("none");
    expect(shareCardWait({ mode: "address", yours: true, state: "created" })).toBe("none");
    expect(shareCardWait(null)).toBe("none");
    expect(shareCardWait(undefined)).toBe("none");
  });
});

describe("the loading line", () => {
  const html = renderToStaticMarkup(<CardsLoading />);

  it("says your cards are loading, grey, 16px on the phone and 18px from md up", () => {
    expect(html).toContain(LINE);
    expect(html).toContain("text-[16px]");
    expect(html).toContain("md:text-[18px]");
    expect(html).toContain("text-chad-text-dim");
  });

  it("is a status for screen readers", () => {
    expect(html).toContain('role="status"');
  });

  it("has 3 moving dots, hidden from screen readers", () => {
    expect(html.split('class="loading-dot"></span>')).toHaveLength(4);
    expect(html).toContain('aria-hidden="true"');
  });

  it("covers the blank moment while the card images load", () => {
    // Static markup is the first paint: no image has loaded yet.
    const editor = renderToStaticMarkup(<ShareCardEditor card={CARD} />);
    expect(editor).toContain(LINE);
  });
});

describe("the wiring", () => {
  const src = join(import.meta.dirname, "..", "src");

  it("the loader shows the line while it waits", () => {
    const source = readFileSync(join(src, "components", "drops", "ShareCard.tsx"), "utf8");
    const loader = source.slice(source.indexOf("function ShareCardLoader"));
    expect(loader.slice(0, loader.indexOf("\n}\n"))).toMatch(/<CardsLoading \/>/);
    expect(source).toMatch(/shareCardWait\(/);
  });

  it("the line sits in the middle of the card's space, both ways", () => {
    const source = readFileSync(join(src, "components", "drops", "ShareCard.tsx"), "utf8");
    const loader = source.slice(source.indexOf("function ShareCardLoader"));
    const body = loader.slice(0, loader.indexOf("\n}\n"));
    expect(body).toMatch(
      /className="[^"]*aspect-video[^"]*max-w-\[640px\][^"]*items-center[^"]*justify-center[^"]*">\s*<CardsLoading \/>/,
    );
    expect(renderToStaticMarkup(<CardsLoading />)).toMatch(/justify-center[^"]*text-center/);
  });

  it("the dots move, and stand still with reduced motion", () => {
    const css = readFileSync(join(src, "app", "globals.css"), "utf8");
    expect(css).toMatch(/@keyframes loading-dot/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.loading-dot \{\s*animation: none;/,
    );
  });
});
