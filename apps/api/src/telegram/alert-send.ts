/**
 * One private Telegram message to the owner: the relayer alert and the
 * owner alerts both send through this. Plain text, no `parse_mode`, link previews off,
 * the one fixed host, 10 seconds at most.
 *
 * **The token is in the url.** The answer is `null` when sent, otherwise a status for the log:
 * never the url, never an error's message.
 */

import { findChain } from "@dropchad/chains";

/** The one host, fixed. */
const TELEGRAM_API = "https://api.telegram.org";
export const ALERT_TIMEOUT_MS = 10_000;

function codeOf(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

export async function sendPrivateAlert(
  deps: { readonly fetch: typeof fetch; readonly token: string; readonly chatId: string },
  text: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await deps.fetch(`${TELEGRAM_API}/bot${deps.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: deps.chatId,
        text,
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") return "timeout";
    return `network ${codeOf(error) ?? "error"}`;
  }
  const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
  if (!response.ok || body?.ok !== true) return `http ${String(response.status)}`;
  return null;
}

// ---------------------------------------------------------------------------
// The texts
// ---------------------------------------------------------------------------

/** Drops the zeros at the end of a fraction, and the point when nothing is left. */
function joinFraction(whole: string, fraction: string): string {
  const kept = fraction.replace(/0+$/, "");
  return kept === "" ? whole : `${whole}.${kept}`;
}

/**
 * An amount for the owner, with the symbol, never base units: from 1 up 2 decimals, below 1 two
 * significant digits, rounded down. `1942815160` lamports is `1.94 SOL`.
 */
export function readableAmount(base: bigint, decimals: number, symbol: string): string {
  if (base <= 0n) return `0 ${symbol}`;
  const scale = 10n ** BigInt(decimals);
  if (base >= scale) {
    const cents =
      decimals >= 2 ? base / 10n ** BigInt(decimals - 2) : base * 10n ** BigInt(2 - decimals);
    const fraction = (cents % 100n).toString().padStart(2, "0");
    return `${joinFraction((cents / 100n).toString(), fraction)} ${symbol}`;
  }
  const digits = base.toString();
  const zeros = "0".repeat(decimals - digits.length);
  return `${joinFraction("0", zeros + digits.slice(0, 2))} ${symbol}`;
}

/** `🟠 RELAYER LOW, SOLANA DEVNET`: the chain's name in capitals, or no chain. */
export function alertTitle(emoji: string, title: string, chainKey: string | null): string {
  if (chainKey === null) return `${emoji} ${title}`;
  const name = findChain(chainKey)?.name ?? chainKey.replace(/-/g, " ");
  return `${emoji} ${title}, ${name.toUpperCase()}`;
}

/** The parts, title, numbers, what happened, what to do, with an empty line between them. */
export function alertText(parts: readonly (readonly string[])[]): string {
  return parts.map((lines) => lines.join("\n")).join("\n\n");
}

/** `1 claim`, `2 claims`, `0 claims`: the word without `s` only for a count of 1. */
export function countOf(n: number, word: string): string {
  return `${String(n)} ${n === 1 ? word : `${word}s`}`;
}

/** A test message: `TEST` between the emoji and the title. */
export function asTestAlert(text: string): string {
  const space = text.indexOf(" ");
  return `${text.slice(0, space)} TEST${text.slice(space)}`;
}
