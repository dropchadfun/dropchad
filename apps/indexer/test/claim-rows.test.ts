/**
 * One `claims` row per payout, of either kind
 * `claimHandle` emits `HandleClaimed` and not `Claimed`, so nothing is counted twice. A handle
 * row keeps the X id; an address row has none.
 */
import { describe, expect, it } from "vitest";

import { claimRowFromClaimed, claimRowFromHandleClaimed } from "../src/claim-rows.js";

const RECIPIENT = "0x00000000000000000000000000000000000000c1";

describe("claim rows", () => {
  it("HandleClaimed is a handle row with its X id", () => {
    expect(
      claimRowFromHandleClaimed({
        index: 3n,
        xId: 44196397n,
        recipient: RECIPIENT,
        amount: 1_000n,
      }),
    ).toEqual({ index: 3, recipient: RECIPIENT, amount: 1_000n, kind: "handle", xId: 44196397n });
  });

  it("Claimed is an address row with no X id", () => {
    expect(claimRowFromClaimed({ index: 0n, recipient: RECIPIENT, amount: 5n })).toEqual({
      index: 0,
      recipient: RECIPIENT,
      amount: 5n,
      kind: "address",
      xId: null,
    });
  });
});
