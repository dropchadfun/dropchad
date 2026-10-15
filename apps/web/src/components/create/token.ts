/**
 * the small rules of the token box on `/create` (
 * 12). No React here, `TokenBox.tsx` renders it.
 */
import { ApiError, type TokenCheck } from "@/lib/api";
import type { ChainFamily } from "@/lib/chains";
import { formatAmount } from "@/lib/format";

/** One fee tier from `GET /api/chains`, `tokenFeeTiers`. */
export interface TokenFeeTier {
  readonly upTo: number;
  readonly usd: string;
  /** The api's SOL estimate at its price; `null` with no price, absent before. */
  readonly lamports?: string | null;
  /** Robinhood: the api's ETH estimate, rounded up to 0.00001 ETH; `null` with no price. */
  readonly wei?: string | null;
}

/** What the page knows about the pasted address: the check's answer, or why there is none. */
export type TokenCheckState =
  | { readonly forMint: string; readonly check: TokenCheck }
  | { readonly forMint: string; readonly error: string };

/** A Solana address: base58, 32 to 44 characters. Anything else is never sent to the check. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A Robinhood token address: `0x` and 40 hex characters. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The pasted text as an address of this chain's family, trimmed, or `null` when it cannot be one. */
export function mintOf(text: string, family: ChainFamily = "svm"): string | null {
  const trimmed = text.trim();
  return (family === "evm" ? EVM_ADDRESS : BASE58).test(trimmed) ? trimmed : null;
}

/** The card's last line: `ok to drop` in mint, or `not ok:` and the check's one reason in red. */
export function tokenLine(check: TokenCheck): { ok: boolean; text: string } {
  if (check.ok) return { ok: true, text: "ok to drop" };
  return { ok: false, text: `not ok: ${(check.reason ?? "not a token").replace(/\.$/, "")}.` };
}

/** The tier for this many people; `null` past the last tier or with no tiers. */
export function tierFor(
  tiers: readonly TokenFeeTier[] | null | undefined,
  people: number,
): TokenFeeTier | null {
  return tiers?.find((tier) => people <= tier.upTo) ?? null;
}

/** The most people a token drop takes: the end of the last tier, 500 when the api sends none. */
export function tokenMax(tiers: readonly TokenFeeTier[] | null | undefined): number {
  return tiers?.[tiers.length - 1]?.upTo ?? 500;
}

/** The grey line under step 2's tiles, the words. */
export const TOKEN_FEE_NOTE =
  "you also pay ≈ 0.002 SOL per person for their token account. what is not used comes back after 7 days.";

const CENTI_SOL = 10_000_000n;

/** The fee tile's big line: `≈ 0.08 SOL`, the api's estimate rounded up to 0.01 SOL. */
export function aboutSol(lamports: string): string {
  const up = ((BigInt(lamports) + CENTI_SOL - 1n) / CENTI_SOL) * CENTI_SOL;
  return `≈ ${formatAmount(up, 9, 2)} SOL`;
}

/**
 * The fee tile's big line on Robinhood: `≈ 0.00123 ETH`, the api's estimate as it
 * sent it. The api already rounded it up to 0.00001 ETH, so the page does not.
 */
export function aboutEth(wei: string): string {
  return `≈ ${formatAmount(wei, 18, 5)} ETH`;
}

/** The asset row's second line: `name · ticker`; `null` when the token has neither. */
export function assetSub(check: Pick<TokenCheck, "name" | "symbol">): string | null {
  const parts = [check.name, check.symbol].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Why the check gave no answer, in plain words. */
export function tokenCheckError(error: unknown): string {
  if (error instanceof ApiError && error.code === "bad_mint") return "not ok: not a token.";
  return "cannot check this token right now. try again in a minute.";
}

/**
 * The full address in two even halves, the first longer by one when odd: drawn unbroken, so on
 * the phone it wraps into two equal lines, never one character alone.
 */
export function assetHalves(text: string): [string, string] {
  const cut = Math.ceil(text.length / 2);
  return [text.slice(0, cut), text.slice(cut)];
}
