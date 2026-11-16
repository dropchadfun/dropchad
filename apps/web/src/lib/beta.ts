/**
 * The beta words, mainnet only. The caps are the
 * api defaults, written once here, one list per chain, for `/create`, `/terms`, `/about`
 * and the beta card. A change to an cap env changes `DROP_CAP_LINES` in the same change.
 */
import { liveMainnetKeys } from "@/lib/chains";

export const DROP_CAP_LINES = {
  solana: ["2 SOL", "200 USDC", "200 USDT", "200 USD1"],
  robinhood: ["0.1 ETH", "200 USDG"],
} as const satisfies Readonly<Record<string, readonly [string, ...string[]]>>;

/** The order of the chain names: Solana first. */
const CAP_ORDER = ["solana", "robinhood"] as const;

/** `a`, `a or b`, `a, b or c`. */
function orList(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1] ?? ""}`;
}

/**
 * The words of the given live chains only: their coins first, Solana first, then
 * the tokens of each chain. Solana alone: `2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana`.
 */
export function dropCapWords(
  liveKeys: readonly string[],
  lines: typeof DROP_CAP_LINES = DROP_CAP_LINES,
): string {
  const live = CAP_ORDER.filter((key) => liveKeys.includes(key));
  const coins = live.map((key) => lines[key][0]);
  const tokens = [...live].reverse().map((key) => `${orList(lines[key].slice(1))} on ${key}`);
  return [...coins, ...tokens].join(", ");
}

/**
 * The caps with no api answer: the chains live from the registry
 * alone. The pages pass the live keys of `readLiveChains()` to `dropCapWords` instead.
 */
export const DROP_CAPS = dropCapWords(liveMainnetKeys(), DROP_CAP_LINES);

/** The cap lines of the beta card: only the live chains given, Solana first. */
export function betaCardCaps(liveKeys: readonly string[]): string[] {
  return CAP_ORDER.filter((key) => liveKeys.includes(key)).flatMap((key) => DROP_CAP_LINES[key]);
}

/** Under the `total` tile on step 1 of `/create`, for the given live chains. */
export function betaNotice(liveKeys: readonly string[]): string {
  return `dropchad is in beta. each drop has a limit while we grow: ${dropCapWords(liveKeys)}. other tokens have no limit.`;
}

/** The notice with no api answer. */
export const BETA_NOTICE = betaNotice(liveMainnetKeys());

/** The tick box before `drop it` and `send it`. */
export const BETA_TICK = "i understand dropchad is in beta and i send at my own risk.";
