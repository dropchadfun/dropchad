/**
 * The footer: one line, the wordmark small and grey left, the social
 * icons right on phone, every link in a new tab. Rendered with `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Footer } from "@/components/site/Footer";
import { WordmarkText } from "@/components/site/Wordmark";
import type { SocialLink } from "@/lib/social";

/** The same four as `lib/social`, so the default render can be compared with this one. */
const links: readonly SocialLink[] = [
  { key: "github", label: "dropchad on GitHub", href: "https://github.com/dropchadfun/dropchad" },
  { key: "x", label: "dropchad on X", href: "https://x.com/dropchadfun" },
  { key: "telegram", label: "dropchad on Telegram", href: "https://t.me/dropchad" },
  { key: "youtube", label: "dropchad on YouTube", href: "https://www.youtube.com/@dropchad" },
];

describe("Footer", () => {
  const html = renderToStaticMarkup(<Footer links={links} />);

  it("is a footer with the wordmark in the current colour, no mint", () => {
    expect(html).toMatch(/^<footer/);
    expect(html).toContain('aria-label="dropchad"');
    expect(html).toContain('fill="currentColor">drop');
    expect(html).toContain('fill="currentColor">chad');
    expect(html).not.toContain("--chad-brand-mint");
  });

  it("renders one link per set href, in a new tab", () => {
    // The social icons only; the footer's own text links
    // are checked in `trust-pages.test.tsx`.
    const anchors = html.match(/<a [^>]*aria-label="dropchad on [^"]*"[^>]*>/g) ?? [];
    expect(anchors).toHaveLength(4);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
    expect(html).toContain('href="https://x.com/dropchadfun"');
    expect(html).toContain('href="https://t.me/dropchad"');
    expect(html).toContain('aria-label="dropchad on X"');
    expect(html).toContain('aria-label="dropchad on Telegram"');
    expect(html).toContain('href="https://github.com/dropchadfun/dropchad"');
    expect(html).toContain('href="https://www.youtube.com/@dropchad"');
    expect(html).toContain('aria-label="dropchad on YouTube"');
  });

  it("shows the icons on phone only, the top bar has them on desktop", () => {
    expect(html).toMatch(/<ul class="[^"]*\bmd:hidden\b/);
    expect(html).not.toContain("md:flex");
  });

  it("shows an empty href as a plain icon, in its place, never a link", () => {
    const plain = renderToStaticMarkup(
      <Footer
        links={links.map((link) => (link.key === "github" ? { ...link, href: "" } : link))}
      />,
    );
    expect(plain).toMatch(/<span [^>]*aria-label="dropchad on GitHub"/);
    expect(plain).not.toContain('href=""');
    expect(plain.indexOf("GitHub")).toBeLessThan(plain.indexOf('aria-label="dropchad on X"'));
  });

  it("keeps the icon row when every link is empty, with no link in it", () => {
    const empty = renderToStaticMarkup(
      <Footer links={links.map((link) => ({ ...link, href: "" }))} />,
    );
    // No social icon is a link; the footer's own text links stay.
    expect(empty).not.toMatch(/<a [^>]*aria-label="dropchad on/);
    expect(empty).toContain('href="/how"');
    expect(empty).toContain("<ul");
  });

  it("reads the config by default and gets the same icons", () => {
    expect(renderToStaticMarkup(<Footer />)).toBe(html);
  });
});

describe("WordmarkText tone", () => {
  it("keeps the brand fills by default and goes currentColor when dim", () => {
    expect(renderToStaticMarkup(<WordmarkText />)).toContain("var(--chad-brand-mint)");
    const dim = renderToStaticMarkup(<WordmarkText height={14} tone="dim" />);
    expect(dim).toContain('height="14"');
    expect(dim).not.toContain("var(--chad-");
  });
});
