/**
 * The tag pills. Small round
 * pills like discord roles: a dark fill, the word and a thin border in the tag's own colour, no
 * dot, no emoji. The profile shows every tag under the name; drop rows, board rows and the drop
 * page show only the main tag, with no `+2` and no box. The grey `kol` /
 * `project` word next to a handle is gone everywhere: the pill replaces it. Rendered with
 * `react-dom/server`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import { DropRows } from "@/components/drops/DropRows";
import type { DropCardData } from "@/components/drops/drop-card-data";
import { TagList, TagPill } from "@/components/site/TagPill";
import type { BoardRow, Profile } from "@/lib/api";

const SRC = join(__dirname, "..", "src");

const sample: Profile = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: null,
  kind: "kol",
  tags: ["streamer", "dev", "kol"],
  tagLockedUntil: null,
  badges: [],
};

const card = (creator: Profile | null): DropCardData => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  title: "gm",
  imageUrl: null,
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

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the pill", () => {
  it("is the word alone on the tag's colour, nothing else inside", () => {
    const html = renderToStaticMarkup(<TagPill tag="dev" />);
    expect(html).toContain("--pill:var(--chad-tag-dev)");
    expect(html).toContain("pill-on");
    expect(pills(html)).toEqual(["dev"]);
  });

  it("is round, dark filled, with a thin border in the tag colour", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const pill = /\.pill \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const on = /\.pill-on \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(pill).toContain("border-radius: 999px");
    expect(pill).toMatch(/border: 1px solid/);
    expect(on).toContain("background: var(--chad-surface-2)");
    expect(on).toMatch(/border-color: color-mix\(in srgb, var\(--pill\)/);
    expect(on).toMatch(/color: color-mix\(in srgb, var\(--pill\)/);
  });

  it("an off pill that cannot be tapped is dimmer: three on, or locked", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const dim =
      /button\.pill\[aria-disabled="true"\]:not\(\.pill-on\) \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(dim).toContain("color: var(--chad-text-mute)");
  });
});

describe("the profile shows every tag, in order", () => {
  it("lists all three under the name", () => {
    expect(pills(renderToStaticMarkup(<TagList tags={["streamer", "dev", "kol"]} />))).toEqual([
      "streamer",
      "dev",
      "kol",
    ]);
  });

  it("is nothing at all with no tags", () => {
    expect(renderToStaticMarkup(<TagList tags={[]} />)).toBe("");
  });

  it("has no +N and no pop up: the profile shows them all", () => {
    const html = renderToStaticMarkup(<TagList tags={["streamer", "dev", "kol"]} />);
    expect(html).not.toMatch(/>\+\d</);
    expect(html).not.toContain("more-tags");
  });
});

describe("rows show the main tag only, and no grey kind word", () => {
  it("a drop row: the main tag on phone and desktop, no +N and no box", () => {
    const html = renderToStaticMarkup(<DropRows rows={[card(sample)]} />);
    // Twice: next to the handle on the phone, in its own column on desktop.
    expect(pills(html)).toEqual(["streamer", "streamer"]);
    expect(html).not.toMatch(/>\+\d</);
    expect(html).not.toContain("more-tags");
    expect(html).not.toContain('text-chad-text-mute">kol<');
  });

  it("one tag or two, the row shows the same single pill", () => {
    const one = renderToStaticMarkup(<DropRows rows={[card({ ...sample, tags: ["nft"] })]} />);
    expect(pills(one)).toEqual(["nft", "nft"]);
    const two = renderToStaticMarkup(
      <DropRows rows={[card({ ...sample, tags: ["nft", "dev"] })]} />,
    );
    expect(pills(two)).toEqual(["nft", "nft"]);
  });

  it("a drop row with no tags has no pill and no word", () => {
    const html = renderToStaticMarkup(
      <DropRows rows={[card({ ...sample, kind: "project", tags: [] })]} />,
    );
    expect(pills(html)).toEqual([]);
    expect(html).not.toContain(">project<");
  });

  it("a board row: the main tag next to the handle, the kind word gone", () => {
    const html = renderToStaticMarkup(<BoardRows rows={[boardRow(sample)]} />);
    expect(pills(html)).toEqual(["streamer"]);
    expect(html).not.toContain("more-tags");
    expect(html).not.toContain('text-chad-text-mute">kol<');
    const none = renderToStaticMarkup(
      <BoardRows rows={[boardRow({ ...sample, kind: "project", tags: [] })]} />,
    );
    expect(pills(none)).toEqual([]);
    expect(none).not.toContain(">project<");
  });

  it("the kind word component is gone, and nothing imports it", () => {
    expect(existsSync(join(SRC, "components", "drops", "KindBadge.tsx"))).toBe(false);
    for (const file of files(SRC).filter((f) => /\.tsx?$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toContain("KindBadge");
    }
  });
});
