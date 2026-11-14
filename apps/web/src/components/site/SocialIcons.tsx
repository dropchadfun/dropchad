import { socialLinks, type SocialKey, type SocialLink } from "@/lib/social";
import { cn } from "@/lib/utils";

/**
 * The X, Telegram, GitHub and YouTube brand icons, the one exception to "lucide only".
 *
 * Paths copied unchanged from Tabler Icons 3.48.0, `icons/outline/brand-x.svg`,
 * `brand-telegram.svg` and `brand-github.svg`, and `brand-youtube.svg`,
 * Outline style, one family: stroke 2, round caps and joins, no fill, the
 * same as the lucide icons on the site. Telegram is the plane alone, no circle. YouTube is the
 * rounded box with the play triangle. The Tabler invisible `M0 0h24v24H0z` box path is left out.
 *
 * Tabler Icons is MIT licensed: Copyright (c) 2020-2026 Paweł Kuna,
 * https://github.com/tabler/tabler-icons/blob/main/LICENSE. The marks themselves are trademarks
 * of X Corp, Telegram, GitHub and Google, used only to link to our own accounts.
 */
export const SOCIAL_MARKS: Record<SocialKey, readonly string[]> = {
  x: ["M4 4l11.733 16h4.267l-11.733 -16l-4.267 0", "M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"],
  telegram: ["M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4"],
  github: [
    "M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5",
  ],
  youtube: [
    "M2 8a4 4 0 0 1 4 -4h12a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-12a4 4 0 0 1 -4 -4v-8",
    "M10 9l5 3l-5 3l0 -6",
  ],
};

/**
 * Where the list sits. `header`: the top bar, desktop only, 32px targets like the sign in
 * button. `footer`: the footer line, phone only, 44px targets.
 */
const PLACEMENT = {
  header: { list: "hidden md:flex gap-1", target: "size-8" },
  footer: { list: "-mr-3.5 ml-auto flex md:hidden", target: "size-11" },
} as const;

/**
 * The social icons in `lib/social` order, grey. One with an href is a link, mint on hover, in a
 * new tab. One without is a plain icon in the same box: not clickable, no hover, no new tab.
 */
export function SocialLinks({
  links = socialLinks(),
  placement,
}: {
  links?: readonly SocialLink[];
  placement: keyof typeof PLACEMENT;
}) {
  if (links.length === 0) return null;
  const style = PLACEMENT[placement];
  return (
    <ul
      className={cn(style.list, "items-center text-chad-text-dim")}
      aria-label="dropchad elsewhere"
    >
      {links.map((link) => (
        <li key={link.key}>
          {link.href === "" ? (
            <span
              role="img"
              aria-label={link.label}
              className={cn(style.target, "flex items-center justify-center")}
            >
              <SocialMark mark={link.key} />
            </span>
          ) : (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              className={cn(
                style.target,
                "interactive flex items-center justify-center rounded-md hover:text-chad-accent",
              )}
            >
              <SocialMark mark={link.key} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One brand mark, 20px unless told; the X link uses it at 16px, `XLink.tsx`. */
export function SocialMark({
  mark,
  className = "size-5",
}: {
  mark: SocialKey;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {SOCIAL_MARKS[mark].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
