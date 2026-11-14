/**
 * The `below_min_usd` words on `/create`: on step 1
 * and at create, `send at least X per person.` X is the answer's `minimum` rounded
 * **up** to 2 significant digits, so the amount shown always passes. Without a `minimum`:
 * `send more per person.` The api body does not change.
 */
import { describe, expect, it } from "vitest";

import { explain } from "@/components/create/errors";
import { ApiError } from "@/lib/api";
import { roundUpSignificant } from "@/lib/format";

const err = (body: Record<string, unknown>) => new ApiError(400, body.error as string, body);
const ETH = { decimals: 18 };
const SOL = { decimals: 9 };

describe("roundUpSignificant, 2 digits, always up", () => {
  it("the examples of the", () => {
    // 0.000404068 ETH -> 0.00041 ETH
    expect(roundUpSignificant(404_068_000_000_000n)).toBe(410_000_000_000_000n);
    // 0.006666667 SOL -> 0.0067 SOL
    expect(roundUpSignificant(6_666_667n)).toBe(6_700_000n);
    // 0.0004 ETH stays
    expect(roundUpSignificant(400_000_000_000_000n)).toBe(400_000_000_000_000n);
    // 1.234 SOL -> 1.3 SOL
    expect(roundUpSignificant(1_234_000_000n)).toBe(1_300_000_000n);
  });

  it("carries into a new digit: 99.5 -> 100", () => {
    expect(roundUpSignificant(995n)).toBe(1_000n);
  });

  it("one or two digits stay as they are; zero stays zero", () => {
    expect(roundUpSignificant(0n)).toBe(0n);
    expect(roundUpSignificant(7n)).toBe(7n);
    expect(roundUpSignificant(42n)).toBe(42n);
  });

  it("is never under the minimum and keeps at most 2 significant digits", () => {
    for (const value of [
      101n,
      109n,
      110n,
      111n,
      12_345n,
      99_999n,
      100_001n,
      404_068_123_456_789n,
    ]) {
      const shown = roundUpSignificant(value);
      expect(shown >= value, String(value)).toBe(true);
      expect(shown.toString().replace(/0+$/, "").length, String(value)).toBeLessThanOrEqual(2);
    }
  });
});

describe("the below_min_usd words, step 1 and create", () => {
  it("ETH: send at least 0.00041 ETH per person.", () => {
    expect(
      explain(err({ error: "below_min_usd", minimum: "404068000000000", symbol: "ETH" }), ETH),
    ).toBe("send at least 0.00041 ETH per person.");
  });

  it("SOL: send at least 0.0067 SOL per person.", () => {
    expect(explain(err({ error: "below_min_usd", minimum: "6666667", symbol: "SOL" }), SOL)).toBe(
      "send at least 0.0067 SOL per person.",
    );
  });

  it("an exact minimum stays, no trailing zeros", () => {
    expect(
      explain(err({ error: "below_min_usd", minimum: "400000000000000", symbol: "ETH" }), ETH),
    ).toBe("send at least 0.0004 ETH per person.");
  });

  it("a whole coin: 1.234 SOL shows as 1.3 SOL", () => {
    expect(
      explain(err({ error: "below_min_usd", minimum: "1234000000", symbol: "SOL" }), SOL),
    ).toBe("send at least 1.3 SOL per person.");
  });

  it("no minimum in the answer: send more per person.", () => {
    expect(explain(err({ error: "below_min_usd" }), ETH)).toBe("send more per person.");
  });
});
