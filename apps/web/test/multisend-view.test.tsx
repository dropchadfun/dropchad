/**
 * The multisend page `/m/<address>` as rendered.
 * `MultisendView.tsx`, rendered with `react-dom/server`, no
 * browser, so the live stream never opens here; the stream logic is in `multisend.test.ts`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MultisendView } from "@/components/drops/MultisendView";
import type { Receiver } from "@/components/drops/multisend";
import type { DropDetail, OwnState, Profile } from "@/lib/api";
import { txUrl } from "@/lib/chains";
import { shortAddress, shortHash } from "@/lib/format";

const DROP = "0x1111111111111111111111111111111111111111";
const ROOT = `0x${"33".repeat(32)}`;
const CREATE_TX = `0x${"55".repeat(32)}`;
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

const creator = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: "https://pbs.twimg.com/profile_images/sample.png",
  kind: "chad",
  tags: [],
} as unknown as Profile;

const wallet = (i: number) => `0x${(0xa00 + i).toString(16).padStart(40, "0")}`;

function receivers(count: number): Receiver[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    recipient: wallet(index),
    amount: "1000000000000000",
  }));
}

function detail(
  state: OwnState,
  count: number,
  paid: number,
  failedIndexes: number[] = [],
): DropDetail {
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
          status: state === "created" ? "Created" : state === "finished" ? "Finalized" : "Active",
          asset: "0x0000000000000000000000000000000000000000",
          creatorCommitment: `0x${"ab".repeat(32)}`,
          totalEntitlements: String(1_000_000_000_000_000n * BigInt(count)),
          leafCount: count,
          totalClaimed: String(1_000_000_000_000_000n * BigInt(paid)),
          claimedCount: paid,
          claimDeadline: null,
          fundingDeadline: "1800000000",
          verified: true,
          createdAt: String(Math.floor(NOW / 1000) - 180),
          transactionHash: CREATE_TX,
          finality: "final",
          statusFinality: "final",
        },
        claims: Array.from({ length: paid }, (_, index) => ({
          index,
          recipient: wallet(index),
          amount: "1000000000000000",
          transactionHash: `0x${(0xc00 + index).toString(16).padStart(64, "0")}`,
          finality: "final" as const,
        })),
        events: [],
      },
    },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        address: DROP,
        chainId: 46630,
        asset: "0x0000000000000000000000000000000000000000",
        title: null,
        memeImageUrl: null,
        state,
        mode: "address",
        totalEntitlementsWei: String(1_000_000_000_000_000n * BigInt(count)),
        leafCount: count,
        paidCount: paid,
        failedIndexes,
        createTxHash: CREATE_TX,
        activateTxHash: null,
        lastTxHash: null,
        creator,
        grossRequiredWei: String(1_010_000_000_000_000n * BigInt(count)),
        feeAmountWei: String(10_000_000_000_000n * BigInt(count)),
        refundRecipient: "0x000000000000000000000000000000000000dEaD",
        merkleRoot: ROOT,
        manifestUrl: `/api/drops/${DROP}/manifest`,
        fundingDeadline: "1800000000",
        lastError: null,
        createdAt: new Date(NOW - 180_000).toISOString(),
      } as unknown as NonNullable<DropDetail["ours"]["data"]>,
    },
  };
}

function render(d: DropDetail, list: Receiver[], sender = false): string {
  return renderToStaticMarkup(
    <MultisendView initial={d} receivers={list} isSender={sender} now={NOW} />,
  );
}

describe("MultisendView, what everyone sees", () => {
  it("funding: the title, the funding card and its line", () => {
    const html = render(detail("created", 12, 0), receivers(12));
    expect(html).toContain(">multisend<");
    expect(html).toContain("fund the address below and this page moves on by itself.");
    expect(html).toContain(DROP);
    expect(html).toContain("FUNDING");
    expect(html).toContain("0 of 12 paid");
    // copy calls it multisend everywhere, never "drop".
    expect(html).toContain("multisend address");
    expect(html).not.toContain("drop address");
    expect(html).not.toContain("the drop starts");
  });

  it("live: the progress and every receiver with its state", () => {
    const html = render(detail("paying", 12, 7, [9]), receivers(12));
    expect(html).toContain("0.012 ETH to 12 wallets · Robinhood test · 3m ago");
    expect(html).toContain("7 of 12 paid");
    expect(html).toContain("LIVE");
    expect(html).toContain(">paid<");
    expect(html).toContain(">waiting<");
    expect(html).toContain(">failed<");
    // The funding card is gone once the money is in.
    expect(html).not.toContain("fund the address below");
  });

  it("done: the DONE chip and every row paid", () => {
    const html = render(detail("finished", 3, 3), receivers(3));
    expect(html).toContain("DONE");
    expect(html).toContain("3 of 3 paid");
    expect(html).not.toContain(">waiting<");
  });

  it("the proof at the bottom: contract, root, manifest, create transaction", () => {
    const html = render(detail("finished", 3, 3), receivers(3));
    expect(html).toContain(ROOT);
    expect(html).toContain(`href="/api/drops/${DROP}/manifest"`);
    expect(html).toContain(CREATE_TX);
  });

  it("shows 100 rows, then `show 50 more`", () => {
    const html = render(detail("paying", 150, 0), receivers(150));
    expect(html).toContain("show 50 more");
    // Full addresses sit in the copy buttons; the 100th row is in, the 101st is not.
    expect(html).toContain(wallet(99));
    expect(html).not.toContain(wallet(100));
  });

  it("never the drop things: no rain, no share, no picture, no replay, no profile link", () => {
    for (const d of [detail("created", 3, 0), detail("paying", 3, 1), detail("finished", 3, 3)]) {
      const html = render(d, receivers(3), true);
      expect(html).not.toContain("<canvas");
      expect(html).not.toContain("post on X");
      expect(html).not.toContain("replay");
      expect(html).not.toContain("sample.png");
      expect(html).not.toContain('href="/u/');
      expect(html).not.toMatch(/\bdrop it\b|\bthe rain\b/);
    }
  });
});

describe("MultisendView", () => {
  const claimTx = (index: number) => `0x${(0xc00 + index).toString(16).padStart(64, "0")}`;

  it("a paid row links its transaction under the amount, for the phone", () => {
    const html = render(detail("paying", 12, 7), receivers(12));
    const links = html.match(/>paid ↗</g) ?? [];
    expect(links).toHaveLength(7);
    for (let index = 0; index < 7; index++) {
      expect(html).toContain(`href="${String(txUrl(46630, claimTx(index)))}"`);
    }
  });

  it("a waiting row, and a paid row without a hash (Solana), stay plain words", () => {
    const d = detail("paying", 3, 1);
    const chainSide = d.chain.data;
    if (chainSide === null || chainSide === undefined) throw new Error("no chain side");
    const noHash = {
      ...d,
      chain: {
        ...d.chain,
        data: {
          ...chainSide,
          claims: chainSide.claims.map((claim) => ({ ...claim, transactionHash: null })),
        },
      },
    } as DropDetail;
    const html = render(noHash, receivers(3));
    expect(html).not.toContain("paid ↗");
    expect(html).toContain(">paid<");
    expect(html).toContain(">waiting<");
  });

  it("the proof: each value short for the phone, full for the desktop, with copy", () => {
    const html = render(detail("finished", 3, 3), receivers(3));
    expect(html).toContain(`>${shortAddress(DROP)}<`);
    expect(html).toContain(`>${shortHash(ROOT)}<`);
    expect(html).toContain(`>${shortHash(CREATE_TX)}<`);
    for (const value of [DROP, ROOT, CREATE_TX]) {
      expect(html).toContain(`aria-label="copy ${value}"`);
      expect(html).toContain(`>${value}<`);
    }
  });
});

describe("MultisendView, sender and stranger", () => {
  it("the sender sees `you sent this` and `copy the link`", () => {
    const html = render(detail("paying", 3, 1), receivers(3), true);
    expect(html).toContain("you sent this");
    expect(html).toContain("copy the link");
  });

  it("a stranger sees neither, and never the sender's handle", () => {
    const html = render(detail("paying", 3, 1), receivers(3), false);
    expect(html).not.toContain("you sent this");
    expect(html).not.toContain("copy the link");
    expect(html).not.toContain("samplechad");
    expect(html).not.toContain("Sample");
  });

  it("a stranger still gets the funding card: the sender may pay from a phone not signed in", () => {
    const html = render(detail("created", 3, 0), receivers(3), false);
    expect(html).toContain("fund the address below and this page moves on by itself.");
  });
});
