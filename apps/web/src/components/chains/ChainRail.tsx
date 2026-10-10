"use client";

import { useRef, useState } from "react";

import { ALL, isAll, isOn, toggleChain, type ChainSelection } from "@/lib/chain-filter";
import type { ChainPill } from "@/lib/chains";
import { cn } from "@/lib/utils";

/**
 * The chain filter, the axiom take. Multi select: several chains can be on at
 * once, `all` is every chain. A colour mark is on, a grey mark is off, a tap toggles.
 *
 * - Desktop: a narrow vertical rail floating left of the list, `all` on top, one mark per chain.
 * - Phone: the same control laid out as one horizontal row, there is no room for a rail.
 *
 * A chain that is not live is the same mark behind `grayscale(1) opacity(0.45)`, not tappable,
 * `aria-disabled`, and shows `soon` on hover (desktop) or long press (phone). Never at rest.
 *
 * This is the filter. The create page keeps a single select, `ChainSwitch`: a drop belongs to
 * one chain.
 */
export function ChainRail({
  pills,
  value,
  onChange,
}: {
  pills: readonly ChainPill[];
  value: ChainSelection;
  onChange: (next: ChainSelection) => void;
}) {
  const [soon, setSoon] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);

  const showSoon = (key: string) => setSoon(key);
  const hideSoon = () => {
    setSoon(null);
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const all = isAll(value);

  return (
    <div
      className="flex items-center gap-1 md:flex-col md:items-stretch"
      role="group"
      aria-label="chains"
    >
      <button
        type="button"
        aria-pressed={all}
        onClick={() => onChange(ALL)}
        className={cn(
          "interactive flex size-11 cursor-pointer items-center justify-center rounded-lg",
          all ? "text-chad-text" : "text-chad-text-dim hover:text-chad-text",
        )}
      >
        <span className={cn("tile type-small font-medium", all && "bg-chad-surface-2")}>All</span>
      </button>

      {pills.map((pill) => {
        const on = pill.selectable && isOn(value, pill.key);
        return (
          <div key={pill.key} className="relative flex items-center justify-center">
            <button
              type="button"
              aria-pressed={pill.selectable ? on : undefined}
              aria-disabled={!pill.selectable}
              aria-label={pill.selectable ? pill.name : `${pill.name}, soon`}
              onClick={() => {
                if (!pill.selectable) return;
                onChange(toggleChain(value, pill.key, pills));
              }}
              onMouseEnter={() => !pill.selectable && showSoon(pill.key)}
              onMouseLeave={hideSoon}
              onTouchStart={() => {
                if (pill.selectable) return;
                pressTimer.current = window.setTimeout(() => showSoon(pill.key), 350);
              }}
              onTouchEnd={hideSoon}
              onTouchCancel={hideSoon}
              className={cn(
                "flex size-11 items-center justify-center rounded-lg",
                pill.selectable ? "interactive cursor-pointer" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "tile transition-[filter,opacity] duration-[120ms]",
                  !pill.selectable && "chain-soon",
                  pill.selectable && !on && "chain-off",
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
            {soon === pill.key ? (
              <span
                className="type-label pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 md:top-1/2 md:bottom-auto md:left-full md:ml-1 md:-translate-y-1/2 md:translate-x-0"
                aria-hidden="true"
              >
                soon
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
