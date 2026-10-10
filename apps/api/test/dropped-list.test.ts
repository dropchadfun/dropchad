/**
 * The coin line under the `total dropped` tile: one
 * item per coin that has moved, never a zero, in chain order, and a token count last when it is
 * above zero. The api fills the list, the page shows it.
 */
import { describe, expect, it } from "vitest";

import { droppedList } from "../src/drops/read.js";

const eth = { symbol: "ETH", decimals: 18 };
const sol = { symbol: "SOL", decimals: 9 };

describe("droppedList", () => {
  it("lists the coins that moved, in the order given, amounts in base units as text", () => {
    expect(
      droppedList(
        [
          { ...eth, amount: 1_000_000_000_000_000n },
          { ...sol, amount: "6000000" },
        ],
        0,
      ),
    ).toEqual([
      { kind: "coin", symbol: "ETH", decimals: 18, amount: "1000000000000000" },
      { kind: "coin", symbol: "SOL", decimals: 9, amount: "6000000" },
    ]);
  });

  it("never carries a zero coin", () => {
    expect(
      droppedList(
        [
          { ...eth, amount: 0n },
          { ...sol, amount: "6000000" },
        ],
        0,
      ),
    ).toEqual([{ kind: "coin", symbol: "SOL", decimals: 9, amount: "6000000" }]);
    expect(droppedList([{ ...eth, amount: "0" }], 0)).toEqual([]);
  });

  it("ends with the token count, only when it is above zero", () => {
    expect(droppedList([{ ...eth, amount: 5n }], 5)).toEqual([
      { kind: "coin", symbol: "ETH", decimals: 18, amount: "5" },
      { kind: "tokens", count: 5 },
    ]);
    expect(droppedList([], 1)).toEqual([{ kind: "tokens", count: 1 }]);
    expect(droppedList([{ ...eth, amount: 5n }], 0)).toHaveLength(1);
  });
});
