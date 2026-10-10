/**
 * The front page drops list: one list, two tabs. `latest`, the default,
 * is every drop newest first, live ones included, 10 rows a page with page numbers under it.
 * `live` is the live drops only, no pages. `/#live` opens the list on the `live` tab, so old
 * links still work. Pure.
 */
import { isLive, type DropCardData } from "@/components/drops/drop-card-data";

export type DropTab = "latest" | "live";

/** Rows on one `latest` page. */
export const LATEST_PAGE = 10;

/** Page numbers shown before `last`. */
const PAGE_NUMBERS = 4;

export function dropTabs(cards: readonly DropCardData[]): {
  latest: DropCardData[];
  live: DropCardData[];
} {
  // Newest first; a drop with no time yet sorts last.
  const sorted = [...cards].sort((a, b) => (b.createdAt ?? -1) - (a.createdAt ?? -1));
  return { latest: sorted, live: sorted.filter(isLive) };
}

/** How many `latest` pages `count` drops make. Never less than one. */
export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(count / LATEST_PAGE));
}

/** The drops on one page, 1 based. A page past the end is the last page, never empty. */
export function latestPage<T>(cards: readonly T[], page: number): T[] {
  const on = Math.min(Math.max(1, page), pageCount(cards.length));
  return cards.slice((on - 1) * LATEST_PAGE, on * LATEST_PAGE);
}

export interface PagerItem {
  readonly page: number;
  readonly label: string;
  readonly current: boolean;
}

/**
 * The row under the list: `1 2 3 4` and `last`, the current page marked. One page: nothing.
 * The server reads the newest 50, so `last` is page 5 at most.
 */
export function pagerItems(pages: number, current: number): PagerItem[] {
  if (pages <= 1) return [];
  const on = Math.min(Math.max(1, current), pages);
  const shown = Math.min(pages, PAGE_NUMBERS);
  const items: PagerItem[] = Array.from({ length: shown }, (_, i) => ({
    page: i + 1,
    label: String(i + 1),
    current: i + 1 === on,
  }));
  if (pages > shown) items.push({ page: pages, label: "last", current: on === pages });
  return items;
}

/** The tab a link lands on: `#live` is the live tab, anything else the default. */
export function tabFromHash(hash: string): DropTab {
  return hash === "#live" ? "live" : "latest";
}

/**
 * `/#live` opens the live tab once, then the address goes back to plain, so a
 * refresh opens `latest`. The address without `#live`, path and query kept; null for any other
 * hash, which stays as it is.
 */
export function urlWithoutLiveHash(pathname: string, search: string, hash: string): string | null {
  return hash === "#live" ? `${pathname}${search}` : null;
}
