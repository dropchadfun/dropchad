import { pageFromParam } from "@/components/boards/BoardTabs";
import { urlWithPageParam } from "@/components/front/board-page";

/**
 * The front page `latest` page in the url. Its own name, so it
 * never meets the `top chads` `board_page=` or the `/boards` page's `page`.
 */
export const DROPS_PAGE_PARAM = "drops_page";

/** The drops page a url value names, a whole number from 1. Anything else is 1. */
export function dropsPageFromParam(value: string | undefined): number {
  return pageFromParam(value);
}

/** The drops page in a `location.search`. */
export function dropsPageFromSearch(search: string): number {
  return dropsPageFromParam(new URLSearchParams(search).get(DROPS_PAGE_PARAM) ?? undefined);
}

/** The same address with this drops page; page 1 is the address without it. Nothing else moves. */
export function urlWithDropsPage(
  pathname: string,
  search: string,
  hash: string,
  page: number,
): string {
  return urlWithPageParam(pathname, search, hash, DROPS_PAGE_PARAM, page);
}
