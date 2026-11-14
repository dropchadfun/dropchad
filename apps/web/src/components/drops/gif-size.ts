/**
 * The drawn size of a drop's GIF: the box height, and a width
 * from the GIF's own shape; too wide for the card, it shrinks to the card's width with its shape kept.
 * Never cropped, never stretched.
 */
export function gifSize(
  gif: { readonly width: number; readonly height: number },
  box: { readonly boxHeight: number; readonly maxWidth: number },
): { width: number; height: number } {
  if (gif.width <= 0 || gif.height <= 0) return { width: 0, height: box.boxHeight };
  const width = Math.round((box.boxHeight * gif.width) / gif.height);
  if (width <= box.maxWidth) return { width, height: box.boxHeight };
  return {
    width: box.maxWidth,
    height: Math.round((box.maxWidth * gif.height) / gif.width),
  };
}
