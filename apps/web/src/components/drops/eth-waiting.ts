import type { DropDetail } from "@/lib/api";

/**
 * The ETH waiting line, word for word. A refund
 * address that rejected ETH leaves it in the drop until someone sweeps it.
 */
export const ETH_WAITING_LINE =
  "some eth is waiting in this drop. the refund address could not take it, it goes back once it can.";

/** While the drop answer's `nativeWaiting` is set and not swept. Absent or `null` is none. */
export function ethWaitingShows(detail: DropDetail): boolean {
  const waiting = detail.chain.data?.drop.nativeWaiting;
  return waiting != null && !waiting.swept;
}
