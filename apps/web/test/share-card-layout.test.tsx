/**
 * The `your card` section's layout: from tablet width up two columns, the
 * controls left and the card preview right at about half the page, never wider than 640px. On
 * the phone as before: the card on top, the controls under it. The PNG stays 1600 by 900; only
 * the preview is smaller. Rendered with `react-dom/server`, no canvas drawing here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShareCardEditor } from "@/components/drops/ShareCard";
import type { ShareCardData } from "@/components/drops/share-card";

const CARD: ShareCardData = {
  chainKey: "solana-devnet",
  symbol: "SOL",
  decimals: 9,
  amount: "20000000",
  people: 2,
  sender: { handle: "samplesender", profileImageUrl: null },
  receivers: [
    { handle: "samplechad", profileImageUrl: null },
    { handle: "sampledev", profileImageUrl: null },
  ],
  rest: 0,
  rank: null,
};

const html = renderToStaticMarkup(<ShareCardEditor card={CARD} />);

/** The class list of the element that opens just before `marker` in the markup. */
function classesAround(marker: string): string[] {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const before = html.slice(0, at);
  const open = before.lastIndexOf('<div class="');
  return (
    before
      .slice(open + '<div class="'.length)
      .split('"')[0]
      ?.split(" ") ?? []
  );
}

describe("your card, the layout", () => {
  // the preview about 58% of the section, 5 to 7.
  it("two columns from tablet width up, the preview about 58% wide; one column on the phone", () => {
    expect(html).toMatch(
      /class="[^"]*\bmd:grid\b[^"]*\bmd:grid-cols-\[minmax\(0,5fr\)_minmax\(0,7fr\)\][^"]*"/,
    );
    expect(html).not.toContain("md:grid-cols-2");
  });

  it("both columns start and end on the same lines: the post box grows, the buttons at the bottom", () => {
    expect(html).toMatch(/class="[^"]*\bmd:grid\b[^"]*\bmd:items-stretch\b/);
    expect(classesAround('<p class="type-label')).toEqual(
      expect.arrayContaining(["md:flex", "md:flex-col"]),
    );
    expect(html).toMatch(/<textarea[^>]*class="[^"]*\bmd:flex-1\b[^"]*\bmd:resize-none\b/);
    expect(classesAround("<textarea")).toEqual(
      expect.arrayContaining(["md:flex", "md:flex-1", "md:flex-col"]),
    );
    expect(classesAround(">download card<")).toContain("md:mt-auto");
  });

  it("design and picture buttons: compact pills on tablet and desktop, 44px on the phone", () => {
    const pills = html.match(/<(?:button|label)[^>]*>(?:clean|center|fun|add picture)</g) ?? [];
    expect(pills).toHaveLength(4);
    for (const pill of pills) {
      expect(pill).toMatch(/\bh-11\b/);
      expect(pill).toMatch(/\bmd:h-8\b/);
      expect(pill).toMatch(/\bmd:rounded-full\b/);
    }
  });

  // simple words for international crypto people.
  it("the words: the top line, the picture button, the line under it", () => {
    expect(html).toContain(">only you can see this card. share it on X.<");
    expect(html).toContain(">add picture<");
    // The picture line: it says the best shape.
    expect(html).toContain(">best is a 16:9 picture, like 1920 x 1080.<");
    for (const old of [
      "any picture or meme from your phone or pc.",
      "only you see this. post it and the chads you dropped on find out.",
      ">your picture<",
      "stays on this device",
      "a gif shows its first frame",
    ])
      expect(html).not.toContain(old);
  });

  it("no picture yet: no zoom slider and no reset", () => {
    expect(html).not.toContain('aria-label="zoom"');
    expect(html).not.toContain(">reset<");
  });

  it("the preview: right on tablet and desktop, at most 640px; first in the page for the phone", () => {
    const preview = classesAround("<canvas");
    expect(preview).toEqual(expect.arrayContaining(["md:order-2", "max-w-[640px]"]));
    // On the phone the source order is the order: the card comes before the controls.
    expect(html.indexOf("<canvas")).toBeLessThan(html.indexOf(">design<"));
  });

  it("the controls: left on tablet and desktop, with every control in them", () => {
    const controls = classesAround('<p class="type-label');
    expect(controls).toContain("md:order-1");
    for (const word of [
      ">design<",
      ">background<",
      ">your post<",
      ">download card<",
      ">post on X<",
    ])
      expect(html).toContain(word);
  });

  it("the PNG stays 1600 by 900, only the preview is drawn smaller", () => {
    expect(html).toMatch(/<canvas[^>]*width="1600"[^>]*height="900"/);
  });
});
