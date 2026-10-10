/**
 * Numbers and addresses for the screen.: numbers do the bragging, so they have to
 * be short and right. Wei stays a string until here; a `Number` would lose precision above 2^53.
 */

/**
 * Wei to ETH for display. Up to `maxDecimals` decimals, trailing zeros dropped, thousands
 * separated. "0.0003", "1.5", "12,400". Never used for a comparison.
 */
export function formatEth(wei: string | bigint, maxDecimals = 4): string {
  return formatAmount(wei, 18, maxDecimals);
}

/**
 * Base units to whole coins for any chain: 18 decimals for wei, 9 for lamports. The number the
 * page shows next to a symbol; never used for a comparison.
 */
export function formatAmount(base: string | bigint, unitDecimals: number, maxDecimals = 4): string {
  const scale = 10n ** BigInt(unitDecimals);
  const value = typeof base === "bigint" ? base : BigInt(base || "0");
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / scale;
  const fraction = abs % scale;

  let decimals = fraction.toString().padStart(unitDecimals, "0").slice(0, maxDecimals);
  // A tiny amount must not round to "0". Keep digits until the first non zero one.
  if (/^0*$/.test(decimals) && fraction > 0n) {
    const full = fraction.toString().padStart(unitDecimals, "0");
    const firstNonZero = full.search(/[1-9]/);
    decimals = full.slice(0, Math.min(unitDecimals, firstNonZero + 2));
  }
  decimals = decimals.replace(/0+$/, "");

  const wholeText = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeText}${decimals ? `.${decimals}` : ""}`;
}

/**
 * Base units to whole coins, exact: every decimal, no thousands comma. What the funding card's
 * `copy amount` puts in the clipboard, so a wallet takes it as is. Never cut: less than the
 * amount would not start the drop.
 */
export function exactAmount(base: string | bigint, unitDecimals: number): string {
  const scale = 10n ** BigInt(unitDecimals);
  const value = typeof base === "bigint" ? base : BigInt(base || "0");
  const fraction = (value % scale).toString().padStart(unitDecimals, "0").replace(/0+$/, "");
  return `${(value / scale).toString()}${fraction ? `.${fraction}` : ""}`;
}

/** "0x1234…abcd". */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** "0x1234…cdef" for a 32 byte hash. */
export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

/** Whole numbers with separators. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** "0%", "67%", "100%". Rounded down so 99.6% never reads as done. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${String(Math.floor((part / whole) * 100))}%`;
}

/** "just now", "4m ago", "2h ago", "3d ago". Seconds or an ISO string in, short text out. */
export function timeAgo(when: string | number, now = Date.now()): string {
  const millis =
    typeof when === "number"
      ? when * 1000
      : /^\d+$/.test(when)
        ? Number(when) * 1000
        : new Date(when).getTime();
  const seconds = Math.max(0, Math.floor((now - millis) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  const months = Math.floor(days / 30);
  return `${String(months)}mo ago`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** An ISO time as a short day, `8 dec 2026`, lowercase like the rest of the copy. UTC day. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "not sure";
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? "?"} ${String(date.getUTCFullYear())}`;
}

/** `31 oct`: day and month, no year, held together by a no-break space. The tag lock line. */
export function formatDayMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "not sure";
  return `${String(date.getUTCDate())}\u00a0${MONTHS[date.getUTCMonth()] ?? "?"}`;
}

/** Dollars for a tile or a board, `$1,234.57`. Two decimals always; it is a display number. */
export function formatUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse a decimal ETH string typed by a human into wei. `null` when it is not a number. */
export function parseEth(text: string): bigint | null {
  return parseAmount(text, 18);
}

/** Whole coins typed by a person to base units, for a chain with this many decimals. */
export function parseAmount(text: string, unitDecimals: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > unitDecimals) return null;
  return BigInt(whole) * 10n ** BigInt(unitDecimals) + BigInt(fraction.padEnd(unitDecimals, "0"));
}

/** "7 people", "1 person": the number on the right of a board row. Never wallets. */
export function formatPeople(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "person" : "people"}`;
}

/** One item of the coin line, as the api fills it. `apps/api/src/drops/read.ts`. */
export type DroppedItem =
  | {
      readonly kind: "coin";
      readonly symbol: string;
      readonly decimals: number;
      readonly amount: string;
    }
  | { readonly kind: "tokens"; readonly count: number };

/**
 * The coin line under `total dropped`: `0.001 ETH  0.006 SOL  5 tokens`.
 * Two spaces between items, so the span needs `whitespace-pre`. Empty when nothing moved.
 */
export function droppedLine(items: readonly DroppedItem[]): string {
  return items
    .map((item) =>
      item.kind === "coin"
        ? `${formatAmount(item.amount, item.decimals, 4)} ${item.symbol}`
        : `${formatCount(item.count)} ${item.count === 1 ? "token" : "tokens"}`,
    )
    .join("  ");
}
