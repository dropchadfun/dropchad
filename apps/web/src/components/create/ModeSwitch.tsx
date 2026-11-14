"use client";

import { Tabs } from "@/components/boards/BoardTabs";
import { cn } from "@/lib/utils";

import type { CreateMode } from "@/components/create/form";

export type { CreateMode };

/**
 * The switch at the top of `/create`: `drop` first and the default, `multisend`
 * always last, the board tabs look.
 *
 * `dropAvailable` is the chosen chain's `handleMode` from `GET /api/chains`: `false` greys `drop`
 * out, it cannot be picked, and one grey line says so. After launch this
 * state is a pause, so the line says paused, never soon. `null` while the api has not answered.
 * On the phone the two halves share the width, each at least 44px tall.
 *
 * `pauseLine`: new drops are off on the chosen chain. Both halves are greyed and
 * cannot be picked, and the line is the pause banner's one chain text, in place of the handle line.
 */
export function ModeSwitch({
  mode,
  dropAvailable,
  pauseLine = null,
  onChange,
}: {
  mode: CreateMode;
  dropAvailable: boolean | null;
  pauseLine?: string | null;
  onChange: (mode: CreateMode) => void;
}) {
  const allOff = pauseLine !== null;
  const off = allOff || dropAvailable === false;
  return (
    <div className="mt-4">
      {/* Full width on the phone; on desktop the tab row shrinks to its two segments. */}
      <div className="md:inline-block">
        <Tabs label="drop or multisend">
          <button
            type="button"
            aria-pressed={mode === "drop"}
            aria-disabled={off ? true : undefined}
            onClick={off ? undefined : () => onChange("drop")}
            className={segment(mode === "drop", off)}
          >
            drop
          </button>
          <button
            type="button"
            aria-pressed={mode === "multisend"}
            aria-disabled={allOff ? true : undefined}
            onClick={allOff ? undefined : () => onChange("multisend")}
            className={segment(mode === "multisend", allOff)}
          >
            multisend
          </button>
        </Tabs>
      </div>
      {allOff ? (
        <p className="type-small mt-2 whitespace-pre-line text-chad-text-dim">{pauseLine}</p>
      ) : off ? (
        <p className="type-small mt-2 text-chad-text-dim">x handle drops are paused</p>
      ) : null}
    </div>
  );
}

/** The board tab look, full width halves and a 44px target on the phone. */
const segment = (active: boolean, off: boolean) =>
  cn(
    "type-body flex h-11 flex-1 items-center justify-center rounded-md px-2.5 font-medium whitespace-nowrap md:h-8 md:flex-none",
    off
      ? "cursor-default text-chad-text-mute"
      : active
        ? "interactive bg-chad-surface-2 text-chad-text hover:bg-chad-surface-2"
        : "interactive text-chad-text-dim hover:text-chad-text",
  );
