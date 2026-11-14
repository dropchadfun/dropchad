import { pageFromParam } from "@/components/boards/BoardTabs";

/**
 * The front page `top chads` page in the url. Its own name, so it
 * never meets the drops list page, which is state only, or the `/boards` page's `page`.
 */
export const BOARD_PAGE_PARAM = "board_page";

/** The board page a url value names, a whole number from 1. Anything else is 1. */
export function boardPageFromParam(value: string | undefined): number {
  return pageFromParam(value);
}

/** The board page in a `location.search`. */
export function boardPageFromSearch(search: string): number {
  return boardPageFromParam(new URLSearchParams(search).get(BOARD_PAGE_PARAM) ?? undefined);
}

/**
 * The same address with this page under `name`; page 1 is the address without it. Nothing else
 * moves, so the board page and the drops list page never touch each other.
 */
export function urlWithPageParam(
  pathname: string,
  search: string,
  hash: string,
  name: string,
  page: number,
): string {
  const params = new URLSearchParams(search);
  if (page > 1) params.set(name, String(page));
  else params.delete(name);
  const query = params.toString();
  return `${pathname}${query === "" ? "" : `?${query}`}${hash}`;
}

/** The same address with this board page; page 1 is the address without it. Nothing else moves. */
export function urlWithBoardPage(
  pathname: string,
  search: string,
  hash: string,
  page: number,
): string {
  return urlWithPageParam(pathname, search, hash, BOARD_PAGE_PARAM, page);
}
