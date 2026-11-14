/**
 * Which X picture file to draw. The stored link is
 * X's 48px `_normal`; X serves the same picture as `_400x400` at the same place. From 48px up
 * the small one looks blurry, so it takes the big one.
 */
export const BIG_PICTURE_FROM_PX = 48;

/** The `_400x400` link at 48px or more; the stored link below that, or without `_normal`. */
export function xPictureAt(url: string | null, size: number): string | null {
  if (url === null || size < BIG_PICTURE_FROM_PX) return url;
  return url.replace(/_normal(\.[a-z]+)$/i, "_400x400$1");
}
