/**
 * The funding warnings from the api. `apps/api/src/drops/payment.ts`
 * marks the part that must stand out with `**`; the card shows it bold and red, never the stars.
 */
import { describe, expect, it } from "vitest";

import { warningParts } from "@/components/drops/funding-warning";

// The refund line exactly as the api builds it, with a sample address.
const REFUND =
  "Your refund address is 0x000000000000000000000000000000000000dEaD. Unclaimed funds are sent " +
  "there after the claim deadline. **Never use an exchange deposit address or any address you " +
  "withdraw to from an exchange.** That refund arrives as a contract transfer and an exchange " +
  "can lose it forever. Use a wallet whose keys you hold.";

describe("warningParts", () => {
  it("a line without stars is one plain part", () => {
    expect(warningParts("Check the address.")).toEqual([
      { text: "Check the address.", strong: false },
    ]);
  });

  it("the part between two `**` is strong, the rest plain", () => {
    expect(warningParts("a **b** c")).toEqual([
      { text: "a ", strong: false },
      { text: "b", strong: true },
      { text: " c", strong: false },
    ]);
  });

  it("the api's refund line: the exchange sentence is strong, no star is left", () => {
    const parts = warningParts(REFUND);
    expect(parts.filter((p) => p.strong).map((p) => p.text)).toEqual([
      "Never use an exchange deposit address or any address you withdraw to from an exchange.",
    ]);
    expect(parts.map((p) => p.text).join("")).not.toContain("*");
  });

  it("stars that never close stay as they are", () => {
    expect(warningParts("a **b")).toEqual([{ text: "a **b", strong: false }]);
  });

  it("no empty parts", () => {
    expect(warningParts("**all of it**")).toEqual([{ text: "all of it", strong: true }]);
  });
});
