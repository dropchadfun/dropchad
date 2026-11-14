/**
 * The fun design's three pictures: `chad` (the default),
 * `laugh` and `bowl`, picked with a small picker that shows on `fun` only. The card's text stays
 * on the left and never reaches the man's hand, arm or face on any of them.
 *
 * Where each figure starts was measured from the files themselves: the first column,
 * from the left, where the figure's pixels begin in the rows the text uses (y 40 to 760 of the
 * 1600 by 900 card), the art scaled to cover as `drawCover` does. Flame sparks around the chad do
 * not count; the forearm and the sleeves do.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FunArtPicker, ShareCardEditor } from "@/components/drops/ShareCard";
import {
  CARD_WIDTH,
  DEFAULT_FUN_ART,
  FUN_ARTS,
  fitNames,
  fitTextPx,
  funTextBoxes,
  type FunArtId,
  type ShareCardData,
} from "@/components/drops/share-card";

/** Card x where the hand or arm starts, in the rows the text uses. Measured, see the header. */
const FIGURE_LEFT: Record<FunArtId, number> = { chad: 767, laugh: 742, bowl: 808 };
/** At least this much dark space between the text and the figure. */
const CLEAR = 24;

const measure = (text: string, px: number) => text.length * px * 0.6;
const handles = (n: number) =>
  Array.from({ length: n }, (_, i) => `@longhandle${String(i).padStart(4, "0")}`);

describe("the three pictures", () => {
  it("chad, laugh, bowl, in that order, chad the default", () => {
    expect(FUN_ARTS.map((art) => art.id)).toEqual(["chad", "laugh", "bowl"]);
    expect(FUN_ARTS.map((art) => art.label)).toEqual(["chad", "laugh", "bowl"]);
    expect(DEFAULT_FUN_ART).toBe("chad");
  });

  it("each file is in public/share, 1672 by 941", () => {
    for (const art of FUN_ARTS) {
      expect(art.src).toBe(`/share/bg-${art.id}.png`);
      const png = readFileSync(join(process.cwd(), "public", art.src));
      expect(png.readUInt32BE(16), art.id).toBe(1672);
      expect(png.readUInt32BE(20), art.id).toBe(941);
    }
  });
});

describe("the text never reaches the hand, the arm or the face", () => {
  for (const id of ["chad", "laugh", "bowl"] as const) {
    it(`${id}: every text box ends at least ${String(CLEAR)}px before the figure`, () => {
      const box = funTextBoxes(id);
      const limit = FIGURE_LEFT[id] - CLEAR;
      expect(box.right).toBeLessThanOrEqual(limit);
      expect(box.list.x + box.list.width).toBeLessThanOrEqual(limit);
      expect(box.wall.x + box.wall.width).toBeLessThanOrEqual(limit);
      expect(box.barMax + 80).toBeLessThanOrEqual(limit);
      expect(box.lineMax + 80).toBeLessThanOrEqual(limit);
      expect(box.panelRight).toBeLessThanOrEqual(limit);
    });

    it(`${id}: still room to read, 30 long names stay 20px or more, 500 still all fit`, () => {
      const box = funTextBoxes(id);
      const list = fitNames(handles(30), { width: box.list.width, height: 520 }, measure, {
        max: 44,
        min: 20,
      });
      expect(list.fits).toBe(true);
      expect(list.px).toBeGreaterThanOrEqual(20);
      const wall = fitNames(handles(500), { width: box.wall.width, height: 750 }, measure, {
        max: 40,
        min: 8,
      });
      expect(wall.fits).toBe(true);
      expect(wall.lines.flat()).toHaveLength(500);
    });
  }

  it("the clean and center designs keep the whole card", () => {
    expect(funTextBoxes(null).right).toBe(CARD_WIDTH);
  });
});

describe("the sent to line shrinks to fit, never cut", () => {
  it("40px when it fits, smaller when it does not, never under the minimum", () => {
    expect(fitTextPx("sent to 2 chads on Solana", 1000, measure, { max: 40, min: 24 })).toBe(40);
    const long = "sent to 500 chads on Robinhood";
    const px = fitTextPx(long, 630, measure, { max: 40, min: 24 });
    expect(px).toBeLessThan(40);
    expect(measure(long, px)).toBeLessThanOrEqual(630);
    expect(fitTextPx(long, 10, measure, { max: 40, min: 24 })).toBe(24);
  });
});

describe("the picker", () => {
  it("three small pills, the one in use pressed", () => {
    const html = renderToStaticMarkup(<FunArtPicker value="laugh" onChange={() => undefined} />);
    const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)</g)];
    expect(buttons.map((b) => [b[2], b[1]])).toEqual([
      ["chad", "false"],
      ["laugh", "true"],
      ["bowl", "false"],
    ]);
    // The same compact pill as the design buttons: 44px on the phone, 32px round from md.
    expect(html).toContain("md:h-8");
    expect(html).toContain("md:rounded-full");
  });

  it("not there on the clean design, the one the editor opens on", () => {
    const card: ShareCardData = {
      chainKey: "solana-devnet",
      symbol: "SOL",
      decimals: 9,
      amount: "20000000",
      people: 1,
      sender: { handle: "samplesender", profileImageUrl: null },
      receivers: [{ handle: "samplechad", profileImageUrl: null }],
      rest: 0,
      rank: null,
    };
    const html = renderToStaticMarkup(<ShareCardEditor card={card} />);
    expect(html).not.toContain(">laugh<");
    expect(html).not.toContain(">bowl<");
  });
});
