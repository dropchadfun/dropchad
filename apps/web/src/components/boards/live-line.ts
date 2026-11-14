/**
 * The small live line under a board's title: when the browser
 * last got the board. The board fetches itself again every 60 seconds while the page is open; a
 * failed fetch keeps the old rows and the old time. Pure.
 */

export const BOARD_REFRESH_MS = 60_000;

/** `live · updated just now`, `20s ago`, `2m ago`, `2h ago`. */
export function updatedLine(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  if (seconds < 10) return "live · updated just now";
  if (seconds < 60) return `live · updated ${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `live · updated ${String(minutes)}m ago`;
  return `live · updated ${String(Math.floor(minutes / 60))}h ago`;
}
