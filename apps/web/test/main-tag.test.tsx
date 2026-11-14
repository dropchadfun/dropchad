/**
 * The main tag. A person has one tag, the main tag.
 * Drop rows, board rows, the drop page and the profile show it alone: no `+2`, no count, no box.
 * The picker has no `main tag` row: the one tag picked is the main tag. `musician` sits after
 * `streamer`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import { DropRows } from "@/components/drops/DropRows";
import type { DropCardData } from "@/components/drops/drop-card-data";
import { MainTagPill } from "@/components/site/MainTag";
import { TagList } from "@/components/site/TagPill";
import type { BoardRow, Profile } from "@/lib/api";
import { MAIN_TAG_HINT, mainTag, PROFILE_TAGS, tagColorVar, toggleTag } from "@/lib/tags";

const SRC = join(__dirname, "..", "src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sample: Profile = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: null,
  kind: "chad",
  tags: ["musician", "dev", "kol"],
  tagLockedUntil: null,
  badges: [],
};

const card = (creator: Profile | null): DropCardData => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  title: "gm",
  creator,
  chip: "LIVE",
  amountWei: "300000000000000",
  receivers: 3,
  claimed: 1,
  createdAt: 1_700_000_000,
});

const boardRow = (profile: Profile): BoardRow => ({
  rank: 2,
  profile,
  totalWei: "300000000000000",
  dropCount: 1,
  claimCount: 1,
  uniqueReceivers: 3,
  biggestDropWei: "300000000000000",
  lastDropAt: 1_700_000_000,
  usd: 0,
  byChain: [],
});

/** The words inside every pill of some markup, in order. */
function pills(html: string): string[] {
  return [...html.matchAll(/class="pill[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");
}

describe("musician", () => {
  it("is in the list right after streamer, ten tags in all", () => {
    expect(PROFILE_TAGS).toEqual([
      "chad",
      "kol",
      "dev",
      "streamer",
      "musician",
      "trader",
      "community",
      "memecoin",
      "utility",
      "nft",
    ]);
  });

  it("has its own periwinkle token, read through the variable", () => {
    expect(tagColorVar("musician")).toBe("var(--chad-tag-musician)");
    expect(read("app/globals.css").toLowerCase()).toContain("--chad-tag-musician: #9da8f5;");
  });
});

describe("the main tag is the first of the list", () => {
  it("mainTag is the first one, or none", () => {
    expect(mainTag(["musician", "dev"])).toBe("musician");
    expect(mainTag([])).toBeNull();
  });

  it("the one tag picked is the main tag, the last tap wins", () => {
    const picked = toggleTag(toggleTag([], "dev"), "musician");
    expect(picked).toEqual(["musician"]);
    expect(mainTag(picked)).toBe("musician");
    expect(mainTag(toggleTag(picked, "musician"))).toBeNull();
  });
});

describe("rows, boards and the drop page show only the main tag", () => {
  it("the pill alone: no count and no box with the others", () => {
    const html = renderToStaticMarkup(<MainTagPill tags={["musician", "dev", "kol"]} />);
    expect(pills(html)).toEqual(["musician"]);
    expect(html).not.toContain("more-tags");
    expect(html).not.toMatch(/\+\d/);
    expect(renderToStaticMarkup(<MainTagPill tags={[]} />)).toBe("");
  });

  it("a drop row: the main tag on phone and desktop, nothing else", () => {
    const html = renderToStaticMarkup(<DropRows rows={[card(sample)]} />);
    expect(pills(html)).toEqual(["musician", "musician"]);
    expect(html).not.toContain("more-tags");
    expect(html).not.toMatch(/>\+\d</);
  });

  it("a board row: the main tag next to the handle, nothing else", () => {
    const html = renderToStaticMarkup(<BoardRows rows={[boardRow(sample)]} />);
    expect(pills(html)).toEqual(["musician"]);
    expect(html).not.toContain("more-tags");
  });

  it("the +N component and its css are gone, and nothing imports them", () => {
    expect(existsSync(join(SRC, "components", "site", "FirstTag.tsx"))).toBe(false);
    expect(read("app/globals.css")).not.toContain("more-tags");
    for (const file of files(SRC).filter((f) => /\.tsx?$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/FirstTag|more-tags/);
    }
  });

  it("the drop page, live and finished, uses the main tag pill", () => {
    expect(read("components/drops/LiveView.tsx")).toContain("<MainTagPill");
    expect(read("components/drops/AfterView.tsx")).toContain("<MainTagPill");
  });
});

describe("the profile shows the one tag", () => {
  it("its pill alone", () => {
    const html = renderToStaticMarkup(<TagList tags={["musician"]} />);
    expect(pills(html)).toEqual(["musician"]);
  });
});

describe("the picker has no main tag row", () => {
  it("the row and its file are gone, and nothing imports them", () => {
    expect(existsSync(join(SRC, "components", "profile", "MainTagRow.tsx"))).toBe(false);
    for (const file of files(SRC).filter((f) => /\.tsx?$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/MainTagRow|setMain\(|canPick\(/);
    }
  });

  it("the picker still says what the main tag does", () => {
    expect(MAIN_TAG_HINT).toBe("your main tag shows on your drops and the boards.");
    const picker = read("components/profile/ProfileTags.tsx");
    expect(picker).toContain("MAIN_TAG_HINT");
    for (const file of files(SRC)) {
      expect(readFileSync(file, "utf8"), file).not.toContain("the first one you tap");
    }
  });

  it("the picker label says your tag, one tag per person", () => {
    const picker = read("components/profile/ProfileTags.tsx");
    expect(picker).toContain('<p className="type-label">your tag</p>');
    for (const file of files(SRC)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/your tags/i);
    }
  });
});
