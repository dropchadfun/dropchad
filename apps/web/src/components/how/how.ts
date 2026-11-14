/**
 * The words and the facts of the how it works page, `/how`.
 * Simple words. Every fact here is true on chain or in the api today:
 *
 * - 3 days to claim and 1 hour to fund: `CLAIM_PERIOD_SECONDS`, `FUNDING_PERIOD_SECONDS` in the
 *   api.
 * - The fees are never written here: `feeLines` reads them from `GET /api/chains`.
 */
import type { ChainInfo } from "@/lib/api";
import { DROP_CAP_LINES } from "@/lib/beta";
import { liveMainnetKeys, TESTNET_ONLY } from "@/lib/chains";
import { formatAmount } from "@/lib/format";

/** The chains `/how` can name, Solana first, as everywhere on the site. */
export type HowChain = "solana" | "robinhood";
const HOW_ORDER: readonly HowChain[] = ["solana", "robinhood"];

/**
 * The chains `/how` names: both on a testnet build, the live
 * mainnet chains on a mainnet build. A chain's words show by themselves once it is live.
 */
export function howChains(testnetOnly: boolean, liveKeys: readonly string[]): HowChain[] {
  return testnetOnly ? [...HOW_ORDER] : HOW_ORDER.filter((key) => liveKeys.includes(key));
}

/** This build's chains, from the registry, the same test as the beta card. */
export const HOW_CHAINS: readonly HowChain[] = howChains(TESTNET_ONLY, liveMainnetKeys());

const COIN: Readonly<Record<HowChain, string>> = { solana: "SOL", robinhood: "ETH" };
const NAME: Readonly<Record<HowChain, string>> = { solana: "Solana", robinhood: "Robinhood" };

