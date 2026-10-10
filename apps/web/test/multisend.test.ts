/**
 * The logic of the multisend page `/m/<address>`.
 * `components/drops/multisend.ts`, no React here.
 */
import { describe, expect, it } from "vitest";

import {
  MULTISEND_PAGE,
  applyClaimPaid,
  isSender,
  moreLabel,
  multisendMetadata,
  progressLine,
  receiverRows,
  receiversFromManifest,
  summaryLine,
} from "@/components/drops/multisend";
import type { DropDetail } from "@/lib/api";

const ROBINHOOD_TESTNET = 46630;
const SOLANA_DEVNET = 103;

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000a2";
const C = "0x00000000000000000000000000000000000000a3";

/** A version 1 address manifest, `packages/shared` `toManifest`, with its proofs. */
const MANIFEST_V1 = JSON.stringify({
  version: 1,
  drop: "0x1111111111111111111111111111111111111111",
  chainId: ROBINHOOD_TESTNET,
  root: `0x${"33".repeat(32)}`,
  totalEntitlements: "60",
  leafCount: 3,
  // Out of order on purpose: the page lists by index.
  entries: [
    { index: 2, recipient: C, amount: "30", proof: [`0x${"01".repeat(32)}`] },
    { index: 0, recipient: A, amount: "10", proof: [`0x${"02".repeat(32)}`] },
    { index: 1, recipient: B, amount: "20", proof: [`0x${"03".repeat(32)}`] },
  ],
});

describe("receiversFromManifest", () => {
  it("reads every receiver of an address manifest by index, without the proofs", () => {
    expect(receiversFromManifest(MANIFEST_V1)).toEqual([
      { index: 0, recipient: A, amount: "10" },
      { index: 1, recipient: B, amount: "20" },
      { index: 2, recipient: C, amount: "30" },
    ]);
  });

  it("refuses a handle manifest, version 2: a multisend page never shows X ids", () => {
    const handle = JSON.stringify({
      version: 2,
      mode: "handle",
      drop: "0x1111111111111111111111111111111111111111",
      chainId: ROBINHOOD_TESTNET,
      root: `0x${"33".repeat(32)}`,
      totalEntitlements: "10",
      leafCount: 1,
      entries: [{ index: 0, xId: "9001", amount: "10", proof: [] }],
    });
    expect(receiversFromManifest(handle)).toBeNull();
  });

  it("refuses junk instead of throwing", () => {
    expect(receiversFromManifest("not json")).toBeNull();
    expect(receiversFromManifest(JSON.stringify({ version: 1 }))).toBeNull();
  });
});

describe("receiverRows", () => {
  const receivers = receiversFromManifest(MANIFEST_V1) ?? [];

  it("paid with its transaction, failed, or waiting", () => {
    const rows = receiverRows(receivers, [{ index: 0, transactionHash: "0xabc" }], [2]);
    expect(rows).toEqual([
      { index: 0, recipient: A, amount: "10", state: "paid", txHash: "0xabc" },
      { index: 1, recipient: B, amount: "20", state: "waiting", txHash: null },
      { index: 2, recipient: C, amount: "30", state: "failed", txHash: null },
    ]);
  });

  it("paid wins over an old failure: the retry landed", () => {
    const rows = receiverRows(receivers, [{ index: 2, transactionHash: "0xdef" }], [2]);
    expect(rows[2]).toMatchObject({ state: "paid", txHash: "0xdef" });
  });

  it("a Solana claim is paid without a transaction: the bitmap does not say which one", () => {
    const rows = receiverRows(receivers, [{ index: 1, transactionHash: null }], []);
    expect(rows[1]).toMatchObject({ state: "paid", txHash: null });
  });

  it("the live stream marks one row paid and leaves the rest alone", () => {
    const rows = receiverRows(receivers, [], [1]);
    const next = applyClaimPaid(rows, { index: 1, txHash: "0x999" });
    expect(next[1]).toMatchObject({ state: "paid", txHash: "0x999" });
    expect(next[0]).toBe(rows[0]);
    expect(rows[1]?.state).toBe("failed");
  });
});

describe("paging, 100 rows at a time", () => {
  it("pages by 100", () => {
    expect(MULTISEND_PAGE).toBe(100);
  });

  it("says how many more a tap shows, never more than a page", () => {
    expect(moreLabel(250, 100)).toBe("show 100 more");
    expect(moreLabel(150, 100)).toBe("show 50 more");
    expect(moreLabel(100, 100)).toBeNull();
    expect(moreLabel(12, 100)).toBeNull();
  });
});

describe("the lines", () => {
  it("progress, `7 of 12 paid`", () => {
    expect(progressLine(7, 12)).toBe("7 of 12 paid");
    expect(progressLine(0, 1)).toBe("0 of 1 paid");
  });

  it("the grey line under the title: amount, wallets, chain, age", () => {
    const now = Date.UTC(2026, 8, 29, 12, 0, 0);
    const threeMinutesAgo = Math.floor(now / 1000) - 180;
    expect(
      summaryLine(
        {
          amountWei: "50000000000000000",
          chainId: ROBINHOOD_TESTNET,
          receivers: 12,
          createdAt: threeMinutesAgo,
        },
        now,
      ),
    ).toBe("0.05 ETH to 12 wallets · Robinhood test · 3m ago");
    expect(
      summaryLine(
        { amountWei: "3000000", chainId: SOLANA_DEVNET, receivers: 1, createdAt: threeMinutesAgo },
        now,
      ),
    ).toBe("0.003 SOL to 1 wallet · Solana test · 3m ago");
  });
});

describe("isSender, who sees `you sent this`", () => {
  // The api decides from the session cookie, `yours`. The page never compares
  // profiles: a multisend's `creator` is always null.
  const detail = (yours: boolean | undefined, known = true) =>
    ({
      ours: { known, data: known ? { mode: "address", creator: null, yours } : null },
    }) as unknown as DropDetail;

  it("yours true is the sender", () => {
    expect(isSender(detail(true))).toBe(true);
  });

  it("yours false, a missing flag from an older api, or no row of ours is not", () => {
    expect(isSender(detail(false))).toBe(false);
    expect(isSender(detail(undefined))).toBe(false);
    expect(isSender(detail(undefined, false))).toBe(false);
  });
});

describe("multisendMetadata", () => {
  it("is noindex, so a list of wallets does not land in a search engine", () => {
    const meta = multisendMetadata("0x1111111111111111111111111111111111111111");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe("multisend 0x1111…1111");
  });
});
