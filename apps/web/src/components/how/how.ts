/**
 * The words and the facts of the how it works page, `/how`.
 * Simple words. Every fact here is true on chain or in the api today:
 *
 * - 7 days to claim and 24 hours to fund: `CLAIM_PERIOD_SECONDS`, `FUNDING_PERIOD_SECONDS` in the
 *   api.
 * - The fees are never written here: `feeLines` reads them from `GET /api/chains`.
 * - The testnet links and addresses were checked by hand: the Robinhood network on
 *   docs.robinhood.com/chain/add-network-to-wallet, Phantom testnet mode on docs.phantom.com, the
 *   Solana faucet (Solana Foundation), the three tokens through the live token check.
 */
import type { ChainInfo } from "@/lib/api";
import { formatAmount } from "@/lib/format";

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
export const CAN: readonly {
  readonly key: "drop" | "token" | "multisend";
  readonly title: string;
  readonly text: string;
  readonly chains: readonly ("solana" | "robinhood")[];
}[] = [
  {
    key: "drop",
    title: "drop",
    text: "send SOL on Solana or ETH on Robinhood to people by their X name. they sign in with X and claim.",
    chains: ["solana", "robinhood"],
  },
  {
    key: "token",
    title: "token drop",
    text: "drop your own token, like a memecoin you launched, to X names. reward your holders or people who helped you.",
    chains: ["solana", "robinhood"],
  },
  {
    key: "multisend",
    title: "multisend",
    text: "already have a list of wallet addresses? pay them all at once. no X needed.",
    chains: [],
  },
];

/** Coming next, no dates. */
export const NEXT: readonly string[] = ["streamer drops", "badge drops", "more chains", "more fun"];

/** One numbered step. */
export interface Step {
  readonly text: string;
}

export const SEND_STEPS: readonly Step[] = [
  { text: "pick the chain: Solana or Robinhood." },
  { text: "pick what to send: SOL, ETH or a token." },
  { text: "type the X names and the amount for each person." },
  { text: "send the money to one drop address, from any wallet." },
  { text: "it goes live by itself. people see it right away." },
];

export const CLAIM_STEPS: readonly Step[] = [
  { text: "sign in with X." },
  { text: "paste any wallet address." },
  { text: "claim. the money goes to that wallet." },
];

export const SAFE_LINES: readonly string[] = [
  "every drop is its own contract.",
  "money goes only to the people on the list, or back to the sender.",
  "what people do not claim comes back after 7 days.",
  "admins cannot touch a drop, us included.",
  "risky tokens are refused: tokens that can be frozen or changed later.",
];

export const FAQ: readonly { readonly q: string; readonly a: string }[] = [
  {
    q: "do people need a wallet before I drop?",
    a: "no. they need an X account. they add a wallet only when they claim.",
  },
  {
    q: "what if someone never claims?",
    a: "after 7 days, whatever is left goes back to the wallet you picked when you made the drop.",
  },
  {
    q: "what if I do not fund the drop?",
    a: "if it is not fully funded in 24 hours, it is called off and anything you sent goes back to your refund address.",
  },
  {
    q: "which wallets work?",
    a: "any wallet that can send to an address. Phantom and MetaMask work.",
  },
  {
    q: "is this real money?",
    a: "not yet. dropchad runs on Solana devnet and Robinhood testnet. test coins have no value.",
  },
  {
    q: "why X?",
    a: "most crypto people are on X. a username is easier to share than a wallet address.",
  },
];

/** The testnet facts, checked by hand. */
export const TESTNET = {
  solana: {
    phantomPath: "Settings → Developer Settings → Testnet Mode",
    network: "Solana Devnet",
    faucet: { href: "https://faucet.solana.com", label: "faucet.solana.com" },
  },
  robinhood: {
    network: {
      name: "Robinhood Chain Testnet",
      rpc: "https://rpc.testnet.chain.robinhood.com",
      chainId: "46630",
      symbol: "ETH",
      explorer: "https://explorer.testnet.chain.robinhood.com",
    },
    faucets: [
      {
        href: "https://faucet.testnet.chain.robinhood.com",
        label: "faucet.testnet.chain.robinhood.com",
      },
      { href: "https://www.alchemy.com/faucets/robinhood-testnet", label: "the Alchemy faucet" },
    ],
  },
  /** On both chains our token check says ok. Explorer pages from `tokenExplorerUrl`. */
  tokens: [
    {
      symbol: "TEST",
      chain: "Solana devnet",
      chainId: 103,
      address: "CKwgEmb3YgA7hjU6tVVBUvXfTqu2qTuYDiR2eo3o4cgt",
    },
    {
      symbol: "TEST",
      chain: "Robinhood testnet",
      chainId: 46630,
      address: "0x077aC8FfC52458C6BF08d427c5eB038bE3f06F03",
    },
    {
      symbol: "tUSDC",
      chain: "Robinhood testnet",
      chainId: 46630,
      address: "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C",
    },
  ],
} as const;

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
