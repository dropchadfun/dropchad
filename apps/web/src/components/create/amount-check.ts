/**
 * The amount check on step 1 of `/create`.
 * Once the list parses, the page sends `POST /api/drops/check` half a second after
 * typing stops. A refusal shows the create sentence from `errors.ts` under the list and keeps
 * `next` off. A failed check (no answer, `429`, a `5xx` other than `price_unavailable`) shows
 * nothing and blocks nothing: create checks again on step 2.
 */
import { explain } from "@/components/create/errors";
import type { CreateMode } from "@/components/create/form";
import { ApiError } from "@/lib/api";
import type { ChainFamily } from "@/lib/chains";

/** The wait after the last key. */
export const CHECK_DELAY_MS = 500;

export interface AmountCheckBody {
  readonly mode: "handle" | "address";
  readonly chain: string;
  readonly asset: string;
  readonly amounts: readonly string[];
}

export type AmountCheck =
  | { readonly state: "ok" }
  /** `code` is the api's refusal code: `drop_too_big` has its own line. */
  | { readonly state: "refused"; readonly code: string; readonly message: string }
  | { readonly state: "unknown" };

/** The codes the check refuses with, the same as create. Anything else is a failed check. */
const REFUSALS = new Set([
  "too_many",
  "drop_too_big",
  "below_min_usd",
  "fee_below_gas",
  "fee_too_high",
  "price_unavailable",
]);

/**
 * What step 1 sends: one amount a person, merged the way the api merges. A handle
 * and a `0x` address whatever the case, a base58 key exactly. `null` when there is nothing to
 * ask: an empty list, a line that did not parse, or the local people cap already showing.
 */
export function amountCheckBody(input: {
  readonly mode: CreateMode;
  readonly chain: string;
  readonly family: ChainFamily;
  readonly asset: string;
  readonly lines: readonly { readonly key: string; readonly amountWei: bigint }[];
  readonly hasErrors: boolean;
  readonly tooMany: boolean;
}): AmountCheckBody | null {
  if (input.lines.length === 0 || input.hasErrors || input.tooMany) return null;
  const exact = input.mode === "multisend" && input.family === "svm";
  const merged = new Map<string, bigint>();
  for (const line of input.lines) {
    const key = exact ? line.key : line.key.toLowerCase();
    merged.set(key, (merged.get(key) ?? 0n) + line.amountWei);
  }
  return {
    mode: input.mode === "drop" ? "handle" : "address",
    chain: input.chain,
    asset: input.asset,
    amounts: [...merged.values()].map((amount) => amount.toString()),
  };
}

/** What the answer means: `null` is all good, an `ApiError` with a refusal code is a refusal. */
export function checkOutcome(
  error: unknown,
  unit: { readonly decimals: number; readonly token?: boolean; readonly coin?: string },
): AmountCheck {
  if (error === null) return { state: "ok" };
  if (error instanceof ApiError && REFUSALS.has(error.code)) {
    return { state: "refused", code: error.code, message: explain(error, unit) };
  }
  return { state: "unknown" };
}

/** Only a refusal keeps `next` off. */
export function blocksNext(check: AmountCheck | null): boolean {
  return check?.state === "refused";
}
