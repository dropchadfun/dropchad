/**
 * Plain, honest errors on `/create`: one sentence for every
 * code the create and the lookup can answer with in drop mode.
 */
import { describe, expect, it } from "vitest";

import { explain } from "@/components/create/errors";
import { ApiError } from "@/lib/api";

const err = (status: number, body: Record<string, unknown>) =>
  new ApiError(status, body.error as string, body);

describe("explain", () => {
  it("lists every handle X does not know", () => {
    expect(explain(err(400, { error: "handles_not_found", handles: ["ghost", "typo"] }))).toBe(
      "not found on X: @ghost, @typo. fix or remove them.",
    );
  });

  it("says a bad handle by name", () => {
    expect(explain(err(400, { error: "bad_handle", handles: ["e.ve"] }))).toBe(
      "not an X handle: @e.ve.",
    );
  });

  it("refuses the sender's own handle", () => {
    expect(explain(err(400, { error: "own_handle" }))).toBe(
      "that is you. a drop cannot pay yourself.",
    );
  });

  it("says handle drops are paused", () => {
    expect(explain(err(503, { error: "handle_mode_not_ready" }))).toBe(
      "x handle drops are paused.",
    );
  });

  it("the lookup: X down, the daily cap, too many", () => {
    expect(explain(err(502, { error: "x_unavailable" }))).toBe(
      "X is not answering. try again in a minute.",
    );
    expect(explain(err(429, { error: "daily_cap" }))).toBe("handle lookups are used up for today.");
    expect(explain(err(400, { error: "too_many", max: 500 }))).toBe("500 people per drop at most.");
  });

  it("the money rules, with the numbers the api sends", () => {
    expect(
      explain(err(400, { error: "below_min_usd", minimum: "100000", symbol: "SOL" }), {
        decimals: 9,
      }),
    ).toBe("each person must get at least 0.0001 SOL.");
    expect(explain(err(400, { error: "fee_below_gas" }))).toBe(
      "the fee does not cover the gas right now. send a bit more per person, or try later.",
    );
    expect(explain(err(503, { error: "price_unavailable" }))).toBe(
      "no coin price right now, so the minimum cannot be checked. try again in a minute.",
    );
  });

  it("keeps the old sentences", () => {
    expect(explain(err(429, { error: "rate_limited" }))).toBe(
      "five drops an hour is the limit. give it a bit.",
    );
    expect(explain(new Error("network"))).toBe("the api did not answer. is it running on 4000?");
  });
});
