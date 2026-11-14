import type { DropDetail } from "@/lib/api";

/**
 * The empty `who claimed` line of a drop that never went live and whose coins went back,
 * word for word. The api opens such a page only then.
 */
export const COINS_BACK_LINE =
  "not fully funded in time. the coins went back to the refund wallet.";

/** Our state says it ran out unfunded, or the chain says it was cancelled. */
export function coinsBackShows(detail: DropDetail): boolean {
  return (
    detail.ours.data?.state === "funding_expired" || detail.chain.data?.drop.status === "Cancelled"
  );
}
