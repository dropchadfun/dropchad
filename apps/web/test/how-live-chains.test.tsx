/**
 * `/how` names only the live chains: on a mainnet build the
 * chains, Solana first; a testnet build keeps the words of both chains. A chain's words
 * show by themselves once it is live.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HowPage } from "@/components/how/HowPage";
import {
  CAN,
  FAQ,
  HOW_CHAINS,
  SEND_STEPS,
  canCards,
  faqFor,
  howChains,
  sendSteps,
  tokenTierNote,
} from "@/components/how/how";
import type { ChainInfo } from "@/lib/api";
import { TESTNET_ONLY, liveMainnetKeys } from "@/lib/chains";

const SOLANA = ["solana"] as const;
const BOTH = ["solana", "robinhood"] as const;

const answer = (faq: ReturnType<typeof faqFor>, q: string) =>
  faq.find((item) => item.q === q)?.lines ?? [];

describe("the chains /how names", () => {
  it("a testnet build: both chains", () => {
    expect(howChains(true, [])).toEqual(["solana", "robinhood"]);
  });

  it("a mainnet build: the live mainnet chains only, Solana first", () => {
    expect(howChains(false, ["solana"])).toEqual(["solana"]);
    expect(howChains(false, ["robinhood", "solana"])).toEqual(["solana", "robinhood"]);
  });

  it("this build reads the registry, the same test as the beta card", () => {
    expect(HOW_CHAINS).toEqual(howChains(TESTNET_ONLY, liveMainnetKeys()));
    expect(CAN).toEqual(canCards(HOW_CHAINS));
    expect(SEND_STEPS).toEqual(sendSteps(HOW_CHAINS));
    expect(FAQ).toEqual(faqFor(HOW_CHAINS));
  });
});

describe("Solana alone", () => {
  it("the drop card and the chain tiles", () => {
    const cards = canCards(SOLANA);
    expect(cards.find((c) => c.key === "drop")?.text).toBe(
      "send SOL on Solana to people by their X name. they sign in with X and claim.",
    );
    expect(cards.find((c) => c.key === "drop")?.chains).toEqual(["solana"]);
    expect(cards.find((c) => c.key === "token")?.chains).toEqual(["solana"]);
    expect(cards.find((c) => c.key === "multisend")?.chains).toEqual([]);
  });

  it("the first two steps", () => {
    expect(sendSteps(SOLANA).slice(0, 2)).toEqual([
      { text: "pick the chain: Solana." },
      { text: "pick what to send: SOL or a token." },
    ]);
  });

  it("the questions", () => {
    const faq = faqFor(SOLANA);
    expect(answer(faq, "which chains and coins")).toEqual([
      "on Solana you can drop SOL, USDC, USDT and most Solana tokens, like memecoins or project tokens",
      "risky tokens, ones that can be frozen or changed later, are refused",
    ]);
    expect(answer(faq, "what is multisend")).toContain("SOL only, 1 hour to fund");
    expect(answer(faq, "what does it cost")).toContain("1% on SOL drops");
    expect(answer(faq, "are there limits")).toContain(
      "during the beta, up to 2 SOL or 200 of a stablecoin per drop",
    );
    expect(faq.map((item) => item.q)).toEqual(faqFor(BOTH).map((item) => item.q));
  });

  it("the token fee note", () => {
    expect(tokenTierNote(SOLANA)).toBe(
      "token drops: a flat fee by the number of people, paid in SOL.",
    );
  });
});

describe("Solana and Robinhood", () => {
  it("the words of both chains, as before", () => {
    expect(canCards(BOTH).find((c) => c.key === "drop")?.text).toBe(
      "send SOL on Solana or ETH on Robinhood to people by their X name. they sign in with X and claim.",
    );
    expect(canCards(BOTH).find((c) => c.key === "token")?.chains).toEqual(["solana", "robinhood"]);
    expect(sendSteps(BOTH).slice(0, 2)).toEqual([
      { text: "pick the chain: Solana or Robinhood." },
      { text: "pick what to send: SOL, ETH or a token." },
    ]);
    const faq = faqFor(BOTH);
    expect(answer(faq, "what is multisend")).toContain("SOL or ETH only, 1 hour to fund");
    expect(answer(faq, "what does it cost")).toContain("1% on SOL and ETH drops");
    expect(answer(faq, "are there limits")).toContain(
      "during the beta, up to 2 SOL, 0.1 ETH or 200 of a stablecoin per drop",
    );
    expect(tokenTierNote(BOTH)).toBe(
      "token drops: a flat fee by the number of people, paid in SOL or ETH.",
    );
  });
});

/** `/api/chains` on a Solana only mainnet site, trimmed to what the page reads. */
const SOLANA_API: ChainInfo[] = [
  {
    key: "solana",
    chainId: 101,
    family: "svm",
    nativeSymbol: "SOL",
    decimals: 9,
    defaultFeeBps: 100,
    minFee: "0",
    minFeePerReceiver: "300000",
    maxFee: "500000000",
    handleMode: true,
    tokenFeeTiers: [{ upTo: 5, usd: "1", lamports: "12797543" }],
  },
];

describe("the page on this build", () => {
  it("names no chain that is not live", () => {
    const text = renderToStaticMarkup(<HowPage chains={SOLANA_API} />)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    if (!HOW_CHAINS.includes("robinhood")) {
      expect(text).not.toMatch(/Robinhood|\bETH\b|USDG|0\.1 ETH/);
      expect(text).toContain(tokenTierNote(HOW_CHAINS));
    }
  });
});
