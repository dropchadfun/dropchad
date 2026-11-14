/**
 * A new drop has 1 hour to fund and 3 days to
 * claim. The `/how` answers and the safe line say so.
 */
import { describe, expect, it } from "vitest";

import { FAQ } from "@/components/how/how";

const answer = (question: string) => FAQ.find((item) => item.q === question)?.lines;

describe("the /how answers", () => {
  it("funding: 1 hour, then it closes by itself", () => {
    expect(answer("how long do I have to fund a drop")).toEqual([
      "1 hour",
      "if not funded, it closes by itself",
    ]);
  });

  it("claiming: 3 days, then back to the refund wallet", () => {
    expect(answer("how long can people claim")).toEqual([
      "3 days",
      "after that the rest goes back to your refund wallet",
    ]);
  });

  it("no answer says the old periods any more", () => {
    const all = FAQ.flatMap((item) => item.lines).join(" ");
    expect(all).not.toContain("30 days");
    expect(all).not.toContain("7 days");
    expect(all).not.toContain("24 hours");
  });
});
