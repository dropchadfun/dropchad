/**
 * Two create page words. The repeat note says the
 * amounts are added together, as the api merges them. The step names
 * match the screens: the chain, the coin and the list with the amounts are all on step 1.
 */
import { describe, expect, it } from "vitest";

import { STEP_LABELS, repeatNote } from "@/components/create/form";

describe("the repeat note", () => {
  it("handles: the amounts are added together, one person each", () => {
    expect(repeatNote(2, "handle")).toBe(
      "2 repeated handles. their amounts are added together, one person each.",
    );
    expect(repeatNote(1, "handle")).toBe(
      "1 repeated handle. their amounts are added together, one person each.",
    );
  });

  it("addresses: the amounts are added together, one line each", () => {
    expect(repeatNote(2, "address")).toBe(
      "2 repeated addresses. their amounts are added together, one line each.",
    );
    expect(repeatNote(1, "address")).toBe(
      "1 repeated address. their amounts are added together, one line each.",
    );
  });

  it("a big count gets the comma", () => {
    expect(repeatNote(1200, "handle")).toMatch(/^1,200 repeated handles\./);
  });
});

describe("the step names", () => {
  it("are what and who, check it, fund it", () => {
    expect(STEP_LABELS).toEqual(["what and who", "check it", "fund it"]);
  });
});
