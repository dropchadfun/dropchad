/**
 * The logic of the claim page `/claim`.
 * No React here, `ClaimView.tsx` renders it.
 *
 * No wallet connect and no wallet library: the receiver signs in with X,
 * pastes an address, sees it large on the confirm screen, and the api binds it.
 */
import type { DropDetail, TokenInfo } from "@/lib/api";
import { isAddressFor, type ChainFamily } from "@/lib/chains";
import { exactAmount, shortAddress } from "@/lib/format";

/** Under the `claim` title in every state. */
export const NO_SEED_LINE = "we never ask for your seed phrase or private keys.";

/** One item of `GET /api/claims`. */
export interface ClaimItem {
  readonly drop: string;
  readonly chainKey: string;
  readonly chainId: number;
  readonly title: string | null;
  readonly sender: {
    readonly handle: string;
    readonly displayName: string;
    readonly profileImageUrl: string | null;
  } | null;
  /** Base units of the coin, a decimal string. */
  readonly amount: string;
  /** The token's on a token drop, the short mint with no ticker. */
  readonly symbol: string;
  readonly decimals: number;
  /** The token of a token drop, `null` on a SOL or ETH drop; absent from an api before 4f. */
  readonly token?: TokenInfo | null;
  readonly index: number;
  /** Unix seconds, `null` before activation. */
  readonly claimDeadline: string | null;
  readonly state: "claimable" | "sending" | "paid" | "failed" | "paused" | "ended" | "not_funded";
  readonly recipient: string | null;
  readonly claimTxHash: string | null;
}

export interface ClaimsAnswer {
  readonly claims: readonly ClaimItem[];
  /**
   * The chain keys the api could not read; their drops are not in `claims`. Absent
   * from an api before.
   */
  readonly unavailable?: readonly string[];
  readonly freshLoginSecondsLeft: number;
}

/** Some drops are missing because a chain could not be read: the list says so in one line. */
export function isPartial(answer: ClaimsAnswer): boolean {
  return (answer.unavailable ?? []).length > 0;
}

export type ClaimStep = "start" | "paste" | "confirm";

export type DetailScreen =
  | "fresh-login"
  | "paste"
  | "confirm"
  | "sending"
  | "paid"
  | "failed"
  | "paused"
  | "ended"
  | "not-funded";

/**
 * A bind needs an X login from the last 10 minutes. With less than this left the page
 * asks for a new login first, so nobody is cut off halfway through the confirm.
 */
export const FRESH_LOGIN_MARGIN_SECONDS = 60;

export type RowAction =
  | { readonly kind: "button"; readonly label: "claim" }
  | { readonly kind: "word"; readonly label: string; readonly greyed?: true };

/** What a row of the list offers: the mint `claim` button, or one grey word. */
export function rowAction(item: ClaimItem): RowAction {
  switch (item.state) {
    case "claimable":
    case "failed":
      return { kind: "button", label: "claim" };
    case "sending":
      return { kind: "word", label: "on its way" };
    case "paid":
      return { kind: "word", label: "paid", greyed: true };
    case "paused":
      return { kind: "word", label: "paused" };
    case "ended":
      return { kind: "word", label: "ended" };
    case "not_funded":
      return { kind: "word", label: "not funded yet" };
  }
}

/** Which screen one drop shows. Facts first; a login only ever gates the paste and the confirm. */
export function detailScreen(
  item: ClaimItem,
  freshLoginSecondsLeft: number,
  step: ClaimStep,
): DetailScreen {
  switch (item.state) {
    case "paid":
      return "paid";
    case "ended":
      return "ended";
    case "not_funded":
      return "not-funded";
    case "paused":
      return "paused";
    case "sending":
      return "sending";
    case "failed":
      if (step === "start") return "failed";
      break;
    case "claimable":
      break;
  }
  if (freshLoginSecondsLeft < FRESH_LOGIN_MARGIN_SECONDS) return "fresh-login";
  return step === "confirm" ? "confirm" : "paste";
}

/** Never `a Solana address`, claim. */
export function pasteHint(family: ChainFamily): string {
  return family === "svm" ? "Solana address" : "Robinhood address, starts with 0x";
}

/** The shape check while typing; `null` is fine or still empty. The api checks the rest. */
export function pasteError(family: ChainFamily, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (isAddressFor(trimmed, family)) return null;
  return family === "svm" ? "that is not a Solana address." : "that is not a Robinhood address.";
}

/**
 * Above the address on the confirm: what lands where, the real amount with every decimal, never
 * `send`. Claim.
 */
export function confirmTitle(item: ClaimItem): string {
  return `${exactAmount(item.amount, item.decimals)} ${item.symbol} goes to this wallet`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `12 oct`, the UTC day of a unix time. A no-break space, so the day and month never split. */
export function shortDay(unixSeconds: string): string {
  const date = new Date(Number(unixSeconds) * 1000);
  return `${String(date.getUTCDate())}\u00a0${MONTHS[date.getUTCMonth()] ?? "?"}`;
}

/** Paused: the share waits until the deadline. Never a promise past it. */
export function pausedLine(item: ClaimItem): string {
  const until = item.claimDeadline === null ? "the claim deadline" : shortDay(item.claimDeadline);
  return `claims are paused. your share waits here until ${until}. after that, unclaimed money goes back to the sender.`;
}

export function endedLine(item: ClaimItem): string {
  return item.claimDeadline === null
    ? "this drop ended."
    : `this drop ended on ${shortDay(item.claimDeadline)}. unclaimed money went back to the sender.`;
}

export function sendingLine(item: ClaimItem): string {
  return `on its way to ${shortAddress(item.recipient ?? "")}`;
}

/** The front page line, only when something can be claimed now. */
export function frontLine(claims: readonly ClaimItem[]): string | null {
  const open = claims.filter((c) => c.state === "claimable" || c.state === "failed").length;
  return open === 0 ? null : `you got dropped. ${String(open)} to claim →`;
}

/** The X login, coming back to `/claim` or to one drop. The api keeps only these. */
export function claimLoginHref(drop?: string | null): string {
  const next = drop ? `/claim?drop=${drop}` : "/claim";
  return `/api/auth/x/start?next=${encodeURIComponent(next)}`;
}

/** `got dropped? claim it` on a handle drop's page. Never on a multisend or a drop not ours. */
export function claimLinkFor(detail: DropDetail): string | null {
  return detail.ours.data?.mode === "handle" ? `/claim?drop=${detail.address}` : null;
}

/**
 * The seconds left for a bind, counted down while the page is open (
 * 12): the api's number at load, minus the whole seconds since, never under zero. So the page asks
 * for a new login before the paste or the confirm screen, never after `claim`.
 */
export function freshLoginLeft(leftAtLoad: number, loadedAtMs: number, nowMs: number): number {
  return Math.max(0, leftAtLoad - Math.floor((nowMs - loadedAtMs) / 1000));
}
