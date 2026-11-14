"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { addressFits, addressText } from "@/components/drops/claim";
import { cn } from "@/lib/utils";

/**
 * A receipt line with the wallet address claim page. The phone shows the short
 * address. Desktop shows the full one when it fits the box on one line, measured in the browser
 * on every width change, else the short one. Never a wrap and never a wider card: the box is cut
 * and the full text is measured out of the flow. Before the first measure, the short one.
 */
export function ClaimAddress({
  prefix,
  address,
  className,
}: {
  prefix: string;
  address: string;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    const full = measure.current;
    if (el === null || full === null) return;
    const check = () =>
      setFits(addressFits(full.getBoundingClientRect().width, el.getBoundingClientRect().width));
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [prefix, address]);

  return (
    <span
      ref={box}
      data-address-box="true"
      className={cn(
        "relative block min-w-0 overflow-hidden whitespace-nowrap md:flex-1",
        className,
      )}
    >
      <span className="md:hidden">{addressText(prefix, address, false)}</span>
      <span data-address-desktop="true" className="hidden md:inline">
        {addressText(prefix, address, fits)}
      </span>
      <span
        ref={measure}
        data-address-measure="true"
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 w-max"
      >
        {`${prefix}${address}`}
      </span>
    </span>
  );
}
