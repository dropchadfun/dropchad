/**
 * The clean drop page. No rain and no replay
 * anywhere. The title, the chip, `people fed` with the bar, the amount, and `who got fed` in the
 * middle: each paid receiver by X picture and `@handle`, never the address the money landed on.
 * A row that arrives live gets one short mint flash. Rendered with `react-dom/server`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { DropPage } from "@/components/drops/DropPage";
import { LiveView, paidLabel, type PaidEntry } from "@/components/drops/LiveView";
import type { DropDetail, Profile } from "@/lib/api";

const DROP = "0xE6674f045A0554A6dAf5d09B24f6124756b1A421";
const WALLET = "0x248262a0325f0d8c3a085449384aa06529a92af0";
const ALICE_PIC = "https://pbs.twimg.com/profile_images/9/alice_normal.jpg";
const SRC = join(__dirname, "..", "src");

const creator = {
  xUserId: "1000000000000000001",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: null,
  kind: "kol",
  tags: ["dev", "kol"],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

/** The Robinhood drop `pay day` as the api sends it after: one leaf paid, one waiting. */
function detail(state: "created" | "active" | "finished", fed: unknown = undefined): DropDetail {
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
          claimedCount: 1,
          createdAt: "1790838985",
        },
        claims: [
          {
            index: 1,
            recipient: WALLET,
            amount: "10000000000000",
            kind: "handle",
            xId: "2095644323232505859",
            transactionHash: `0x71a564a3${"0".repeat(56)}`,
            finality: "final",
          },
        ],
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
        paidCount: 1,
        leafCount: 2,
        failedIndexes: [],
        totalEntitlementsWei: "20000000000000",
        feeAmountWei: "100000000000000",
        grossRequiredWei: "120000000000000",
        title: "pay day",
        memeImageUrl: null,
        createTxHash: `0x38ad395a${"0".repeat(56)}`,
        activateTxHash: `0x0392d310${"0".repeat(56)}`,
        lastTxHash: `0x71a564a3${"0".repeat(56)}`,
        lastError: null,
        createdAt: "2026-10-01T07:16:25.000Z",
        fed:
          fed === undefined
            ? [{ index: 1, handle: "dropchadfun", profileImageUrl: ALICE_PIC }]
            : fed,
      },
    },
  } as unknown as DropDetail;
}

const entry = (patch: Partial<PaidEntry> = {}): PaidEntry => ({
  index: 0,
  recipient: WALLET,
  handle: "alice",
  profileImageUrl: ALICE_PIC,
  amountWei: "10000000000000",
  txHash: `0x${"fe".repeat(32)}`,
  fresh: false,
  ...patch,
});

function live(paid: PaidEntry[], waiting = false): string {
  return renderToStaticMarkup(
    <LiveView
      address={DROP}
      chainId={46630}
      title="pay day"
      creator={creator}
      amountWei="20000000000000"
      createdAt={1790838985}
      leafCount={2}
      paidCount={paid.length}
      paid={paid}
      waiting={waiting}
    />,
  );
}

describe("no rain, no replay, anywhere", () => {
  it("the rain component is gone and nothing in the web mentions it", () => {
    expect(existsSync(join(SRC, "components", "rain", "RainCanvas.tsx"))).toBe(false);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/RainCanvas|watch replay|raining|to the rain|rain starts/);
    }
  });

  it("the live page: no canvas, no replay, the people fed counter, the bar and the amount", () => {
    const html = renderToStaticMarkup(<DropPage initial={detail("active")} />);
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("replay");
    expect(html).toContain("people fed");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("0.00002");
    expect(html).toContain(">LIVE<");
    expect(html).toContain("pay day");
  });

  it("the finished page: no canvas, no replay button", () => {
    const html = renderToStaticMarkup(<DropPage initial={detail("finished")} />);
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("replay");
    expect(html).toContain("people fed");
    expect(html).toContain('role="progressbar"');
  });
});

describe("the sender line", () => {
  it("live and finished: the sender's main tag as one pill, never the grey kind word", () => {
    for (const state of ["active", "finished"] as const) {
      const html = renderToStaticMarkup(<DropPage initial={detail(state)} />);
      expect(html, state).toMatch(/class="pill pill-on[^"]*"[^>]*>dev</);
      // Only the main tag: kol is not on the page, no +1 and no box.
      expect(html, state).not.toMatch(/class="pill[^"]*"[^>]*>kol</);
      expect(html, state).not.toContain('text-chad-text-mute">kol<');
      expect(html, state).not.toMatch(/>\+\d</);
      expect(html, state).not.toContain("more-tags");
      // The X link right after the sender, a new tab.
      expect(html, state).toMatch(/<a [^>]*href="https:\/\/x.com\/samplechad"[^>]*target="_blank"/);
    }
  });
});