/** `a`, `a or b`, `a, b or c`. */
function orList(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1] ?? ""}`;
}

const has = (chains: readonly HowChain[], key: HowChain) => chains.includes(key);
const coins = (chains: readonly HowChain[]) => chains.map((key) => COIN[key]);

/**
 * Why dropchad, the words, one sentence per line, in three groups:
 * the problem, dropchad, a memecoin.
 */
export const WHY_GROUPS: readonly (readonly string[])[] = [
  [
    "be honest, everyone on X says i will airdrop someone, just for likes.",
    "after that nobody knows if anyone got paid.",
  ],
  [
    "on dropchad every drop is onchain.",
    "people see who really pays.",
    "boards show the real givers.",
    "based af.",
    "people notice you and follow you.",
  ],
  [
    "launched a memecoin? drop it to your holders or to people who did good work.",
    "they get paid, you get attention.",
  ],
];

/**
 * What you can do, three cards, the words. `chains`
 * are the chain rail tiles a card shows (`chainPills` keys); none means the lucide icon.
 */
export interface CanCard {
  readonly key: "drop" | "token" | "multisend";
  readonly title: string;
  readonly text: string;
  readonly chains: readonly HowChain[];
}

export function canCards(chains: readonly HowChain[]): CanCard[] {
  const send = orList(chains.map((key) => `${COIN[key]} on ${NAME[key]}`));
  return [
    {
      key: "drop",
      title: "drop",
      text: `send ${send} to people by their X name. they sign in with X and claim.`,
      chains: [...chains],
    },
    {
      key: "token",
      title: "token drop",
      text: "drop your own token, like a memecoin you launched, to X names. reward your holders or people who helped you.",
      chains: [...chains],
    },
    {
      key: "multisend",
      title: "multisend",
      text: "already have a list of wallet addresses? pay them all at once. no X needed.",
      chains: [],
    },
  ];
}

export const CAN: readonly CanCard[] = canCards(HOW_CHAINS);

/** Coming next, no dates. */
export const NEXT: readonly string[] = ["streamer drops", "badge drops", "more chains", "more fun"];

/** The `tested in public` line: 46 days in public. */
export const TESTED_LINE =
  "dropchad was tested in public on testnet for over 6 weeks before mainnet";

/** One numbered step. */
export interface Step {
  readonly text: string;
}

export function sendSteps(chains: readonly HowChain[]): Step[] {
  return [
    { text: `pick the chain: ${orList(chains.map((key) => NAME[key]))}.` },
    { text: `pick what to send: ${orList([...coins(chains), "a token"])}.` },
    { text: "type the X names and the amount for each person." },
    { text: "send the money to one drop address, from any wallet." },
    { text: "it goes live by itself. people see it right away." },
  ];
}

export const SEND_STEPS: readonly Step[] = sendSteps(HOW_CHAINS);

export const CLAIM_STEPS: readonly Step[] = [
  { text: "sign in with X." },
  { text: "paste any wallet address." },
  { text: "claim. the money goes to that wallet." },
];

export const SAFE_LINES: readonly string[] = [
  "every drop is its own contract.",
  "money goes only to the people on the list, or back to the sender.",
  "what people do not claim comes back after 3 days.",
  "admins cannot touch a drop, us included.",
  "risky tokens are refused: tokens that can be frozen or changed later.",
];

/** The coins of the live chains in one phrase: `SOL`, `SOL and ETH`. */
function coinsAnd(chains: readonly HowChain[]): string {
  return coins(chains).join(" and ");
}

/** The beta caps of the live chains' coins, then the stablecoins. */
function betaLimit(chains: readonly HowChain[]): string {
  return `during the beta, up to ${orList([...chains.map((key) => DROP_CAP_LINES[key][0]), "200 of a stablecoin"])} per drop`;
}

export interface Question {
  readonly q: string;
  readonly lines: readonly string[];
}

/**
 * The questions: these words exactly, in this order, no testnet answer.
 * Each answer is short lines, one line each. The chain words name the live chains only.
 */
export function faqFor(chains: readonly HowChain[]): Question[] {
  return [
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
        ...(has(chains, "solana")
          ? [
              "on Solana you can drop SOL, USDC, USDT and most Solana tokens, like memecoins or project tokens",
            ]
          : []),
        ...(has(chains, "robinhood")
          ? [
              "on Robinhood Chain you can drop ETH, USDG and most Robinhood Chain tokens, like memecoins or project tokens",
            ]
          : []),
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
        `${orList(coins(chains))} only, 1 hour to fund`,
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
        `1% on ${coinsAnd(chains)} drops`,
        "a small flat fee on token drops",
        "claiming is free, we pay the gas",
        "the create page shows the exact fee before you pay",
      ],
    },
    {
      q: "are there limits",
      lines: ["up to 500 people per drop", "at least 1 usd per person", betaLimit(chains)],
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
}

export const FAQ: readonly Question[] = faqFor(HOW_CHAINS);

/** The line over the token fee tiers. */
export function tokenTierNote(chains: readonly HowChain[]): string {
  return `token drops: a flat fee by the number of people, paid in ${orList(coins(chains))}.`;
}

/** Solana first, as everywhere on the site. */
const COIN_ORDER = ["svm", "evm"] as const;

/**
 * The fee lines, from the api's own numbers: one line per chain that answered, then the token
 * tiers. `null` when nothing answered: the page then points to the create page, never a guess.
 *
 * `SOL drops: 1%, at least 0.0003 SOL per person, at most 0.5 SOL per
 * drop.` A minimum per person of 0, or an api without it, shows the old flat minimum as before; a
 * max fee of 0 is no cap, so no `at most` part. A `null` number is a chain that did not answer.
 */
export function feeLines(
  chains: readonly ChainInfo[] | null,
): { coins: string[]; tiers: string[] } | null {
  if (chains === null) return null;
  const answered = chains
    .filter(
      (chain) =>
        chain.defaultFeeBps !== null &&
        chain.minFee !== null &&
        chain.minFeePerReceiver !== null &&
        chain.maxFee !== null,
    )
    .sort((a, b) => COIN_ORDER.indexOf(a.family) - COIN_ORDER.indexOf(b.family));
  const coins = answered.map((chain) => {
    const coin = (amount: string) =>
      `${formatAmount(amount, chain.decimals, 6)} ${chain.nativeSymbol}`;
    const percent = `${String((chain.defaultFeeBps ?? 0) / 100)}%`;
    const perPerson = chain.minFeePerReceiver ?? "0";
    const maxFee = chain.maxFee ?? "0";
    const minimum =
      BigInt(perPerson) > 0n ? `${coin(perPerson)} per person` : coin(chain.minFee ?? "0");
    const cap = BigInt(maxFee) > 0n ? `, at most ${coin(maxFee)} per drop` : "";
    return `${chain.nativeSymbol} drops: ${percent}, at least ${minimum}${cap}.`;
  });
  const tiers =
    chains
      .find((chain) => (chain.tokenFeeTiers?.length ?? 0) > 0)
      ?.tokenFeeTiers?.map((tier) => `up to ${String(tier.upTo)} people: $${tier.usd}`) ?? [];
  if (coins.length === 0 && tiers.length === 0) return null;
  return { coins, tiers };
}
