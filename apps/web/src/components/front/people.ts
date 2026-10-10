/**
 * The third tile on the front page: payouts big, the people under it (
 * ). Both are counted per chain and added up over the chains that are on.
 *
 * People are counted per chain,
 * one X account counts once inside one chain, and the
 * tile adds up the counts of the chains that are on. With every chain on that is each chain's
 * count added up, so one X account paid on two chains is two; with one chain picked it is that
 * chain's own count.
 */
import type { Stats } from "@/lib/api";
import { chainKeyIsOn, type ChainSelection } from "@/lib/chain-filter";
import type { ChainPill } from "@/lib/chains";

export function peoplePaid(
  stats: Stats | null,
  selection: ChainSelection,
  pills: readonly ChainPill[],
): number | null {
  if (stats === null) return null;
  return stats.totals
    .filter((total) => chainKeyIsOn(selection, total.chainKey, pills))
    .reduce((n, total) => n + total.uniqueReceivers, 0);
}

/** Payouts: every final claim. The chains that are on, added up, like the people. */
export function payoutsPaid(
  stats: Stats | null,
  selection: ChainSelection,
  pills: readonly ChainPill[],
): number | null {
  if (stats === null) return null;
  return stats.totals
    .filter((total) => chainKeyIsOn(selection, total.chainKey, pills))
    .reduce((n, total) => n + total.claimCount, 0);
}
