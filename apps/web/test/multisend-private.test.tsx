/**
 * The multisend list, option B
 * "The multisend page": the sender sees every receiver and the manifest link; everyone else
 * sees the totals and only the paid rows, with `only paid wallets show here. the rest stay
 * private to the sender.`, or `nobody is paid yet.` The page reads `receivers` from the drop
 * detail, never the manifest. A row paid while the page is open is added live.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MultisendView } from "@/components/drops/MultisendView";
import { applyClaimPaid, receiverRows, receiversOf } from "@/components/drops/multisend";
import type { DropDetail } from "@/lib/api";

const DROP = "0x1111111111111111111111111111111111111111";
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const wallet = (i: number) => `0x${(0xa00 + i).toString(16).padStart(40, "0")}`;
const row = (index: number) => ({ index, recipient: wallet(index), amount: "1000000000000000" });
const tx = (index: number) => `0x${(0xc00 + index).toString(16).padStart(64, "0")}`;

const GREY = "only paid wallets show here. the rest stay private to the sender.";

/** A live multisend of 3 with index 1 paid on chain. `yours` decides what the api sent. */
function detail(yours: boolean, paid: number[] = [1]): DropDetail {
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
          status: "Active",
          leafCount: 3,
          claimedCount: paid.length,
          totalEntitlements: "3000000000000000",
          createdAt: String(Math.floor(NOW / 1000) - 180),
        },
        claims: paid.map((index) => ({
          index,
          recipient: wallet(index),
          transactionHash: tx(index),
        })),
        events: [],
      },
    },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        yours,
        creator: null,
        chainId: 46630,
        state: "paying",
        mode: "address",
        leafCount: 3,
        paidCount: paid.length,
        failedIndexes: [],
        totalEntitlementsWei: "3000000000000000",
        merkleRoot: `0x${"33".repeat(32)}`,
        manifestUrl: yours ? `/api/drops/${DROP}/manifest` : null,
        receivers: yours ? [row(0), row(1), row(2)] : paid.map(row),
        createTxHash: `0x${"55".repeat(32)}`,
        createdAt: new Date(NOW - 180_000).toISOString(),
      },
    },
  } as unknown as DropDetail;
}

const render = (d: DropDetail, sender: boolean) =>
  renderToStaticMarkup(
    <MultisendView initial={d} receivers={receiversOf(d)} isSender={sender} now={NOW} />,
  );

describe("receiversOf, the rows the api sent", () => {
  it("reads them by index", () => {
    const d = detail(true);
    expect(receiversOf(d)).toEqual([row(0), row(1), row(2)]);
  });

  it("is null when the api sent none: an older api, or no row of ours", () => {
    const d = detail(false);
    const none = { ...d, ours: { ...d.ours, data: { ...d.ours.data, receivers: undefined } } };
    expect(receiversOf(none as unknown as DropDetail)).toBeNull();
    expect(receiversOf({ ...d, ours: { ...d.ours, data: null } })).toBeNull();
  });
});

describe("a row paid while the page is open", () => {
  it("is added in index order when the list did not have it, a stranger's view", () => {
    const rows = receiverRows([row(1)], [{ index: 1, transactionHash: tx(1) }], []);
    const next = applyClaimPaid(rows, {
      index: 0,
      txHash: tx(0),
      recipient: wallet(0),
      amount: "1000000000000000",
    });
    expect(next.map((r) => [r.index, r.state, r.txHash])).toEqual([
      [0, "paid", tx(0)],
      [1, "paid", tx(1)],
    ]);
    expect(next[0]?.recipient).toBe(wallet(0));
  });
});

describe("MultisendView, a stranger", () => {
  it("sees the totals, only the paid row, the grey line, and no manifest link", () => {
    const html = render(detail(false), false);
    expect(html).toContain("1 of 3 paid");
    expect(html).toContain(GREY);
    expect(html).toContain(wallet(1));
    expect(html).not.toContain(wallet(0));
    expect(html).not.toContain(wallet(2));
    expect(html).not.toContain("/manifest");
    expect(html).not.toContain("every receiver and proof");
  });

  it("nobody paid yet: says so, not that the list could not be read", () => {
    const html = render(detail(false, []), false);
    expect(html).toContain("nobody is paid yet.");
    expect(html).not.toContain("could not be read");
  });
});

describe("MultisendView, the sender", () => {
  it("sees every row, the manifest link, and no grey line", () => {
    const html = render(detail(true), true);
    for (const i of [0, 1, 2]) expect(html).toContain(wallet(i));
    expect(html).toContain(`href="/api/drops/${DROP}/manifest"`);
    expect(html).toContain(">waiting<");
    expect(html).not.toContain(GREY);
  });
});

describe("the page reads the detail, never the manifest", () => {
  const src = (...parts: string[]) => readFileSync(join(__dirname, "..", "src", ...parts), "utf8");

  it("/m/ takes receivers from the drop detail", () => {
    const page = src("app", "m", "[address]", "page.tsx");
    expect(page).not.toContain("getManifest");
    expect(page).toContain("receiversOf(");
  });

  it("the live stream passes the paid wallet and amount, so a stranger's row can be added", () => {
    const view = src("components", "drops", "MultisendView.tsx");
    expect(view).toContain("recipient: event.recipient");
    expect(view).toContain("amount: event.amountWei");
  });
});
