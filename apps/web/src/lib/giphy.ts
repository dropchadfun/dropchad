/**
 * A drop's GIF from GIPHY. The browser talks to
 * GIPHY with the web SDK; the api keeps only the id and the kind. Media URLs are GIPHY's own,
 * used as GIPHY returns them.
 */

export type GiphyKind = "gif" | "sticker";

/** What the api keeps and sends: the GIPHY id and the kind. */
export interface Giphy {
  readonly id: string;
  readonly kind: GiphyKind;
}

/** Search and trending. */
export const GIPHY_RATING = "pg";

/** GIPHY's own "Powered By GIPHY" mark for dark backgrounds, unchanged, in `public/`. */
export const POWERED_BY_GIPHY_SRC = "/giphy/powered-by-giphy.png";

/** The smallest width of GIPHY's official attribution logos, their `ReadMe.pdf`. */
export const GIPHY_SMALLEST_WIDTH = 100;

/** The mark's width on the site: never below GIPHY's smallest. */
export const POWERED_BY_GIPHY_WIDTH = 120;

/** Results per page of the picker grid. */
const PAGE = 24;

/**
 * The public GIPHY SDK key, `NEXT_PUBLIC_GIPHY_SDK_KEY`, set at build. Not set or empty: `null`,
 * and the site shows no picker and no GIF.
 */
export function giphyKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GIPHY_SDK_KEY;
  return key === undefined || key.trim() === "" ? null : key.trim();
}

/** The options of one picker tab, for search and trending alike. */
export function gridOptions(kind: GiphyKind): {
  rating: typeof GIPHY_RATING;
  type: "gifs" | "stickers";
  limit: number;
} {
  return { rating: GIPHY_RATING, type: kind === "gif" ? "gifs" : "stickers", limit: PAGE };
}

/** The still frame for reduced motion: GIPHY's `fixed_height_still` URL, unchanged. */
export function stillOf(gif: {
  readonly images: { readonly fixed_height_still?: { readonly url: string } };
}): string | null {
  return gif.images.fixed_height_still?.url ?? null;
}
