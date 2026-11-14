/**
 * The top 3 board rows glow:
 * a soft mint gradient that fades in from the right edge of
 * the row, about 12 percent, under the text, kept on hover; the 2px mint line on the left
 * stays. Rows 1 to 3 only, on `/boards` and the front page `top chads`. Never red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import type { BoardRow, Profile } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
const topRule = /\.board-top \{([^}]*)\}/.exec(css)?.[1] ?? "";

const person = (n: number): Profile => ({
  xUserId: String(n),
  handle: `glowchad${String(n)}`,
  displayName: "sample",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
});

const row = (n: number): BoardRow => ({
  rank: n,
  profile: person(n),
  totalWei: "1",
  dropCount: 1,
  claimCount: 1,
  uniqueReceivers: 50 - n,
  biggestDropWei: "1",
  lastDropAt: 1,
  usd: 1,
  byChain: [],
});

const html = renderToStaticMarkup(
  <BoardRows rows={[1, 2, 3, 4, 5].map(row)} rankedBy="uniqueReceivers" testnetOnly={false} />,
);

function rowOf(n: number): string {
  const parts = html.split(/(?=<div class="[^"]*board-row)/);
  return parts.find((part) => part.includes(`@glowchad${String(n)}<`)) ?? "";
}

describe("the glow on the top 3 board rows", () => {
  it("a mint gradient that fades in from the right edge", () => {
    const gradient = /background-image:\s*linear-gradient\(\s*to left,([^;]*)\);/.exec(topRule);
    expect(gradient, topRule).not.toBeNull();
    expect(gradient?.[1]).toContain("var(--chad-accent)");
    // It fades out to nothing towards the left.
    expect(gradient?.[1]).toContain("transparent");
  });

  it("soft: the mint is 12 percent or less", () => {
    const strength = /color-mix\(in srgb, var\(--chad-accent\) (\d+)%/.exec(topRule);
    expect(strength, topRule).not.toBeNull();
    expect(Number(strength?.[1])).toBeGreaterThan(0);
    expect(Number(strength?.[1])).toBeLessThanOrEqual(12);
  });

  it("a background image, never the background shorthand, so the hover colour shows under it", () => {
    expect(topRule).not.toMatch(/(^|[\s;])background\s*:/);
  });

  it("the 2px mint line on the left stays", () => {
    expect(topRule).toContain("inset 2px 0 0 var(--chad-accent)");
  });

  it("never red, never the number greens", () => {
    for (const token of ["--chad-down", "--chad-error", "--chad-up"]) {
      expect(topRule, token).not.toContain(token);
    }
  });

  it("rows 1 to 3 glow, the other rows stay plain", () => {
    for (const n of [1, 2, 3]) expect(rowOf(n), String(n)).toMatch(/class="[^"]*board-top/);
    for (const n of [4, 5]) expect(rowOf(n), String(n)).not.toMatch(/class="[^"]*board-top/);
  });

  it("the front page top chads and /boards draw the same rows", () => {
    const block = readFileSync(join(SRC, "components", "boards", "BoardBlock.tsx"), "utf8");
    expect(block).toContain("<BoardRows");
    const front = readFileSync(join(SRC, "components", "front", "FrontPage.tsx"), "utf8");
    expect(front).toContain("<BoardBlock");
    const boards = readFileSync(join(SRC, "components", "boards", "BoardsPage.tsx"), "utf8");
    expect(boards).toContain("<BoardBlock");
  });
});
