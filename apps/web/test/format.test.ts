/**
 * `formatDay`: an ISO time as a short day, `13 dec 2026`, lowercase like the rest of the copy.
 * Used for the tag lock date on the profile page.
 */
import { describe, expect, it } from "vitest";

import { exactAmount, formatDay, formatUsd } from "@/lib/format";

describe("formatDay", () => {
  it("writes day, short month and year, lowercase, no leading zero", () => {
    expect(formatDay("2026-12-08T00:00:00.000Z")).toBe("8 dec 2026");
    expect(formatDay("2026-09-14T08:11:16.902Z")).toBe("14 sep 2026");
  });

  it("uses the UTC day, so a server time near midnight does not shift", () => {
    expect(formatDay("2026-12-31T23:59:59.000Z")).toBe("31 dec 2026");
    expect(formatDay("2027-01-01T00:00:01.000Z")).toBe("1 jan 2027");
  });

  it("says not sure for a time it cannot read", () => {
    expect(formatDay("soon")).toBe("not sure");
  });
});

describe("formatUsd", () => {
  it("writes dollars with two decimals and thousands separators", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.9)).toBe("$0.90");
    expect(formatUsd(4)).toBe("$4.00");
    expect(formatUsd(1234.567)).toBe("$1,234.57");
    expect(formatUsd(1_000_000)).toBe("$1,000,000.00");
  });
});

describe("exactAmount, the funding card's copy amount", () => {
  it("whole coins, the same number the card shows big", () => {
    expect(exactAmount("120000000000000", 18)).toBe("0.00012");
    expect(exactAmount("2500000", 9)).toBe("0.0025");
    expect(exactAmount("1000000000000000000", 18)).toBe("1");
    expect(exactAmount("0", 18)).toBe("0");
  });

  it("no thousands comma, so a wallet takes the paste", () => {
    expect(exactAmount("1234500000000000000000", 18)).toBe("1234.5");
  });

  it("every decimal, never cut: less than the amount would not start the drop", () => {
    expect(exactAmount("1", 18)).toBe("0.000000000000000001");
    expect(exactAmount("123456789", 9)).toBe("0.123456789");
  });
});
