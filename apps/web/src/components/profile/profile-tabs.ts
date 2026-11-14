/**
 * The profile's two tabs. Pure.
 */

export type ProfileTab = "drops" | "received";

/** The api sends at most this many rows per list. */
export const PROFILE_LIST_CAP = 50;

/** The count next to a tab word: the rows the api sent, `50+` at its cap. */
export function tabCount(count: number): string {
  return count >= PROFILE_LIST_CAP ? `${String(PROFILE_LIST_CAP)}+` : String(count);
}
