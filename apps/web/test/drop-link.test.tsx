/**
 * `copy drop link`, for everyone. Every drop page, live and finished, has a button that copies
 * `https://dropchad.com/d/<address>` and says `copied` for 2 seconds. No X post, no post text;
 * the old `share this drop` button is gone. Rendered with `react-dom/server`; node has no
 * clipboard, so the click is checked in the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DropPage } from "@/components/drops/DropPage";
import { DROP_LINK_COPIED_MS, dropLink } from "@/components/drops/drop-link";
import * as shareCard from "@/components/drops/share-card";
import type { DropDetail, Profile } from "@/lib/api";

const DROP = "0xE6674f045A0554A6dAf5d09B24f6124756b1A421";
const SRC = join(__dirname, "..", "src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

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

/** The Robinhood drop `pay day`: two leaves, one paid to @dropchadfun. */
function detail(state: string, yours = false): DropDetail {
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
          status: state === "created" ? "Created" : state === "active" ? "Active" : "Finalized",
          totalEntitlements: "20000000000000",
          leafCount: 2,
          claimedCount: 1,
          createdAt: "1790838985",
        },
        claims: [
          {
            index: 1,
            recipient: "0x248262a0325f0d8c3a085449384aa06529a92af0",
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
        yours,
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
        fed: [{ index: 1, handle: "dropchadfun", profileImageUrl: null }],
      },
    },
  } as unknown as DropDetail;
}

const page = (state: string, yours = false) =>
  renderToStaticMarkup(<DropPage initial={detail(state, yours)} />);
const hasButton = (html: string) =>
  /<button [^>]*>(?:<svg.*?<\/svg>)?copy drop link<\/button>/.test(html);

describe("the link and the time", () => {
  it("the drop's own page on dropchad.com", () => {
    expect(dropLink(DROP)).toBe(`https://dropchad.com/d/${DROP}`);
  });

  it("`copied` for 2 seconds", () => {
    expect(DROP_LINK_COPIED_MS).toBe(2000);
  });

  it("the button copies that link and keeps `copied` that long", () => {
    const source = read("components/drops/drop-link.tsx");
    expect(source).toContain('label="copy drop link"');
    expect(source).toContain("value={dropLink(address)}");
    expect(source).toContain("doneMs={DROP_LINK_COPIED_MS}");
    expect(read("components/site/CopyButton.tsx")).toContain(
      "setTimeout(() => setDone(false), doneMs)",
    );
  });
});

describe("who sees it, where", () => {
  it("live and finished, signed out", () => {
    for (const state of ["funded", "active", "paying", "finished", "claims_expired"]) {
      expect(hasButton(page(state)), state).toBe(true);
    }
  });

  it("the sender too", () => {
    expect(hasButton(page("active", true))).toBe(true);
    expect(hasButton(page("finished", true))).toBe(true);
  });

  it("under who got fed", () => {
    for (const state of ["active", "finished"]) {
      const html = page(state);
      expect(html.indexOf("copy drop link"), state).toBeGreaterThan(html.indexOf("who got fed"));
    }
  });

  it("not while the drop waits for money", () => {
    expect(hasButton(page("created"))).toBe(false);
    expect(hasButton(page("created", true))).toBe(false);
  });

  it("never on a multisend", () => {
    expect(read("components/drops/MultisendView.tsx")).not.toContain("CopyDropLink");
  });
});

describe("share this drop is gone", () => {
  it("no button, no X post, no visitor post text", () => {
    for (const state of ["active", "finished", "claims_expired"]) {
      const html = page(state);
      expect(html, state).not.toContain("share this drop");
      expect(html, state).not.toContain("x.com/intent");
    }
    expect(shareCard).not.toHaveProperty("dropShareText");
    expect(shareCard).not.toHaveProperty("showDropShare");
  });
});
