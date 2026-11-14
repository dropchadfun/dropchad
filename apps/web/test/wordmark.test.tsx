/**
 * The wordmark: `dropchad` as real text in an svg, `drop` in the text colour and
 * `chad` in the hand's mint, set in Inter through the page's own font variable. Rendered with
 * `react-dom/server`, no browser: what a crawler and a screen reader get.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as wordmark from "@/components/site/Wordmark";
import { Mark, WordmarkText } from "@/components/site/Wordmark";

const WEB = resolve(__dirname, "..");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

describe("WordmarkText", () => {
  const html = renderToStaticMarkup(<WordmarkText />);

  it("is an svg image named dropchad, with the word as text", () => {
    expect(html).toMatch(/^<svg[^>]*role="img"[^>]*aria-label="dropchad"/);
    expect(html).toContain("<text");
    expect(html).toContain(">drop</tspan>");
    expect(html).toContain(">chad</tspan>");
    expect(html).not.toContain("<image");
  });

  it("colours drop with the text token and chad with the brand mint token", () => {
    expect(html).toContain('fill="var(--chad-text)">drop');
    expect(html).toContain('fill="var(--chad-brand-mint)">chad');
  });

  it("is set in the page font, Inter 600 at the display tracking", () => {
    expect(html).toContain('font-family="var(--font-inter), Inter, system-ui, sans-serif"');
    expect(html).toContain('font-weight="600"');
    expect(html).toContain('letter-spacing="-2"'); // -0.02em at the 100 unit font size
  });

  it("keeps the measured aspect: 4.48 wide per unit of height", () => {
    expect(html).toContain('viewBox="0 0 448 100"');
    expect(html).toContain('height="20"');
    expect(html).toContain('width="89.6"');
    expect(renderToStaticMarkup(<WordmarkText height={120} />)).toContain('width="537.6"');
  });
});

describe("Mark", () => {
  const html = renderToStaticMarkup(<Mark />);

  it("is the real logo file as a picture, never a traced path", () => {
    // React adds a <link rel="preload"> for the image in front of it; that is fine.
    expect(html).toMatch(/<img [^>]*src="\/brand\/mark-24\.png"/);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<path");
    expect(Object.keys(wordmark)).not.toContain("MARK_PATH");
  });

  it("is sharp at 24px: its own 24, 48 and 72 renders for 1x, 2x and 3x screens", () => {
    expect(html).toContain('src="/brand/mark-24.png"');
    expect(html).toContain(
      'srcSet="/brand/mark-24.png 1x, /brand/mark-48.png 2x, /brand/mark-72.png 3x"',
    );
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    for (const px of [24, 48, 72]) {
      expect(pngSize(join(WEB, "public/brand", `mark-${px}.png`))).toEqual([px, px]);
    }
  });

  it("is decorative: the link around it already says dropchad home", () => {
    expect(html).toContain('alt=""');
  });
});

describe("the hand, one source", () => {
  it("has no traced svg icon: app/icon.svg is gone", () => {
    expect(existsSync(join(WEB, "src/app/icon.svg"))).toBe(false);
  });

  it("has no traced hand path left anywhere in the web source", () => {
    for (const file of filesUnder(join(WEB, "src"))) {
      if (!/\.(tsx?|svg|css)$/.test(file)) continue;
      expect(readFileSync(file, "utf8"), file).not.toContain("M582 0L797 207");
    }
  });
});
