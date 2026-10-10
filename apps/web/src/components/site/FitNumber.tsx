"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A number that is never cut. It starts at its first step and
 * steps down the scale's own classes until the whole value and its unit fit on one line; at
 * `small` it wraps instead. Never an ellipsis, never a size outside the scale.
 */
export const FIT_STEPS = ["type-stat", "type-body", "type-table", "type-small"] as const;
/** The funding card's `send this amount`: the one hero number, then the tile steps. */
export const DISPLAY_FIT_STEPS = ["type-display", ...FIT_STEPS] as const;
export type FitStep = (typeof DISPLAY_FIT_STEPS)[number];

export interface Fit {
  readonly step: FitStep;
  readonly wrap: boolean;
}

/** The first step that fits, biggest first. Nothing fits: the smallest, wrapped. */
export function fitStep(
  fits: (step: FitStep) => boolean,
  steps: readonly FitStep[] = FIT_STEPS,
): Fit {
  for (const step of steps) if (fits(step)) return { step, wrap: false };
  return { step: steps[steps.length - 1] ?? "type-small", wrap: true };
}

function classOf(fit: Fit, className: string | undefined): string {
  return cn("block", fit.step, fit.wrap ? "break-all" : "whitespace-nowrap", className);
}

export function FitNumber({
  value,
  className,
  steps = FIT_STEPS,
  unit,
}: {
  value: string;
  className?: string | undefined;
  steps?: readonly FitStep[];
  /** Shown after the value and measured with it, like the coin next to `send this amount`. */
  unit?: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<Fit>({ step: steps[0] ?? "type-stat", wrap: false });

  // Measured in the browser, on every width change: try each size, keep the first that fits.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const next = fitStep((step) => {
        el.className = classOf({ step, wrap: false }, className);
        return el.scrollWidth <= el.clientWidth;
      }, steps);
      el.className = classOf(next, className);
      setFit((old) => (old.step === next.step && old.wrap === next.wrap ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, className, steps]);

  return (
    <span ref={ref} className={classOf(fit, className)}>
      <span>{value}</span>
      {unit === undefined ? null : <> {unit}</>}
    </span>
  );
}
