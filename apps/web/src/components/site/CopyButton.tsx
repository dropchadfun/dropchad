"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies `value`. Says "copied" for a moment. Falls back to selecting nothing on old browsers. */
export function CopyButton({
  value,
  label = "copy",
  compact = false,
}: {
  value: string;
  label?: string;
  /** Small to look at, 28px, next to small text; the tap area stays 44px. */
  compact?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className={
        compact
          ? "btn btn-secondary type-small relative h-7 shrink-0 gap-1.5 px-2 before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']"
          : "btn btn-secondary h-9 shrink-0 px-3"
      }
    >
      {done ? (
        <Check
          className={compact ? "size-3.5 text-chad-accent" : "size-4 text-chad-accent"}
          aria-hidden="true"
        />
      ) : (
        <Copy className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
      )}
      {done ? "copied" : label}
    </button>
  );
}
