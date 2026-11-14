/**
 * The cap per drop on `/create`: plain, short,
 * lowercase like the rest of create. The number and the coin come from the api's answer, so a new
 * cap needs no new words.
 */
import { describe, expect, it } from "vitest";

import { explain } from "@/components/create/errors";
import { ApiError } from "@/lib/api";

const tooBig = (max: string, symbol: string, decimals: number) =>
  new ApiError(400, "drop_too_big", { error: "drop_too_big", max, symbol, decimals });

describe("drop_too_big", () => {
  it("2 SOL", () => {
    expect(explain(tooBig("2000000000", "SOL", 9), { decimals: 9 })).toBe(
      "over the beta limit: at most 2 SOL per drop.",
    );
  });

  it("0.1 ETH", () => {
    expect(explain(tooBig("100000000000000000", "ETH", 18))).toBe(
      "over the beta limit: at most 0.1 ETH per drop.",
    );
  });

  it("200 USDC, a token drop", () => {
    expect(explain(tooBig("200000000", "USDC", 6), { decimals: 6, token: true })).toBe(
      "over the beta limit: at most 200 USDC per drop.",
    );
  });

  it("the decimals come from the answer, not from the page", () => {
    expect(explain(tooBig("2500000000", "SOL", 9), { decimals: 18 })).toBe(
      "over the beta limit: at most 2.5 SOL per drop.",
    );
  });

  it("an answer without the numbers still says it plainly", () => {
    const bare = new ApiError(400, "drop_too_big", { error: "drop_too_big" });
    expect(explain(bare)).toBe("over the beta limit. use a smaller amount.");
  });
});
