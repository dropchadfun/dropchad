/**
 * The logic of the multisend page `/m/<address>`.
 * `components/drops/multisend.ts`, no React here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MULTISEND_PAGE,
  applyClaimPaid,
  isSender,
  moreLabel,
  multisendMetadata,
  progressLine,
  receiverRows,
  summaryLine,
} from "@/components/drops/multisend";
import type { DropDetail } from "@/lib/api";

const ROBINHOOD_TESTNET = 46630;
const SOLANA_DEVNET = 103;

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000a2";
const C = "0x00000000000000000000000000000000000000a3";

describe("receiverRows", () => {
  const receivers = [
    { index: 0, recipient: A, amount: "10" },
    { index: 1, recipient: B, amount: "20" },
    { index: 2, recipient: C, amount: "30" },
  ];

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
    // The event's wallet and amount only matter for a row the list did not have.
    const next = applyClaimPaid(rows, { index: 1, txHash: "0x999", recipient: "x", amount: "0" });
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
    const meta = multisendMetadata("0x1111111111111111111111111111111111111111", false);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe("multisend 0x1111…1111");
  });

  // no address in the tab while it waits for money.
  it("waiting for money: the tab is `multisend`, without the address, still noindex", () => {
    const meta = multisendMetadata("0x1111111111111111111111111111111111111111", true);
    expect(meta.title).toBe("multisend");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("the route reads the drop for the title, and a failed read keeps the address out", () => {
    const route = readFileSync(
      join(import.meta.dirname, "..", "src", "app", "m", "[address]", "page.tsx"),
      "utf8",
    );
    expect(route).toMatch(/multisendMetadata\(address, [^)]*"created"/);
    expect(route).toMatch(/catch[\s\S]*multisendMetadata\(address, true\)/);
  });
});
