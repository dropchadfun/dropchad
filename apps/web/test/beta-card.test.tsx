/**
 * The beta card: mainnet only, the first visit,
 * once per browser, a small card at the bottom, never a modal. The cap lines are those of the
 * live mainnet chains only, from the one cap list per chain that `DROP_CAPS` is built from.
 * Never in the server HTML. Rendered with `react-dom/server`, no browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  chains,
  hasV6Contracts,
  hasV7Contracts,
  isDeployed,
  isProgramDeployed,
  isTestnetOnly,
} from "@dropchad/chains";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** A storage with only the two calls the card uses. */
function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    size: () => map.size,
  };
}
const broken = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the cap list, one per chain", () => {
  it("Solana and Robinhood, one cap per line", async () => {
    const { DROP_CAP_LINES } = await import("@/lib/beta");
    expect(DROP_CAP_LINES).toEqual({
      solana: ["2 SOL", "200 USDC", "200 USDT", "200 USD1"],
      robinhood: ["0.1 ETH", "200 USDG"],
    });
  });

  it("the DROP_CAPS words are built from it and stay the same", async () => {
    const { DROP_CAPS } = await import("@/lib/beta");
    expect(DROP_CAPS).toBe(
      "2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana", // the live chains, Solana alone
    );
    expect(read("lib/beta.ts")).toMatch(/DROP_CAPS\s*=[^;]*DROP_CAP_LINES/);
  });

  it("the card lists only the live chains, Solana first", async () => {
    const { betaCardCaps } = await import("@/lib/beta");
    expect(betaCardCaps(["solana"])).toEqual(["2 SOL", "200 USDC", "200 USDT", "200 USD1"]);
    expect(betaCardCaps(["robinhood"])).toEqual(["0.1 ETH", "200 USDG"]);
    expect(betaCardCaps(["robinhood", "solana"])).toEqual([
      "2 SOL",
      "200 USDC",
      "200 USDT",
      "200 USD1",
      "0.1 ETH",
      "200 USDG",
    ]);
    expect(betaCardCaps([])).toEqual([]);
    expect(betaCardCaps(["solana-devnet", "unknown"])).toEqual([]);
  });
});

describe("the live mainnet chains, the same test as isTestnetOnly()", () => {
  it("a mainnet chain with its contracts or program recorded, nothing else", async () => {
    const { liveMainnetKeys } = await import("@/lib/chains");
    const expected = chains
      .filter(
        (chain) =>
          chain.kind === "mainnet" &&
          (isDeployed(chain) ||
            hasV6Contracts(chain) ||
            hasV7Contracts(chain) ||
            isProgramDeployed(chain)),
      )
      .map((chain) => chain.key);
    expect(liveMainnetKeys()).toEqual(expected);
    expect(liveMainnetKeys().length === 0).toBe(isTestnetOnly());
  });
});

describe("the words, exactly", () => {
  it("title, head and the tail lines", async () => {
    const { BETA_CARD_TITLE, BETA_CARD_HEAD, BETA_CARD_TAIL } = await import("@/lib/beta-card");
    expect(BETA_CARD_TITLE).toBe("dropchad beta 🤌");
    expect(BETA_CARD_HEAD).toBe("max per drop");
    expect(BETA_CARD_TAIL).toEqual([
      "memecoins, no limit",
      "we start small on purpose",
      "limits go up step by step",
    ]);
  });

  it("no line about losing money", async () => {
    const { BETA_CARD_TITLE, BETA_CARD_HEAD, BETA_CARD_TAIL } = await import("@/lib/beta-card");
    const all = [BETA_CARD_TITLE, BETA_CARD_HEAD, ...BETA_CARD_TAIL].join(" ");
    expect(all).not.toMatch(/lose|risk/);
  });
});

