/**
 * The hand on the share card: the logo, `dropchad-logo.png`, which lives in the
 * repo as `scripts/hand-silhouette.png` and is served as `/brand/hand-silhouette.png`. Never
 * `hand-1024.png`, that file is not for media. The space between the fingers stays see-through,
 * so it shows the card background; the hand is painted the brand mint with the file's own alpha,
 * Node has no canvas: the drawing itself is checked in Chrome.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HAND_AIR_RIGHT, HAND_INK, HAND_SRC, LOGO_INK } from "@/components/drops/ShareCard";

import { readPng } from "./png";

const WEB = join(__dirname, "..");
const source = readFileSync(join(WEB, "src", "components", "drops", "ShareCard.tsx"), "utf8");
const served = join(WEB, "public", HAND_SRC);

describe("share card hand", () => {
  it("draws the logo, never hand-1024.png", () => {
    expect(HAND_SRC).toBe("/brand/hand-silhouette.png");
    expect(source).not.toMatch(/\/brand\/hand-1024/);
  });

  it("keeps the space between the fingers see-through in the file", () => {
    const logo = readPng(served);
    for (const [x, y] of [
      [680, 420],
      [700, 400],
      [660, 450],
    ] as const)
      expect(logo.alpha(x, y)).toBe(0);
  });

  it("paints the mint with the file's own alpha, so the gap stays the card background", () => {
    expect(source).toMatch(/globalCompositeOperation = "source-in"/);
  });

  it("crops the logo at its real ink, measured from the file", () => {
    const logo = readPng(served);
    let [x0, y0, x1, y1] = [logo.width, logo.height, -1, -1];
    for (let y = 0; y < logo.height; y++)
      for (let x = 0; x < logo.width; x++)
        if (logo.alpha(x, y) > 0) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    expect(LOGO_INK).toEqual({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  });

  it("puts the hand where the old one was, so nothing else on the card moves", () => {
    expect(HAND_AIR_RIGHT).toBe((64 * (1024 - 930)) / 1024);
    expect(HAND_INK).toEqual({ x: 5.6875, y: 5.125, w: 52.5625 });
    // The ink fits the 64px square with the same scale on both sides.
    expect(HAND_INK.y + (LOGO_INK.h * HAND_INK.w) / LOGO_INK.w).toBeLessThan(64);
  });
});
