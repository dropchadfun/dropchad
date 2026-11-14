/**
 * The share card picture. The card stays
 * 1600 by 900, 16 by 9, on all three designs. The sender's picture fills the card and can be
 * moved by dragging and made bigger with a `zoom` slider, 1x to 3x; `reset` puts it back. It
 * never leaves an empty edge. A dark fade on the left under the text on `clean` and `fun`; on
 * `center` the picture stays evenly darker. The picture never leaves the device.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PictureControls } from "@/components/drops/ShareCard";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  PICTURE_START,
  PICTURE_ZOOM_MAX,
  PICTURE_ZOOM_MIN,
  cardPixels,
  movePicture,
  pictureFade,
  pictureRect,
  zoomPicture,
} from "@/components/drops/share-card";

const WIDE = { w: 3000, h: 1000 };
const TALL = { w: 1000, h: 3000 };
const FULL_HD = { w: 1920, h: 1080 };

/** The picture covers the whole card: no empty edge anywhere. */
function covers(rect: { x: number; y: number; w: number; h: number }): boolean {
  const e = 1e-6;
  return (
    rect.x <= e &&
    rect.y <= e &&
    rect.x + rect.w >= CARD_WIDTH - e &&
    rect.y + rect.h >= CARD_HEIGHT - e
  );
}

describe("the card is 16 by 9", () => {
  it("1600 by 900 on all three designs", () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1600, 900]);
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(16 / 9, 10);
  });
});

describe("the picture fills the card", () => {
  it("starts in the middle at 1x", () => {
    expect(PICTURE_START).toEqual({ dx: 0, dy: 0, zoom: 1 });
    expect([PICTURE_ZOOM_MIN, PICTURE_ZOOM_MAX]).toEqual([1, 3]);
  });

  it("a wide picture: full height, cropped from the middle, never stretched", () => {
    expect(pictureRect(WIDE, PICTURE_START)).toEqual({ x: -550, y: 0, w: 2700, h: 900 });
  });

  it("a tall picture: full width, cropped from the middle, never stretched", () => {
    expect(pictureRect(TALL, PICTURE_START)).toEqual({ x: 0, y: -1950, w: 1600, h: 4800 });
  });

  it("a 1920 by 1080 picture fits exactly", () => {
    expect(pictureRect(FULL_HD, PICTURE_START)).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
  });
});

describe("drag: up, down, left and right, never an empty edge", () => {
  it("a wide picture moves left and right, not up and down at 1x", () => {
    const right = movePicture(WIDE, PICTURE_START, 200, 300);
    expect(right).toEqual({ dx: 200, dy: 0, zoom: 1 });
    expect(pictureRect(WIDE, right)).toEqual({ x: -350, y: 0, w: 2700, h: 900 });
  });

  it("dragged too far, it stops at the edge", () => {
    expect(movePicture(WIDE, PICTURE_START, 5000, 0)).toEqual({ dx: 550, dy: 0, zoom: 1 });
    expect(movePicture(WIDE, PICTURE_START, -5000, 0)).toEqual({ dx: -550, dy: 0, zoom: 1 });
    expect(movePicture(TALL, PICTURE_START, 0, 9000)).toEqual({ dx: 0, dy: 1950, zoom: 1 });
    expect(movePicture(TALL, PICTURE_START, 0, -9000)).toEqual({ dx: 0, dy: -1950, zoom: 1 });
  });

  it("drags add up", () => {
    const once = movePicture(TALL, PICTURE_START, 0, -100);
    expect(movePicture(TALL, once, 0, -100)).toEqual({ dx: 0, dy: -200, zoom: 1 });
  });

  it("any drag and zoom still covers the whole card", () => {
    for (const size of [WIDE, TALL, FULL_HD, { w: 37, h: 41 }]) {
      let place = PICTURE_START;
      for (const [ddx, ddy, zoom] of [
        [900, -900, 1],
        [-3000, 40, 2.5],
        [120, 5000, 3],
        [0, 0, 1],
        [-77, 13, 1.4],
        [9999, 9999, 7],
        [-9999, -9999, 0.2],
      ] as const) {
        place = zoomPicture(size, movePicture(size, place, ddx, ddy), zoom);
        expect(covers(pictureRect(size, place)), JSON.stringify({ size, place })).toBe(true);
      }
    }
  });
});

