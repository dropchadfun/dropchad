/**
 * Plain, honest errors on `/create`. Every code the create and the handle lookup
 * can answer with has a sentence. Moved out of `CreateDrop.tsx` in, so each
 * sentence is tested.
 */
import { ApiError } from "@/lib/api";
import { formatAmount } from "@/lib/format";

const handlesOf = (body: unknown): string[] => {
  const handles = (body as { handles?: unknown } | null)?.handles;
  return Array.isArray(handles) ? handles.filter((h): h is string => typeof h === "string") : [];
};

const at = (handles: readonly string[]) => handles.map((handle) => `@${handle}`).join(", ");

export function explain(
  error: unknown,
  /** `token` on a token drop: its refusals have their own words. */
  unit: {
    readonly decimals: number;
    readonly token?: boolean;
    /** The chain's coin the token fee is paid in, `SOL` or `ETH`. `SOL` when absent. */
    readonly coin?: string;
  } = { decimals: 18 },
): string {
  if (!(error instanceof ApiError)) return "the api did not answer. is it running on 4000?";
  const body = error.body as Record<string, unknown> | null;
  switch (error.code) {
    case "unauthorized":
      return "your session ended. sign in with X again.";
    case "csrf_failed":
      return "the page is stale. reload and try again.";
    case "relayer_not_configured":
      return "this api has no relayer key, so it cannot make drops right now.";
    case "invalid_receivers":
    case "invalid_body": {
      const message = (body as { message?: string } | null)?.message;
      return message ?? "the receiver list was refused. check the lines.";
    }
    case "rate_limited":
      return "five drops an hour is the limit. give it a bit.";
    case "relayer_budget_exceeded":
      return "the relayer spent its gas for today. try after midnight utc.";
    case "gas_cap_exceeded":
      return "gas is too high right now. try again in a while.";
    case "create_reverted":
      return "the chain refused the drop. nothing was sent. try again.";
    case "indexer_unavailable":
      return "the indexer is not answering.";
    // Drop mode.
    case "handles_not_found":
      return `not found on X: ${at(handlesOf(body))}. fix or remove them.`;
    case "bad_handle":
      return `not an X handle: ${at(handlesOf(body))}.`;
    case "own_handle":
      return "that is you. a drop cannot pay yourself.";
    case "handle_mode_not_ready":
      return "x handle drops are paused.";
    case "x_unavailable":
      return "X is not answering. try again in a minute.";
    case "daily_cap":
      return "handle lookups are used up for today.";
    case "too_many":
      if (unit.token === true) return "a token drop takes 500 people at most. remove some names.";
      return `${String(typeof body?.["max"] === "number" ? body["max"] : 500)} people per drop at most.`;
    case "below_min_usd": {
      const minimum = typeof body?.["minimum"] === "string" ? body["minimum"] : null;
      const symbol = typeof body?.["symbol"] === "string" ? body["symbol"] : "";
      return minimum === null
        ? "each person must get more. the amount is below the minimum."
        : `each person must get at least ${formatAmount(minimum, unit.decimals, 9)} ${symbol}.`;
    }
    case "fee_below_gas":
      return "the fee does not cover the gas right now. send a bit more per person, or try later.";
    case "price_unavailable":
      if (unit.token === true) {
        return `no ${unit.coin ?? "SOL"} price right now. try again in a minute.`;
      }
      return "no coin price right now, so the minimum cannot be checked. try again in a minute.";
    // Token drops: plain words for international crypto people.
    case "token_refused": {
      const reason = typeof body?.["reason"] === "string" ? body["reason"] : "not a token";
      return `this token cannot be dropped: ${reason.replace(/\.$/, "")}.`;
    }
    case "fee_too_high":
      return "the fee is too high right now. try again later.";
    case "solana_unavailable":
      return "cannot check this token right now. try again in a minute.";
    default:
      return `the drop was not made (${error.code}).`;
  }
}
