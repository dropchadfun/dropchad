import { HomeLink } from "@/components/site/HomeLink";
import { TESTNET_ONLY } from "@/lib/chains";
import { cn } from "@/lib/utils";

/**
 * The header lockup: the hand mark and the wordmark, then the `testnet` mark.
 */
export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <HomeLink className="flex items-center gap-2" aria-label="dropchad home">
        <Mark />
        <WordmarkText />
      </HomeLink>
      <TestnetMark />
    </span>
  );
}

/**
 * `dropchad` as text in an svg. `drop` in `--chad-text`,
 * `chad` in the hand's mint, `--chad-brand-mint`. Inter 600 at `-0.02em`, the `display` setting
 * of section 3, through the same `--font-inter` the page loads, so it is never a picture and it
 * follows the font. `height` sets the size; the width follows the text. `tone="dim"` is the
 * footer's grey: both words in `currentColor`, so the parent's text colour decides.
 */
export function WordmarkText({
  height = 20,
  tone = "brand",
  className,
}: {
  height?: number;
  tone?: "brand" | "dim";
  className?: string;
}) {
  const dim = tone === "dim";
  // The viewBox is at 100px: Inter 600 `dropchad` at -0.02em measures 446.6 wide in Chrome,
  // ascender top at 3, descender bottom at 99., not guessed.
  return (
    <svg
      role="img"
      aria-label="dropchad"
      viewBox="0 0 448 100"
      height={height}
      width={Math.round(height * 4.48 * 100) / 100}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <text
        x="0"
        y="78"
        fontFamily="var(--font-inter), Inter, system-ui, sans-serif"
        fontSize="100"
        fontWeight="600"
        letterSpacing="-2"
      >
        <tspan fill={dim ? "currentColor" : "var(--chad-text)"}>drop</tspan>
        <tspan fill={dim ? "currentColor" : "var(--chad-brand-mint)"}>chad</tspan>
      </text>
    </svg>
  );
}

/**
 * The `testnet` mark: on every page at once because it sits in the top bar.
 * Readable, `--chad-text` on the raised surface like the FUNDING chip, never mint, so it says
 * what it says and does not fight the wordmark. Gone the day `TESTNET_ONLY` flips.
 */
export function TestnetMark({ className }: { className?: string } = {}) {
  if (!TESTNET_ONLY) return null;
  return (
    <span
      className={cn(
        "type-label inline-flex h-5 shrink-0 items-center rounded-md bg-chad-surface-2 px-1.5 text-chad-text",
        className,
      )}
      title="test networks only. nothing here is worth anything."
    >
      testnet
    </span>
  );
}

/**
 * The hand, the real logo file. `scripts/favicon.py` renders it from
 * `scripts/hand-silhouette.png` at 24, 48 and 72px, the file's own pixels, so each screen density
 * gets its own sharp render instead of a scaled one. Never a traced path. Decorative here: the
 * link already says `dropchad home`. 24px in the 48px bar.
 */
export function Mark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- three fixed renders, nothing to optimise
    <img
      src="/brand/mark-24.png"
      srcSet="/brand/mark-24.png 1x, /brand/mark-48.png 2x, /brand/mark-72.png 3x"
      width={24}
      height={24}
      alt=""
      className={cn("shrink-0", className)}
    />
  );
}
