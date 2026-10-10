"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that counts to its value instead of jumping. 400ms, enter easing.
 * Under `prefers-reduced-motion` the final value is set once, no count.
 */
export function TickingNumber({
  value,
  format = (n) => n.toLocaleString("en-US"),
  className,
}: {
  value: number;
  format?: ((n: number) => string) | undefined;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 400);
      // cubic-bezier(0.2, 0, 0, 1) is close to this ease out for a counter.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = start + (value - start) * eased;
      setShown(t < 1 ? current : value);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={`num ${className ?? ""}`}>
      {format(Number.isInteger(value) ? Math.round(shown) : shown)}
    </span>
  );
}
