/**
 * A drop's GIF from GIPHY
 * "GIPHY". Rendered with `react-dom/server`, no browser: the GIF itself loads only in the browser,
 * so the server markup is the empty box of the right height and never a GIPHY URL.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialForm, reduceForm, gifForSubmit, type FormState } from "@/components/create/form";
import { GifField } from "@/components/create/GifField";
import { ClaimView } from "@/components/drops/ClaimView";
import type { ClaimItem } from "@/components/drops/claim";
import { DropGif } from "@/components/drops/DropGif";
import { DropPage } from "@/components/drops/DropPage";
import { fromListEntry, fromOwnCard } from "@/components/drops/drop-card-data";
import { gifSize } from "@/components/drops/gif-size";
import { PoweredByGiphy } from "@/components/drops/PoweredByGiphy";
import type { DropDetail, DropListEntry, OwnDropCard, Profile } from "@/lib/api";
import { chainPills } from "@/lib/chains";
import {
  GIPHY_RATING,
  GIPHY_SMALLEST_WIDTH,
  POWERED_BY_GIPHY_SRC,
  POWERED_BY_GIPHY_WIDTH,
  giphyKey,
  gridOptions,
  stillOf,
} from "@/lib/giphy";

const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");
const KEY = "test-sdk-key";
const GIF = { id: "3og0IV5cAmtbkeKPBe", kind: "gif" } as const;
const BOX = "data-drop-gif";

afterEach(() => {
  vi.unstubAllEnvs();
});

const withKey = () => vi.stubEnv("NEXT_PUBLIC_GIPHY_SDK_KEY", KEY);

// -- the key, the rating, the still frame --------------------------------------------------------

describe("lib/giphy", () => {
  it("reads the public SDK key; unset or empty is null", () => {
    vi.stubEnv("NEXT_PUBLIC_GIPHY_SDK_KEY", "");
    expect(giphyKey()).toBeNull();
    withKey();
    expect(giphyKey()).toBe(KEY);
  });

  it("search and trending use rating pg, the tab picks gifs or stickers", () => {
    expect(GIPHY_RATING).toBe("pg");
    expect(gridOptions("gif")).toMatchObject({ rating: "pg", type: "gifs" });
    expect(gridOptions("sticker")).toMatchObject({ rating: "pg", type: "stickers" });
  });

  it("the still frame for reduced motion is GIPHY's own still URL, unchanged", () => {
    const url = "https://media2.giphy.com/media/abc/200_s.gif?cid=x&rid=200_s.gif";
    expect(stillOf({ images: { fixed_height_still: { url } } })).toBe(url);
    expect(stillOf({ images: {} })).toBeNull();
  });

  it("the Powered By GIPHY mark is a file of ours, from GIPHY's own set", () => {
    expect(POWERED_BY_GIPHY_SRC.startsWith("/giphy/")).toBe(true);
    expect(existsSync(join(WEB, "public", POWERED_BY_GIPHY_SRC))).toBe(true);
  });
});

// -- the size ------------------------------------------------------------------------------------

describe("gifSize", () => {
  it("the box height, the width from the GIF's own shape", () => {
    expect(gifSize({ width: 480, height: 270 }, { boxHeight: 240, maxWidth: 600 })).toEqual({
      width: 427,
      height: 240,
    });
    expect(gifSize({ width: 200, height: 400 }, { boxHeight: 180, maxWidth: 358 })).toEqual({
      width: 90,
      height: 180,
    });
  });

  it("too wide for the card: shrinks to the card's width, the shape kept, never cropped", () => {
    const size = gifSize({ width: 1000, height: 200 }, { boxHeight: 240, maxWidth: 400 });
    expect(size).toEqual({ width: 400, height: 80 });
  });

  it("a GIF with no size gives the empty box's height and no width", () => {
    expect(gifSize({ width: 0, height: 0 }, { boxHeight: 240, maxWidth: 400 })).toEqual({
      width: 0,
      height: 240,
    });
  });
});

// -- the box -------------------------------------------------------------------------------------

describe("DropGif on the server", () => {
  it("no GIF: nothing", () => {
    withKey();
    expect(renderToStaticMarkup(<DropGif giphy={null} />)).toBe("");
  });

  it("no key: nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_GIPHY_SDK_KEY", "");
    expect(renderToStaticMarkup(<DropGif giphy={GIF} />)).toBe("");
  });

  it("a GIF and a key: the empty box, 180 on phone and 240 from md, no GIPHY URL", () => {
    withKey();
    const html = renderToStaticMarkup(<DropGif giphy={GIF} />);
    expect(html).toContain(BOX);
    expect(html).toContain("h-[180px]");
    expect(html).toContain("md:h-[240px]");
    expect(html).not.toContain("giphy.com");
    expect(html).not.toContain("<img");
  });
});

// -- the drop page -------------------------------------------------------------------------------

const DROP = "0xE6674f045A0554A6dAf5d09B24f6124756b1A421";
const creator = {
  xUserId: "1000000000000000001",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: null,
  kind: "kol",
  tags: [],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

function detail(state: "created" | "active" | "finished", giphy: unknown): DropDetail {
  return {
    address: DROP,
    chain: {
      source: "indexer",
      available: true,
      indexed: true,
      data: {
        drop: {
          address: DROP,
          chainId: 46630,
          status: state === "created" ? "Created" : "Active",
          totalEntitlements: "20000000000000",
          leafCount: 2,
          claimedCount: state === "created" ? 0 : 1,
          createdAt: "1790838985",
        },
        claims: [],
        events: [],
      },
    },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        creator,
        yours: false,
        chainId: 46630,
        chainKey: "robinhood-testnet",
        mode: "handle",
        state,
        paidCount: state === "created" ? 0 : 1,
        leafCount: 2,
        failedIndexes: [],
        totalEntitlementsWei: "20000000000000",
        feeAmountWei: "0",
        grossRequiredWei: "20000000000000",
        title: "pay day",
        giphy,
        createTxHash: `0x38ad395a${"0".repeat(56)}`,
        activateTxHash: null,
        lastTxHash: null,
        lastError: null,
        createdAt: "2026-10-01T07:16:25.000Z",
        fed: [],
      },
    },
  } as unknown as DropDetail;
}

describe("the drop page", () => {
  for (const state of ["created", "active", "finished"] as const) {
    it(`${state}: the GIF box at the top of the card, above the title`, () => {
      withKey();
      const html = renderToStaticMarkup(<DropPage initial={detail(state, GIF)} />);
      expect(html).toContain(BOX);
      expect(html.indexOf(BOX)).toBeLessThan(html.indexOf("pay day"));
    });
  }

  it("no GIF: no box", () => {
    withKey();
    const html = renderToStaticMarkup(<DropPage initial={detail("active", null)} />);
    expect(html).not.toContain(BOX);
  });
});

// -- the claim page ------------------------------------------------------------------------------

const CLAIM_DROP = "0x00000000000000000000000000000000000d0b01";
const OTHER_DROP = "0x00000000000000000000000000000000000d0b02";

const claimItem = (patch: Partial<ClaimItem> = {}): ClaimItem => ({
  drop: CLAIM_DROP,
  chainKey: "robinhood-testnet",
  chainId: 46630,
  title: "gm chads",
  giphy: GIF,
  sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
  amount: "500000000000000000",
  symbol: "ETH",
  decimals: 18,
  index: 0,
  claimDeadline: "1791806400",
  state: "claimable",
  recipient: null,
  claimTxHash: null,
  ...patch,
});

function claimPage(selected: string | null, claims: ClaimItem[]): string {
  return renderToStaticMarkup(
    <ClaimView
      session={{ handle: "alice" }}
      claims={claims}
      freshLoginSecondsLeft={600}
      selected={selected}
    />,
  );
}

describe("the claim page", () => {
  it("the open drop card shows the GIF box", () => {
    withKey();
    expect(claimPage(CLAIM_DROP, [claimItem()])).toContain(BOX);
  });

  it("the list rows never do", () => {
    withKey();
    const html = claimPage(null, [claimItem(), claimItem({ drop: OTHER_DROP })]);
    expect(html).toContain("gm chads");
    expect(html).not.toContain(BOX);
  });
});

// -- the lists -----------------------------------------------------------------------------------

describe("the rows", () => {
  it("a list entry and a profile card carry no picture link and no GIF", () => {
    const entry = {
      address: DROP,
      chainId: 46630,
      status: "Active",
      totalEntitlements: "1",
      leafCount: 1,
      claimedCount: 0,
      createdAt: "1790838985",
      dropchad: { mode: "handle", memeImageUrl: "https://example.com/old.png", giphy: GIF },
    } as unknown as DropListEntry;
    const card = {
      address: DROP,
      chainId: 46630,
      title: null,
      memeImageUrl: "https://example.com/old.png",
      giphy: GIF,
      creator: null,
      state: "active",
      totalEntitlementsWei: "1",
      leafCount: 1,
      paidCount: 0,
      createdAt: "2026-10-01T07:16:25.000Z",
    } as unknown as OwnDropCard;
    for (const data of [fromListEntry(entry), fromOwnCard(card)]) {
      expect(data).not.toHaveProperty("imageUrl");
      expect(JSON.stringify(data)).not.toContain("example.com");
      expect(JSON.stringify(data)).not.toContain(GIF.id);
    }
  });
});

// -- the create page -----------------------------------------------------------------------------

describe("the create form", () => {
  const pills = chainPills();
  const drop = (): FormState => initialForm(pills, "drop");

  it("a pick is kept and sent on a drop, the id and the kind only", () => {
    const state = reduceForm(drop(), { type: "gif", value: { ...GIF } });
    expect(gifForSubmit(state)).toEqual({ id: GIF.id, kind: "gif" });
  });

  it("removed: nothing sent", () => {
    const picked = reduceForm(drop(), { type: "gif", value: { ...GIF } });
    expect(gifForSubmit(reduceForm(picked, { type: "gif", value: null }))).toBeUndefined();
    expect(gifForSubmit(drop())).toBeUndefined();
  });

  it("never on a multisend, a pick made before the switch stays out", () => {
    const picked = reduceForm(drop(), { type: "gif", value: { ...GIF } });
    const multisend = reduceForm(picked, { type: "mode", mode: "multisend" });
    expect(gifForSubmit(multisend)).toBeUndefined();
  });

  it("the field: `gif or sticker`, `add a gif or sticker` on a drop with a key; nothing on a multisend or without a key", () => {
    withKey();
    const html = renderToStaticMarkup(<GifField mode="drop" value={null} onChange={() => {}} />);
    // The label is lowercase in the markup; `type-label` shows it uppercase, GIF OR STICKER.
    expect(html).toMatch(/<span class="type-label">gif or sticker<\/span>/);
    expect(html).toMatch(/<button[^>]*>add a gif or sticker<\/button>/);
    expect(
      renderToStaticMarkup(<GifField mode="multisend" value={null} onChange={() => {}} />),
    ).toBe("");
    vi.stubEnv("NEXT_PUBLIC_GIPHY_SDK_KEY", "");
    expect(renderToStaticMarkup(<GifField mode="drop" value={null} onChange={() => {}} />)).toBe(
      "",
    );
  });

  it("the create page puts the field under the title and sends no picture link", () => {
    const text = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(text).toContain("<GifField");
    expect(text.indexOf("<GifField")).toBeGreaterThan(text.indexOf('id="title"'));
    expect(text).not.toContain("memeImageUrl");
    expect(readFileSync(join(SRC, "lib", "api.ts"), "utf8")).not.toContain("memeImageUrl");
  });
});

// -- the privacy page and the packages -----------------------------------------------------------

describe("the privacy page", () => {
  it("names the gif id and says giphy sees the visitor's ip, in the lowercase of the page", () => {
    const text = readFileSync(join(SRC, "app", "privacy", "page.tsx"), "utf8");
    expect(text).toContain("the gif id");
    expect(text).toContain("giphy sees your ip address");
    expect(text).not.toContain("the title, the picture link");
  });
});

describe("the GIPHY packages GIPHY", () => {
  const json = (path: string) =>
    JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, string>>;

  it("are pinned exactly, and the GIPHY packages under them by root overrides", () => {
    const web = json(join(WEB, "package.json")).dependencies ?? {};
    expect(web["@giphy/react-components"]).toBe("10.1.2");
    expect(web["@giphy/js-fetch-api"]).toBe("5.8.0");
    expect(web["styled-components"]).toBe("6.5.3");
    expect(json(join(WEB, "..", "..", "package.json")).overrides).toEqual({
      "@giphy/js-analytics": "5.0.0",
      "@giphy/js-types": "5.1.0",
      "@giphy/js-util": "5.2.0",
    });
  });
});

// -- the Powered By GIPHY mark -------------------------------------------------------------------

describe("the Powered By GIPHY mark The drop GIF", () => {
  it("is 120px wide, never below GIPHY's smallest official logo width", () => {
    expect(GIPHY_SMALLEST_WIDTH).toBe(100);
    expect(POWERED_BY_GIPHY_WIDTH).toBe(120);
    expect(POWERED_BY_GIPHY_WIDTH).toBeGreaterThanOrEqual(GIPHY_SMALLEST_WIDTH);
  });

  it("is GIPHY's file, centred on its own line, at that width, the height from the file", () => {
    const html = renderToStaticMarkup(<PoweredByGiphy />);
    expect(html).toContain(`src="${POWERED_BY_GIPHY_SRC}"`);
    expect(html).toContain('alt="Powered By GIPHY"');
    expect(html).toContain('width="120"');
    expect(html).toMatch(/class="[^"]*\bmx-auto\b/);
    expect(html).toMatch(/class="[^"]*\bblock\b/);
    expect(html).toMatch(/class="[^"]*\bh-auto\b/);
    expect(html).not.toMatch(/\bh-4\b/);
  });

  it("the drop GIF and the picker both use it, and nothing draws the mark another way", () => {
    for (const file of [
      join(SRC, "components", "drops", "DropGif.tsx"),
      join(SRC, "components", "create", "GifPicker.tsx"),
    ]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("<PoweredByGiphy");
      expect(text, file).not.toContain("POWERED_BY_GIPHY_SRC");
    }
  });
});
