/**
 * On testnet every dollar total says `in test coins`
 * test coins are counted at real prices, so a total alone looks like real money. The front
 * page tile and the profile tile get a small grey line under the number; a board row's usd
 * part and a usd ranked board's big number get the words after the number. Mainnet unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows, usdAndDrops } from "@/components/boards/BoardRows";
import { TestCoinsLine } from "@/components/site/TestCoinsLine";
import type { BoardRow } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const row = {
  rank: 1,
  profile: {
    xUserId: "1",
    handle: "samplechad",
    displayName: "sample chad",
    profileImageUrl: null,
    kind: "chad",
    tags: [],
    tagLockedUntil: null,
    badges: [],
  },
  totalWei: "0",
  dropCount: 3,
  uniqueReceivers: 5,
  claimCount: 5,
  biggestDropWei: "0",
  lastDropAt: 0,
  usd: 3.61,
  byChain: [],
} as unknown as BoardRow;

describe("the tiles", () => {
  it("a small grey line in test coins on testnet", () => {
    const html = renderToStaticMarkup(<TestCoinsLine testnetOnly />);
    expect(html).toContain(">in test coins<");
    expect(html).toContain("text-chad-text-dim");
  });

  it("nothing on mainnet", () => {
    expect(renderToStaticMarkup(<TestCoinsLine testnetOnly={false} />)).toBe("");
  });

  it("the front page dropped tile and the profile dropped tile use it", () => {
    expect(read("components/front/FrontPage.tsx")).toContain("<TestCoinsLine");
    expect(read("app/u/[handle]/page.tsx")).toContain("<TestCoinsLine");
  });
});

describe("the board rows", () => {
  it("the usd part says in test coins on testnet", () => {
    // No-break spaces inside the usd part: on the phone the line wraps only at a `·`.
    expect(usdAndDrops(row, "fed", true)).toBe(
      "$3.61\u00a0in\u00a0test\u00a0coins · 3 drops · 5 payouts",
    );
  });

  it("unchanged on mainnet, and best token has no usd part either way", () => {
    expect(usdAndDrops(row, "fed", false)).toBe("$3.61 · 3 drops · 5 payouts");
    expect(usdAndDrops(row, "project", true)).toBe("3 drops · 5 payouts");
  });

  it("a usd ranked board says in test coins after the big number on testnet", () => {
    const html = renderToStaticMarkup(
      <BoardRows rows={[row]} rankedBy="usd" board="fed" testnetOnly />,
    );
    expect(html).toMatch(/\$3\.61<span[^>]*>\s*in test coins<\/span>/);
    expect(html).toContain("$3.61\u00a0in\u00a0test\u00a0coins · 3 drops · 5 payouts");
  });

  it("nothing added on mainnet", () => {
    const html = renderToStaticMarkup(
      <BoardRows rows={[row]} rankedBy="usd" board="fed" testnetOnly={false} />,
    );
    expect(html).not.toContain("in test coins");
  });
});
