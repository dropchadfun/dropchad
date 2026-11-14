/**
 * Where dropchad lives off site. The one place the links are written
 * the footer reads them from here. An empty `href` means not yet: the icon still shows, as a
 * plain icon, not a link. Set the href and it becomes a normal link.
 */
export type SocialKey = "x" | "telegram" | "github" | "youtube";

export interface SocialLink {
  readonly key: SocialKey;
  /** What a screen reader says for the icon. */
  readonly label: string;
  readonly href: string;
}

/** In page order: GitHub, X, Telegram, YouTube. */
export const SOCIAL_LINKS: readonly SocialLink[] = [
  { key: "github", label: "dropchad on GitHub", href: "https://github.com/dropchadfun/dropchad" },
  { key: "x", label: "dropchad on X", href: "https://x.com/dropchadfun" },
  { key: "telegram", label: "dropchad on Telegram", href: "https://t.me/dropchad" },
  { key: "youtube", label: "dropchad on YouTube", href: "https://www.youtube.com/@dropchad" },
];

/** The one email on the site, `/contact` and `security.txt`. Cloudflare forwards it. */
export const CONTACT_EMAIL = "hello@dropchad.com";

/** The name warning, the footer and `/terms`. */
export const NAME_WARNING =
  "Our official sites are dropchad.com and dropchad.fun. We have no token, any dropchad token you see is fake.";

function hrefOf(key: SocialKey): string {
  return SOCIAL_LINKS.find((link) => link.key === key)?.href ?? "";
}

/** The public repo, for the footer text link and `/about`. */
export function githubUrl(): string {
  return hrefOf("github");
}

/**
 * Our X page, for `/contact` and the `/how` test token line
 * people can write to us there; the Telegram channel takes no messages.
 */
export function xUrl(): string {
  return hrefOf("x");
}

/** Every entry, set or not. One with an empty href shows as a plain icon. */
export function socialLinks(): readonly SocialLink[] {
  return SOCIAL_LINKS;
}

/** A person's own X page, for the X link. The handle with or without `@`. */
export function xProfileUrl(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle.replace(/^@/, ""))}`;
}
