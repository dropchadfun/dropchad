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

/** Up to this many pages every number shows; more, the numbers move with the page. */
const ALL_NUMBERS = 7;

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
  /** `null` for a `…`, which is not a page. */
  readonly page: number | null;
  readonly label: string;
  readonly current: boolean;
}

/**
 * The row under a list: up to 7 pages every number;
 * more, page 1, the last page, the current page with one on each side, and `…` where pages are
 * left out, `1 … 6 7 8 … 19`. A gap of one page shows that page. Every page can be reached.
 * One page: nothing.
 */
export function pagerItems(pages: number, current: number): PagerItem[] {
  if (pages <= 1) return [];
  const on = Math.min(Math.max(1, current), pages);
  const number = (page: number): PagerItem => ({
    page,
    label: String(page),
    current: page === on,
  });
  if (pages <= ALL_NUMBERS) return Array.from({ length: pages }, (_, i) => number(i + 1));
  const kept = [...new Set([1, on - 1, on, on + 1, pages])]
    .filter((page) => page >= 1 && page <= pages)
    .sort((a, b) => a - b);
  const items: PagerItem[] = [];
  let last = 0;
  for (const page of kept) {
    if (page - last === 2) items.push(number(last + 1));
    else if (page - last > 2) items.push({ page: null, label: "…", current: false });
    items.push(number(page));
    last = page;
  }
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
