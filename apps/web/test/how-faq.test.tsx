/**
 * The `/how` questions: 20 questions in order, these words exactly, each
 * question bold, each answer line its own line. One version, no testnet answer. Rendered with
 * `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HowPage } from "@/components/how/HowPage";
import { FAQ, faqFor } from "@/components/how/how";

/** The words with Solana and Robinhood both live; Solana alone in `how-live-chains.test.tsx`. */
const EXPECTED: { q: string; lines: string[] }[] = [
  {
    q: "what is dropchad",
    lines: ["send coins to anyone by their X name", "they claim with X login, no wallet connect"],
  },
  {
    q: "what can I do on dropchad",
    lines: [
      "make a drop to X names, people claim with X login",
      "send to many wallets at once with multisend",
      "claim drops sent to you",
      "see who gives the most on the boards",
    ],
  },
  {
    q: "which chains and coins",
    lines: [
      "on Solana you can drop SOL, USDC, USDT and most Solana tokens, like memecoins or project tokens",
      "on Robinhood Chain you can drop ETH, USDG and most Robinhood Chain tokens, like memecoins or project tokens",
      "risky tokens, ones that can be frozen or changed later, are refused",
    ],
  },
  {
    q: "how do I make a drop",
    lines: [
      "pick the chain and the coin",
      "add the X names and how much each gets",
      "send the coins from your own wallet",
      "share the drop link",
    ],
  },
  {
    q: "how do I claim",
    lines: [
      "log in with X",
      "paste your wallet address",
      "the coins come to your wallet, claiming is free",
    ],
  },
  {
    q: "do the people I drop to need a wallet",
    lines: ["no, they only need an X account", "they add a wallet when they claim"],
  },
  {
    q: "what is multisend",
    lines: [
      "a fast way to pay many wallets at once",
      "paste the wallet addresses and amounts, fund it one time, and every wallet gets paid, nobody has to claim",
      "good for paying a team or a list of holders",
      "SOL or ETH only, 1 hour to fund",
      "if a payment fails or you send too much, the rest goes back to your refund wallet after 3 days",
    ],
  },
  {
    q: "do I need to connect a wallet",
    lines: ["no, never", "you send to the drop address from your own wallet"],
  },
  { q: "which wallets work", lines: ["Phantom, MetaMask or any wallet that can send"] },
  {
    q: "how long do I have to fund a drop",
    lines: ["1 hour", "if not funded, it closes by itself"],
  },
  {
    q: "how long can people claim",
    lines: ["3 days", "after that the rest goes back to your refund wallet"],
  },
  {
    q: "what if I send after the drop closed",
    lines: ["your coins are not lost", "message us on X and we send them back"],
  },
  {
    q: "what does it cost",
    lines: [
      "1% on SOL and ETH drops",
      "a small flat fee on token drops",
      "claiming is free, we pay the gas",
      "the create page shows the exact fee before you pay",
    ],
  },
  {
    q: "are there limits",
    lines: [
      "up to 500 people per drop",
      "at least 1 usd per person",
      "during the beta, up to 2 SOL, 0.1 ETH or 200 of a stablecoin per drop",
    ],
  },
  {
    q: "what are the boards",
    lines: [
      "they show who really gives",
      "ranked by how many people got paid and how much was dropped",
    ],
  },
  {
    q: "why X",
    lines: ["your X name is who you are in crypto", "no wallet hunting, just drop to the name"],
  },
  {
    q: "my X account got suspended",
    lines: [
      "if X does not let you log in, you can not claim",
      "unclaimed coins go back to the sender after 3 days",
      "what you already claimed stays in your wallet",
    ],
  },
  {
    q: "my X account got hacked",
    lines: [
      "whoever controls your X can claim drops sent to you",
      "coins on chain can not be pulled back",
      "keep 2FA on your X",
    ],
  },
  {
    q: "does dropchad hold my coins",
    lines: [
      "no",
      "coins sit in the drop on chain until people claim or they go back to the sender",
    ],
  },
  {
    q: "will dropchad DM me",
    lines: ["we never DM first", "we never ask for keys or seed words"],
  },
];

const html = renderToStaticMarkup(<HowPage chains={null} />);
/** The questions block alone: from its list to the end of the page. */
const block = html.slice(html.indexOf("<dl data-faq"));
/** Text the way React escapes it in the markup. */
const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("the /how questions", () => {
  it("are the 20 questions in order, these words exactly", () => {
    expect(faqFor(["solana", "robinhood"])).toEqual(EXPECTED);
  });

  it("draws each question bold, in its own dt, in order", () => {
    expect(html).toContain("<dl data-faq");
    const questions = [...block.matchAll(/<dt class="([^"]*)">([^<]*)<\/dt>/g)];
    expect(questions.map((match) => match[2])).toEqual(FAQ.map((item) => escaped(item.q)));
    for (const match of questions) expect(match[1]).toContain("font-semibold");
  });

  it("draws each answer line as its own list item, with space between the lines", () => {
    const answers = [...block.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(
      (match) => match[1] ?? "",
    );
    expect(answers).toHaveLength(FAQ.length);
    for (const [i, item] of FAQ.entries()) {
      const answer = answers[i] ?? "";
      expect(answer).toMatch(/^<ul class="[^"]*space-y-/);
      const lines = [...answer.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((match) => match[1]);
      expect(lines, item.q).toEqual(item.lines.map(escaped));
    }
  });

  it("keeps none of the old answers and no testnet answer", () => {
    for (const old of [
      "is this real money?",
      "what if someone never claims?",
      "what if I do not fund the drop?",
      "devnet",
    ]) {
      expect(block).not.toContain(old);
    }
    expect(FAQ.flatMap((item) => [item.q, ...item.lines]).join(" ")).not.toMatch(/testnet/i);
  });
});