describe("remembered in the browser when it is closed, mainnet only", () => {
  it("a new browser on mainnet sees it", async () => {
    const { shouldShowBetaCard } = await import("@/lib/beta-card");
    expect(shouldShowBetaCard(memory(), false)).toBe(true);
  });

  it("showing it writes nothing, so a reload before closing shows it again", async () => {
    const { shouldShowBetaCard } = await import("@/lib/beta-card");
    const store = memory();
    shouldShowBetaCard(store, false);
    expect(store.size()).toBe(0);
    expect(shouldShowBetaCard(store, false)).toBe(true);
  });

  it("after it is closed it never shows again, under its own key", async () => {
    const { BETA_CARD_KEY, rememberBetaCard, shouldShowBetaCard } = await import("@/lib/beta-card");
    const { WELCOME_KEY } = await import("@/lib/welcome");
    expect(BETA_CARD_KEY).not.toBe(WELCOME_KEY);
    const store = memory();
    rememberBetaCard(store);
    expect(shouldShowBetaCard(store, false)).toBe(false);
  });

  it("no storage: it does not show, and closing does not throw", async () => {
    const { rememberBetaCard, shouldShowBetaCard } = await import("@/lib/beta-card");
    expect(shouldShowBetaCard(broken, false)).toBe(false);
    expect(() => rememberBetaCard(broken)).not.toThrow();
  });

  it("testnet only: never; the welcome popup and the card never show together", async () => {
    const { shouldShowBetaCard } = await import("@/lib/beta-card");
    const { shouldShowWelcome } = await import("@/lib/welcome");
    for (const testnetOnly of [true, false]) {
      const both =
        shouldShowBetaCard(memory(), testnetOnly) && shouldShowWelcome(memory(), testnetOnly);
      expect(both).toBe(false);
    }
    expect(shouldShowBetaCard(memory(), true)).toBe(false);
  });
});

describe("the card", () => {
  it("the title, the head, one cap per line, the tail and the two buttons", async () => {
    const { BetaCardBox } = await import("@/components/site/BetaCard");
    const html = renderToStaticMarkup(
      <BetaCardBox caps={["2 SOL", "200 USDC", "200 USDT"]} onClose={() => {}} />,
    );
    const order = [
      "dropchad beta 🤌",
      ">max per drop<",
      ">2 SOL<",
      ">200 USDC<",
      ">200 USDT<",
      ">memecoins, no limit<",
      ">we start small on purpose<",
      ">limits go up step by step<",
      ">got it<",
      ">terms<",
    ];
    let last = -1;
    for (const part of order) {
      const at = html.indexOf(part);
      expect(at, part).toBeGreaterThan(last);
      last = at;
    }
    expect(html).toContain('href="/terms"');
    expect(html).not.toContain("ETH");
  });

  it("a dialog with the popup's mint border and glow, exactly as wide as its text", async () => {
    const { BetaCardBox } = await import("@/components/site/BetaCard");
    const html = renderToStaticMarkup(<BetaCardBox caps={["2 SOL"]} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="beta-card-title"');
    expect(html).toContain("border-chad-accent");
    expect(html).toContain("welcome-glow");
    // As wide as its text, the same padding on both sides, never wider than the screen.
    expect(html).toContain("w-fit max-w-full");
    expect(html).toContain(" p-4 md:p-6");
    expect(html).not.toMatch(/(?<![\w-])w-full/);
    expect(html).not.toContain("max-w-80");
    expect(html).not.toContain("max-w-120");
    expect(html).not.toMatch(/\b(pr|pl|px)-/);
    expect(html).not.toContain("bottom-");
  });

  it("the two buttons under the text, side by side, from the left, on the phone and desktop", async () => {
    const { BetaCardBox } = await import("@/components/site/BetaCard");
    const html = renderToStaticMarkup(<BetaCardBox caps={["2 SOL"]} onClose={() => {}} />);
    expect(html).toMatch(/<div class="mt-5 flex gap-2"><button[^>]*>got it</);
    expect(html).not.toContain("flex-col");
    expect(html).not.toContain("justify-end");
    expect(html).not.toContain("flex-1");
  });

  it("in the middle of the screen over a dimmed page, like the welcome popup", () => {
    const src = read("components/site/BetaCard.tsx");
    expect(src).toContain("fixed inset-0 z-50 flex items-center justify-center bg-chad-bg/70 px-4");
  });

  it("the server HTML never carries it", async () => {
    const { BetaCard } = await import("@/components/site/BetaCard");
    expect(renderToStaticMarkup(<BetaCard />)).toBe("");
  });

  it("Escape and an outside click close it through the shared dismiss hook, every close remembered", () => {
    const src = read("components/site/BetaCard.tsx");
    expect(src).toContain('from "@/lib/dismiss"');
    expect(src).toContain("useDismiss(");
    expect(src).toContain("rememberBetaCard(");
    expect(src).toContain("liveMainnetKeys(");
  });

  it("on every page: the root layout renders it", () => {
    expect(read("app/layout.tsx")).toContain("<BetaCard />");
  });

  it("not in the share card", () => {
    expect(read("components/drops/ShareCard.tsx")).not.toContain("BetaCard");
  });
});
