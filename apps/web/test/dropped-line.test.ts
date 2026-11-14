/**
 * The coin line under `total dropped`: the api's list, shown as
 * `0.001 ETH  0.006 SOL  5 tokens`, two spaces between items, the token count last.
 */
import { describe, expect, it } from "vitest";

import { droppedLine } from "@/lib/format";

describe("droppedLine", () => {
  it("formats each coin in its unit and joins with two spaces", () => {
    expect(
      droppedLine([
        { kind: "coin", symbol: "ETH", decimals: 18, amount: "1000000000000000" },
        { kind: "coin", symbol: "SOL", decimals: 9, amount: "6000000" },
      ]),
    ).toBe("0.001 ETH  0.006 SOL");
  });

  it("puts the token count last, singular when it is one", () => {
    expect(
      droppedLine([
        { kind: "coin", symbol: "ETH", decimals: 18, amount: "5000000000000000000" },
        { kind: "tokens", count: 5 },
      ]),
    ).toBe("5 ETH  5 tokens");
    expect(droppedLine([{ kind: "tokens", count: 1 }])).toBe("1 token");
  });

  it("is empty when nothing moved, so the tile shows no line", () => {
    expect(droppedLine([])).toBe("");
  });
});