describe("who got fed, by handle", () => {
  it("each row: the X picture and the @handle, never the 0x address", () => {
    const html = renderToStaticMarkup(<DropPage initial={detail("active")} />);
    expect(html).toContain("who got fed");
    expect(html).toContain(">@dropchadfun<");
    expect(html).toContain(`src="${ALICE_PIC}"`);
    expect(html.toLowerCase()).not.toContain(WALLET);
    expect(html).not.toContain("0x2482…2af0");
  });

  it("the same on the finished page", () => {
    const html = renderToStaticMarkup(<DropPage initial={detail("finished")} />);
    expect(html).toContain(">@dropchadfun<");
    expect(html.toLowerCase()).not.toContain(WALLET);
  });

  it("no handle known: the leaf's place, `#2`, still never the address", () => {
    const html = renderToStaticMarkup(<DropPage initial={detail("active", [])} />);
    expect(html).toContain(">#2<");
    expect(html.toLowerCase()).not.toContain(WALLET);
    expect(paidLabel({ index: 4, handle: null })).toBe("#5");
    expect(paidLabel({ index: 0, handle: "alice" })).toBe("@alice");
  });

  it("the list sits in the middle, one column, not a side panel", () => {
    const html = live([entry()]);
    expect(html).not.toContain("<aside");
    expect(html).toContain("mx-auto");
  });
});

describe("the mint flash", () => {
  it("only a row that arrived live flashes, never one there on page load", () => {
    const html = live([
      entry({ index: 0, fresh: false }),
      entry({ index: 1, handle: "bob", fresh: true }),
    ]);
    // `<li` and a space or `>`, so the avatars' `<link rel="preload">` tags do not count.
    const rows = html.match(/<li(?:\s[^>]*)?>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.includes("fed-flash"))).toHaveLength(1);
    expect(html).toMatch(/<li[^>]*fed-flash[^>]*>(?:(?!<\/li>).)*@bob/);
  });

  it("is short, mint, and off with reduced motion", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.fed-flash\s*\{[^}]*animation:\s*fed-flash\s+(\d+)ms/);
    const ms = Number(/\.fed-flash\s*\{[^}]*animation:\s*fed-flash\s+(\d+)ms/.exec(css)?.[1]);
    expect(ms).toBeLessThanOrEqual(400);
    expect(css).toMatch(/@keyframes fed-flash[^}]*\{[^}]*--chad-accent/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.fed-flash\s*\{\s*animation:\s*none/,
    );
  });
});

describe("the finished page, the same clean layout", () => {
  const html = renderToStaticMarkup(<DropPage initial={detail("finished")} />);

  it("no value line on testnet: no live price, and the usd is not shown here", () => {
    expect(html).not.toContain("value then");
    expect(html).not.toContain("value now");
    // The mainnet line, `worth $2.40 when dropped`, is; not on testnet.
    expect(html).not.toContain("when dropped");
  });

  it("the proof at the bottom, after the list", () => {
    expect(html).toContain("proof");
    expect(html.indexOf("proof")).toBeGreaterThan(html.indexOf("who got fed"));
  });
});

describe("waiting for the money", () => {
  it("the funding line says the page moves on, not the rain", () => {
    const created = detail("created");
    const mine = {
      ...created,
      ours: { ...created.ours, data: { ...created.ours.data, yours: true } },
    } as unknown as DropDetail;
    const html = renderToStaticMarkup(<DropPage initial={mine} />);
    expect(html).toContain("fund the address below and this page moves on by itself.");
  });

  it("an empty live list waits for the first claim, no bags", () => {
    expect(live([], false)).toContain("nobody yet. waiting for the first claim.");
  });
});

describe("AfterView still renders on its own", () => {
  it("takes the same entries", () => {
    const html = renderToStaticMarkup(
      <AfterView
        detail={detail("finished")}
        paid={[entry({ index: 1, handle: "dropchadfun" })]}
        paidCount={1}
        leafCount={2}
        chainId={46630}
        amountWei="20000000000000"
        createdAt={1790838985}
        title="pay day"
        creator={creator}
        chip="DONE"
      />,
    );
    expect(html).toContain(">@dropchadfun<");
  });
});