describe("zoom: 1x to 3x", () => {
  it("2x makes the picture twice as big around the same middle", () => {
    expect(pictureRect(FULL_HD, zoomPicture(FULL_HD, PICTURE_START, 2))).toEqual({
      x: -800,
      y: -450,
      w: 3200,
      h: 1800,
    });
  });

  it("never under 1x, never over 3x", () => {
    expect(zoomPicture(WIDE, PICTURE_START, 0.5).zoom).toBe(1);
    expect(zoomPicture(WIDE, PICTURE_START, 9).zoom).toBe(3);
  });

  it("zooming back out pulls a moved picture back inside", () => {
    const zoomed = zoomPicture(FULL_HD, PICTURE_START, 3);
    const moved = movePicture(FULL_HD, zoomed, 1600, 900);
    expect(moved).toEqual({ dx: 1600, dy: 900, zoom: 3 });
    expect(zoomPicture(FULL_HD, moved, 1)).toEqual({ dx: 0, dy: 0, zoom: 1 });
  });
});

describe("the drag on the preview moves the card in card pixels", () => {
  it("a 400px wide preview: 1px of finger is 4px of card", () => {
    expect(cardPixels(10, 400)).toBe(40);
    expect(cardPixels(-25, 640)).toBe(-62.5);
  });

  it("no preview width yet: no move", () => {
    expect(cardPixels(10, 0)).toBe(0);
  });
});

describe("the fade under the text", () => {
  it("clean and fun: dark on the left edge, gone before the right third", () => {
    for (const design of ["clean", "fun"] as const) {
      const fade = pictureFade(design);
      expect(fade.kind).toBe("left");
      if (fade.kind !== "left") continue;
      const [first] = fade.stops;
      expect(first?.[0]).toBe(0);
      expect(first?.[1]).toBeGreaterThanOrEqual(0.85);
      const clear = fade.stops.find(([, alpha]) => alpha === 0);
      expect(clear).toBeDefined();
      expect(clear?.[0]).toBeLessThanOrEqual(2 / 3);
      // Darkest at the left, never darker further right.
      for (let i = 1; i < fade.stops.length; i += 1) {
        expect(fade.stops[i]?.[1]).toBeLessThanOrEqual(fade.stops[i - 1]?.[1] ?? 1);
      }
    }
  });

  it("center: the text is in the middle, the whole picture evenly darker", () => {
    expect(pictureFade("center")).toEqual({ kind: "even", alpha: 0.62 });
  });
});

describe("the zoom slider and reset", () => {
  const html = renderToStaticMarkup(
    <PictureControls zoom={1.5} onZoom={() => undefined} onReset={() => undefined} />,
  );

  it("a range from 1x to 3x with its label", () => {
    expect(html).toMatch(/<input[^>]*type="range"/);
    expect(html).toMatch(/<input[^>]*min="1"/);
    expect(html).toMatch(/<input[^>]*max="3"/);
    expect(html).toMatch(/<input[^>]*value="1.5"/);
    expect(html).toMatch(/<input[^>]*aria-label="zoom"/);
    expect(html).toContain(">zoom<");
  });

  it("the slider and reset: 44px on the phone, 32px pills from md", () => {
    expect(html).toMatch(/<input[^>]*class="[^"]*\bh-11\b[^"]*\bmd:h-8\b/);
    const reset = html.match(/<button[^>]*>reset</)?.[0] ?? "";
    expect(reset).toMatch(/type="button"/);
    expect(reset).toMatch(/\bh-11\b/);
    expect(reset).toMatch(/\bmd:h-8\b/);
    expect(reset).toMatch(/\bmd:rounded-full\b/);
  });
});
