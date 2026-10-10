/**
 * The pasted handle list, drop mode on `/create`. One X handle and one
 * amount per line, `@alice 0.01`. Separators are whitespace, a comma, a semicolon or an equals
 * sign, like `receivers.ts`, so a paste from a sheet works.
 *
 * Everything here is checked on the phone, before the one paid lookup on `next`: the handle
 * shape, the amount, the sender's own handle (and
 * ) and the 500 people cap. The lookup itself decides whether X knows a
 * handle. The api merges repeated handles per X id, so a repeat only gets a note here.
 */
import { parseAmount } from "@/lib/format";

/** X's own rule: 1 to 15 letters, digits or underscores. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** `HANDLE_MAX_RECEIVERS` on the api. */
export const MAX_PEOPLE = 500;

export interface HandleLine {
  /** As typed, without the `@`. */
  readonly handle: string;
  readonly amountWei: bigint;
}

export interface ParsedHandles {
  readonly lines: HandleLine[];
  readonly errors: { line: number; message: string }[];
  readonly totalWei: bigint;
  /** Distinct handles, whatever the case. */
  readonly people: number;
  readonly duplicates: number;
  /** More than `MAX_PEOPLE`: refused before any lookup. */
  readonly tooMany: boolean;
}

export interface HandleParseOptions {
  readonly decimals: number;
  readonly symbol: string;
  /** The signed in sender's handle. A line naming it is refused. */
  readonly ownHandle?: string | null;
  readonly max?: number;
}

export function parseHandles(text: string, options: HandleParseOptions): ParsedHandles {
  const lines: HandleLine[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  const own = options.ownHandle?.replace(/^@/, "").toLowerCase() ?? null;
  let duplicates = 0;
  let totalWei = 0n;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.length === 0) return;
    const [first, amount, ...rest] = line.split(/[\s,;=]+/).filter((part) => part.length > 0);
    const handle = first?.replace(/^@/, "");
    if (handle === undefined || !X_HANDLE.test(handle)) {
      errors.push({ line: i + 1, message: "not an X handle" });
      return;
    }
    if (amount === undefined) {
      errors.push({ line: i + 1, message: "missing amount" });
      return;
    }
    if (rest.length > 0) {
      errors.push({ line: i + 1, message: "too many values on the line" });
      return;
    }
    const wei = parseAmount(amount, options.decimals);
    if (wei === null || wei <= 0n) {
      errors.push({
        line: i + 1,
        // No unit before a token is chosen.
        message:
          options.symbol === ""
            ? "amount must be a number above zero"
            : `amount must be a number above zero, in ${options.symbol}`,
      });
      return;
    }
    const key = handle.toLowerCase();
    if (key === own) {
      errors.push({ line: i + 1, message: "that is you. a drop cannot pay yourself." });
      return;
    }
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    lines.push({ handle, amountWei: wei });
    totalWei += wei;
  });

  return {
    lines,
    errors,
    totalWei,
    people: seen.size,
    duplicates,
    tooMany: seen.size > (options.max ?? MAX_PEOPLE),
  };
}
