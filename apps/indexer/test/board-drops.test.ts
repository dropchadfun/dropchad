/**
 * `GET /board-drops`. Each row gains `claimedIndexes`: the merkle indexes
 * of the drop's **final** claims, both kinds, ascending. The api reads the X id behind
 * each one; an EVM handle drop counts zero until this field arrives.: nothing `seen`.
 */
import { describe, expect, it } from "vitest";

import { boardDropsFrom } from "../src/board-drops.js";

const DROP_A = "0x00000000000000000000000000000000000000a1";
const DROP_B = "0x00000000000000000000000000000000000000b1";
const R1 = "0x00000000000000000000000000000000000000c1";
const R2 = "0x00000000000000000000000000000000000000c2";

const DROPS = [
  { address: DROP_A, creatorCommitment: `0x${"11".repeat(32)}`, timestamp: 1_800_000_100n },
  { address: DROP_B, creatorCommitment: `0x${"22".repeat(32)}`, timestamp: 1_800_000_000n },
];

describe("boardDropsFrom", () => {
  it("gives claimedIndexes of final claims only, both kinds, ascending", () => {
    const rows = boardDropsFrom(DROPS, [
      { drop: DROP_A, index: 4, recipient: R2, amount: 20n, finality: "final" },
      { drop: DROP_A, index: 1, recipient: R1, amount: 10n, finality: "final" },
      // A handle payout to the same wallet: one more claim, the same recipient.
      { drop: DROP_A, index: 2, recipient: R1, amount: 30n, finality: "final" },
      // Seen only: not on a board yet.
      { drop: DROP_A, index: 7, recipient: R2, amount: 999n, finality: "seen" },
    ]);
    expect(rows[0]).toEqual({
      address: DROP_A,
      creatorCommitment: `0x${"11".repeat(32)}`,
      createdAt: "1800000100",
      claimedFinalWei: "60",
      claimedCountFinal: 3,
      recipients: [R2, R1],
      claimedIndexes: [1, 2, 4],
    });
  });

  it("gives an empty list for a drop with no final claim", () => {
    const rows = boardDropsFrom(DROPS, []);
    expect(rows[1]).toEqual({
      address: DROP_B,
      creatorCommitment: `0x${"22".repeat(32)}`,
      createdAt: "1800000000",
      claimedFinalWei: "0",
      claimedCountFinal: 0,
      recipients: [],
      claimedIndexes: [],
    });
  });
});
