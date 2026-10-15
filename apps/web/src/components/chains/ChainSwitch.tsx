"use client";

import type { ChainPill } from "@/lib/chains";
import { cn } from "@/lib/utils";

/**
 * The single select chain picker: the create page only, a drop belongs to one
 * chain. The same marks as the rail, one on at a time. Filtering is `ChainRail`, not this.
 *
 * - A live chain is full colour when selected, grey when not. No ring, no glow.
 * - A chain that is not live is the same tile behind `grayscale(1) opacity(0.45)`, not
 *   tappable, `aria-disabled`, and always shows a small `soon` under it.
 * - Every mark sits in a 44px target.
 *
 * `allowAll` is kept for the front page history and is off on the create page.
 */
export function ChainSwitch({
  pills,
  value,
  onChange,
  allowAll = true,
}: {
  pills: readonly ChainPill[];
  value: string;
  onChange: (key: string) => void;
  allowAll?: boolean;
}) {
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="chain">
      {allowAll ? (
        <button
          type="button"
          role="radio"
          aria-checked={value === "all"}
          onClick={() => onChange("all")}
          className={cn(
            "interactive type-label flex h-11 min-w-11 items-center justify-center rounded-lg border px-3",
            value === "all"
              ? "border-chad-text bg-chad-text text-chad-bg hover:bg-chad-text"
              : "border-chad-border text-chad-text-dim hover:text-chad-text",
          )}
        >
          all
        </button>
      ) : null}

      {pills.map((pill) => {
        const active = value === pill.key;
        return (
          <div key={pill.key} className="relative flex h-11 items-center">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={!pill.selectable}
              aria-label={pill.selectable ? pill.name : `${pill.name}, soon`}
              onClick={() => {
                if (!pill.selectable) return;
                onChange(active && allowAll ? "all" : pill.key);
              }}
              className={cn(
                "flex size-11 items-center justify-center rounded-lg",
                pill.selectable ? "interactive cursor-pointer" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "tile transition-[filter,opacity] duration-[120ms]",
                  !pill.selectable && "chain-soon",
                  pill.selectable && !active && "chain-off",
                )}
                style={{ background: pill.tileColor }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static svg, no sizing needed */}
                <img
                  src={pill.logo}
                  alt=""
                  width={16}
                  height={16}
                  className="block object-contain"
                  style={{ width: 16 * pill.markScale, height: 16 * pill.markScale }}
                />
              </span>
            </button>
            {pill.selectable ? null : (
              <span
                className="type-label pointer-events-none absolute top-[35px] left-1/2 -translate-x-1/2 leading-none normal-case"
                aria-hidden="true"
              >
                soon
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
