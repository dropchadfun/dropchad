import type { Chip } from "@/components/drops/drop-card-data";
import { cn } from "@/lib/utils";

/**
 * The one chip a card or row gets. Live is the accent, it is a state, not a
 * number. Funding, done and expired go quiet: an expired drop is not an error, it is dim,
 * never red.
 */
export function StatusChip({ chip, className }: { chip: Chip; className?: string }) {
  return (
    <span
      className={cn(
        "type-label inline-flex h-5 shrink-0 items-center rounded-md px-1.5",
        chip === "LIVE" && "bg-chad-accent/12 text-chad-accent",
        chip === "FUNDING" && "bg-chad-surface-2 text-chad-text",
        chip === "DONE" && "bg-chad-surface-2 text-chad-text-dim",
        chip === "EXPIRED" && "bg-chad-surface-2 text-chad-text-mute",
        className,
      )}
    >
      {chip === "LIVE" ? (
        <span className="live-dot mr-1.5 size-1.5 rounded-full bg-chad-accent" aria-hidden="true" />
      ) : null}
      {chip}
    </span>
  );
}
