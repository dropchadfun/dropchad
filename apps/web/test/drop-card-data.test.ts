/**
 * The one chip on a drop, `drop-card-data.ts`. On chain a drop stays `Active` after its last
 * claim is paid: nothing flips it. So `Active` with every leaf claimed is DONE, with
 * or without our row -09-15.
 */
import { describe, expect, it } from "vitest";

import { chipForChain, fromListEntry } from "@/components/drops/drop-card-data";
import type { DropListEntry, OwnDropCard } from "@/lib/api";

const ours = (patch: Partial<OwnDropCard>): OwnDropCard => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  asset: "0x0000000000000000000000000000000000000000",
  title: null,
  memeImageUrl: null,
  state: "paying",
  mode: "handle",
  totalEntitlementsWei: "300000000000000",
  leafCount: 3,
  paidCount: 1,
  failedIndexes: [],
  createTxHash: `0x${"11".repeat(32)}`,
  activateTxHash: null,
  lastTxHash: null,
  fundingDeadline: "1800000000",
  createdAt: "2026-09-15T06:09:09.535Z",
  creator: null,
  ...patch,
});

const entry = (patch: Partial<DropListEntry>): DropListEntry => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  status: "Active",
  asset: "0x0000000000000000000000000000000000000000",
  creatorCommitment: `0x${"22".repeat(32)}`,
  totalEntitlements: "300000000000000",
  leafCount: 3,
  totalClaimed: "300000000000000",
  claimedCount: 3,
  claimDeadline: "1800000000",
  fundingDeadline: "1800000000",
  verified: true,
  createdAt: "1789452554",
  transactionHash: `0x${"33".repeat(32)}`,
  finality: "final",
  statusFinality: "final",
  dropchad: null,
  ...patch,
});

describe("chipForChain", () => {
  it("Active with every leaf claimed is DONE: the chain never flips the status itself", () => {
    expect(chipForChain({ status: "Active", claimedCount: 3, leafCount: 3 })).toBe("DONE");
  });

  it("Active with a leaf still unpaid is LIVE", () => {
    expect(chipForChain({ status: "Active", claimedCount: 2, leafCount: 3 })).toBe("LIVE");
  });

  it("the other statuses read as they always did", () => {
    expect(chipForChain({ status: "Created", claimedCount: 0, leafCount: 3 })).toBe("FUNDING");
    expect(chipForChain({ status: "Finalized", claimedCount: 3, leafCount: 3 })).toBe("DONE");
    expect(chipForChain({ status: "Cancelled", claimedCount: 0, leafCount: 3 })).toBe("EXPIRED");
  });
});

describe("fromListEntry chip", () => {
  it("a fully paid drop with no row of ours is DONE, not LIVE", () => {
    expect(fromListEntry(entry({ dropchad: null })).chip).toBe("DONE");
  });

  it("a fully paid drop is DONE even while our row still says paying", () => {
    expect(fromListEntry(entry({ dropchad: ours({ state: "paying", paidCount: 2 }) })).chip).toBe(
      "DONE",
    );
  });

  it("a drop still being paid is LIVE, with or without our row", () => {
    expect(fromListEntry(entry({ claimedCount: 1, dropchad: null })).chip).toBe("LIVE");
    expect(
      fromListEntry(entry({ claimedCount: 1, dropchad: ours({ state: "paying" }) })).chip,
    ).toBe("LIVE");
  });

  it("our row still refines an Active drop that is not fully paid", () => {
    expect(
      fromListEntry(entry({ claimedCount: 0, dropchad: ours({ state: "failed", paidCount: 0 }) }))
        .chip,
    ).toBe("DONE");
  });

  it("claimed is the larger of the chain count and ours", () => {
    expect(
      fromListEntry(entry({ claimedCount: 1, dropchad: ours({ paidCount: 2 }) })).claimed,
    ).toBe(2);
  });
});
