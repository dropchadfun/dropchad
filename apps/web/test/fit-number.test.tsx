/**
 * A tile number is never cut. `FitNumber.tsx` steps down the type scale,
 * until the whole value and coin fit; at the smallest step it wraps instead.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DISPLAY_FIT_STEPS,
  FIT_STEPS,
  FitNumber,
  fitStep,
  type FitStep,
} from "@/components/site/FitNumber";

describe("fitStep", () => {
  it("the steps are the scale's own classes, biggest first", () => {
    expect(FIT_STEPS).toEqual(["type-stat", "type-body", "type-table", "type-small"]);
  });

  it("keeps the stat size when it fits, and asks nothing more", () => {
    const asked: FitStep[] = [];
    const fit = fitStep((step) => {
      asked.push(step);
      return true;
    });
    expect(fit).toEqual({ step: "type-stat", wrap: false });
    expect(asked).toEqual(["type-stat"]);
  });

  it("steps down to the first size that fits", () => {
    expect(fitStep((step) => step === "type-table" || step === "type-small")).toEqual({
      step: "type-table",
      wrap: false,
    });
  });

  it("wraps at the smallest size when nothing fits, never cuts", () => {
    expect(fitStep(() => false)).toEqual({ step: "type-small", wrap: true });
  });
});

describe("fitStep from the display size, the funding card's send this amount", () => {
  it("the display size first, then the tile steps", () => {
    expect(DISPLAY_FIT_STEPS).toEqual([
      "type-display",
      "type-stat",
      "type-body",
      "type-table",
      "type-small",
    ]);
  });

  it("keeps display when it fits, steps down when not, wraps at small", () => {
    expect(fitStep(() => true, DISPLAY_FIT_STEPS)).toEqual({ step: "type-display", wrap: false });
    expect(fitStep((step) => step === "type-stat", DISPLAY_FIT_STEPS)).toEqual({
      step: "type-stat",
      wrap: false,
    });
    expect(fitStep(() => false, DISPLAY_FIT_STEPS)).toEqual({ step: "type-small", wrap: true });
  });
});

describe("FitNumber", () => {
  it("starts at the first of its steps, the unit inside the measured line", () => {
    const html = renderToStaticMarkup(
      <FitNumber value="12.500000001" steps={DISPLAY_FIT_STEPS} unit={<span>SOL</span>} />,
    );
    expect(html).toContain("type-display");
    expect(html).toContain(">12.500000001<");
    expect(html).toContain("<span>SOL</span>");
  });

  it("renders the whole value at the stat size, with no truncate", () => {
    const html = renderToStaticMarkup(<FitNumber value="0.0025 SOL" className="mt-1" />);
    expect(html).toContain(">0.0025 SOL<");
    expect(html).toContain("type-stat");
    expect(html).toContain("whitespace-nowrap");
    expect(html).not.toContain("truncate");
  });
});
