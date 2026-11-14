/**
 * The default funding period is 1 hour and the default
 * claim period 3 days. Both are set only here, by the api, on every new drop, and both sit inside
 * the factory and program bounds: funding 1 hour to 30 days, claim 1 day to 180 days
 * (`DropFactoryV7.sol`, `constants.rs`). A drop made before keeps what it was created with.
 */
import { describe, expect, it } from "vitest";

import { CLAIM_PERIOD_SECONDS, FUNDING_PERIOD_SECONDS } from "../src/config.js";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

describe("the two drop periods", () => {
  it("1 hour to fund", () => {
    expect(FUNDING_PERIOD_SECONDS).toBe(HOUR);
  });

  it("3 days to claim", () => {
    expect(CLAIM_PERIOD_SECONDS).toBe(3 * DAY);
  });

  it("both inside the bounds on both chains", () => {
    expect(FUNDING_PERIOD_SECONDS).toBeGreaterThanOrEqual(HOUR);
    expect(FUNDING_PERIOD_SECONDS).toBeLessThanOrEqual(30 * DAY);
    expect(CLAIM_PERIOD_SECONDS).toBeGreaterThanOrEqual(DAY);
    expect(CLAIM_PERIOD_SECONDS).toBeLessThanOrEqual(180 * DAY);
  });
});
