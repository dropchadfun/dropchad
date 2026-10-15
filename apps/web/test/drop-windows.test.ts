/**
 * a new drop has 24
 * hours to fund and 7 days to claim. The `/how` answers and the safe line say so.
 */
import { describe, expect, it } from "vitest";

import { FAQ } from "@/components/how/how";

const answer = (question: string) => FAQ.find((item) => item.q === question)?.a;

describe("the /how answers", () => {
  it("not funded: 24 hours, called off, back to your refund address", () => {
    expect(answer("what if I do not fund the drop?")).toBe(
      "if it is not fully funded in 24 hours, it is called off and anything you sent goes back to your refund address.",
    );
  });

  it("never claimed: after 7 days", () => {
    expect(answer("what if someone never claims?")).toBe(
      "after 7 days, whatever is left goes back to the wallet you picked when you made the drop.",
    );
  });

  it("no answer says 30 days or 7 days to fund any more", () => {
    const all = FAQ.map((item) => item.a).join(" ");
    expect(all).not.toContain("30 days");
    expect(all).not.toContain("funded in 7 days");
  });
});
