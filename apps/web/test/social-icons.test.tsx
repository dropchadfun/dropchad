/**
 * The social icons. Tabler Icons outline brand marks, one
 * stroke, `currentColor`. The same list sits in the top bar on desktop and in the footer on
 * phone. Rendered with `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SOCIAL_MARKS, SocialLinks } from "@/components/site/SocialIcons";
import type { SocialLink } from "@/lib/social";

const links: readonly SocialLink[] = [
  { key: "github", label: "dropchad on GitHub", href: "https://github.com/example" },
  { key: "x", label: "dropchad on X", href: "https://x.com/dropchadfun" },
  { key: "telegram", label: "dropchad on Telegram", href: "https://t.me/dropchad" },
  { key: "youtube", label: "dropchad on YouTube", href: "https://www.youtube.com/@dropchad" },
];

/** The aria labels in page order. */
const order = (html: string) =>
  [...html.matchAll(/aria-label="dropchad on (\w+)"/g)].map((m) => m[1]);

describe("SOCIAL_MARKS", () => {
  it("are the Tabler Icons 3.48.0 outline paths, not Simple Icons", () => {
    expect(SOCIAL_MARKS.x).toEqual([
      "M4 4l11.733 16h4.267l-11.733 -16l-4.267 0",
      "M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772",
    ]);
    // The plane alone, no circle.
    expect(SOCIAL_MARKS.telegram).toEqual(["M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4"]);
    // The rounded box and the play triangle, `brand-youtube.svg`.
    expect(SOCIAL_MARKS.youtube).toEqual([
      "M2 8a4 4 0 0 1 4 -4h12a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-12a4 4 0 0 1 -4 -4v-8",
      "M10 9l5 3l-5 3l0 -6",
    ]);
    expect(SOCIAL_MARKS.github).toHaveLength(1);
    expect(SOCIAL_MARKS.github[0]?.startsWith("M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5")).toBe(
      true,
    );
    for (const paths of Object.values(SOCIAL_MARKS)) {
      for (const d of paths) expect(d).not.toMatch(/^M11\.944 0|^M14\.234|^M12 \.297/);
    }
  });
});

describe("SocialLinks", () => {
  const header = renderToStaticMarkup(<SocialLinks links={links} placement="header" />);
  const footer = renderToStaticMarkup(<SocialLinks links={links} placement="footer" />);

  it("draws every mark as one outline family: stroke 2, round, no fill, 20px", () => {
    for (const html of [header, footer]) {
      const svgs = html.match(/<svg [^>]*>/g) ?? [];
      expect(svgs).toHaveLength(4);
      for (const svg of svgs) {
        expect(svg).toContain('viewBox="0 0 24 24"');
        expect(svg).toContain('fill="none"');
        expect(svg).toContain('stroke="currentColor"');
        expect(svg).toContain('stroke-width="2"');
        expect(svg).toContain('stroke-linecap="round"');
        expect(svg).toContain('stroke-linejoin="round"');
        expect(svg).toMatch(/class="size-5"/);
      }
      for (const paths of Object.values(SOCIAL_MARKS)) {
        for (const d of paths) expect(html).toContain(`d="${d}"`);
      }
    }
  });

  it("links each mark in a new tab, grey with a mint hover", () => {
    for (const html of [header, footer]) {
      const anchors = html.match(/<a [^>]*>/g) ?? [];
      expect(anchors).toHaveLength(4);
      for (const anchor of anchors) {
        expect(anchor).toContain('target="_blank"');
        expect(anchor).toContain('rel="noopener noreferrer"');
        expect(anchor).toContain("hover:text-chad-accent");
      }
      expect(html).toContain('aria-label="dropchad on X"');
      expect(html).toContain('aria-label="dropchad on Telegram"');
      expect(html).toContain('aria-label="dropchad on GitHub"');
      expect(html).toContain('aria-label="dropchad on YouTube"');
    }
  });

  it("shows in the top bar on desktop only, 32px targets", () => {
    expect(header).toMatch(/^<ul class="[^"]*\bhidden md:flex\b/);
    expect(header).toContain("text-chad-text-dim");
    expect(header).toContain("size-8");
  });

  it("shows in the footer on phone only, 44px targets", () => {
    expect(footer).toMatch(/^<ul class="[^"]*\bmd:hidden\b/);
    expect(footer).toContain("size-11");
  });

  it("keeps the order GitHub, X, Telegram, YouTube", () => {
    for (const html of [header, footer])
      expect(order(html)).toEqual(["GitHub", "X", "Telegram", "YouTube"]);
  });

  it("shows an icon with no link as a plain icon: no link, no hover, no new tab", () => {
    const html = renderToStaticMarkup(
      <SocialLinks
        links={links.map((l) => (l.key === "github" ? { ...l, href: "" } : l))}
        placement="header"
      />,
    );
    expect(order(html)).toEqual(["GitHub", "X", "Telegram", "YouTube"]);
    expect(html).toContain(SOCIAL_MARKS.github[0]);
    expect(html.match(/<a [^>]*>/g)).toHaveLength(3);
    expect(html).not.toContain('href=""');
    const plain = html.match(/<span [^>]*aria-label="dropchad on GitHub"[^>]*>/)?.[0] ?? "";
    expect(plain).toContain('role="img"');
    expect(plain).toContain("size-8");
    expect(plain).not.toContain("hover:");
    expect(plain).not.toContain("interactive");
    expect(plain).not.toContain("target=");
  });

  it("still shows every icon when no link is set at all", () => {
    const none = renderToStaticMarkup(
      <SocialLinks links={links.map((l) => ({ ...l, href: "" }))} placement="footer" />,
    );
    expect(none).not.toContain("<a ");
    expect(order(none)).toEqual(["GitHub", "X", "Telegram", "YouTube"]);
  });

  it("reads lib/social by default: all four linked, GitHub to the public repo", () => {
    const html = renderToStaticMarkup(<SocialLinks placement="header" />);
    expect(order(html)).toEqual(["GitHub", "X", "Telegram", "YouTube"]);
    expect(html.match(/<a [^>]*>/g)).toHaveLength(4);
    expect(html).toContain('href="https://github.com/dropchadfun/dropchad"');
    expect(html).toContain('href="https://x.com/dropchadfun"');
    expect(html).toContain('href="https://t.me/dropchad"');
    expect(html).toContain('href="https://www.youtube.com/@dropchad"');
  });
});
