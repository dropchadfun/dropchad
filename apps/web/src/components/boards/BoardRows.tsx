import Link from "next/link";

import { Avatar } from "@/components/site/Avatar";
import { MainTagPill } from "@/components/site/MainTag";
import { XLink } from "@/components/site/XLink";
import type { Board, BoardRow, BoardType } from "@/lib/api";
import { unitForKey } from "@/lib/chains";
import { formatAmount, formatCount, formatPeople, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Board rows, the trending race: rank, avatar, `@handle`, the X
 * link, the main tag alone (from md up only); under the name `$21.40 · 4 drops` small and grey; right, the big
 * number, `40 people` on the people boards. The top 3 stand out: the number in `stat` and a thin
 * mint line on the left (`.board-top`). Rank 1's number is the accent.
 *
 * The row is tapped as a whole: the handle is the profile link, stretched over the row with
 * `after:absolute`; the X link and the tag sit above it (`relative z-10`), so there is never a
 * link inside a link.
 */
export function BoardRows({
  rows,
  rankedBy = "totalWei",
  board,
}: {
  rows: readonly BoardRow[];
  highlightTop?: boolean;
  rankedBy?: Board["rankedBy"];
  /** `project`, `best token`, has no usd part on its rows. */
  board?: BoardType;
}) {
  return (
    <div className="type-table">
      {rows.map((row) => (
        <Row key={row.profile.xUserId} row={row} rankedBy={rankedBy} board={board} />
      ))}
    </div>
  );
}

/** The coin of the one chain a filtered board shows, from the first row's totals. */
function unitOf(row: BoardRow): { amount: string; symbol: string } {
  const only = row.byChain.length === 1 ? row.byChain[0] : undefined;
  const unit = unitForKey(only?.chainKey ?? "robinhood");
  return { amount: formatAmount(row.totalWei, unit.decimals), symbol: unit.symbol };
}

function BigNumber({ row, rankedBy }: { row: BoardRow; rankedBy: Board["rankedBy"] }) {
  if (rankedBy === "usd") return <>{formatUsd(row.usd)}</>;
  if (rankedBy === "uniqueReceivers") {
    // "7 people": the count lit, the word dim and small.
    const [count, word] = formatPeople(row.uniqueReceivers).split(" ");
    return (
      <>
        {count} <span className="type-table font-normal text-chad-text-dim">{word}</span>
      </>
    );
  }
  const unit = unitOf(row);
  return (
    <>
      {unit.amount} <span className="text-chad-text-dim">{unit.symbol}</span>
    </>
  );
}

/**
 * `$3.61 · 3 drops · 5 payouts`: the usd frozen at activation, the drop count, then the
 * payouts, every final claim. The board still ranks by people. On `best
 * token` no usd part, `3 drops · 5 payouts`: tokens never get a usd number.
 */
export function usdAndDrops(row: BoardRow, board?: BoardType): string {
  const drops = `${formatCount(row.dropCount)} ${row.dropCount === 1 ? "drop" : "drops"}`;
  const payouts = `${formatCount(row.claimCount)} ${row.claimCount === 1 ? "payout" : "payouts"}`;
  const counts = `${drops} · ${payouts}`;
  return board === "project" ? counts : `${formatUsd(row.usd)} · ${counts}`;
}

function Row({
  row,
  rankedBy,
  board,
}: {
  row: BoardRow;
  rankedBy: Board["rankedBy"];
  board: BoardType | undefined;
}) {
  const first = row.rank === 1;
  const top = row.rank <= 3;
  return (
    <div
      className={cn(
        "row board-row relative flex min-h-12 items-center gap-3 px-2 py-1.5 md:px-3",
        top && "board-top",
      )}
    >
      <span
        className={`num w-5 shrink-0 text-right font-medium ${first ? "text-chad-accent" : "text-chad-text-dim"}`}
      >
        {row.rank}
      </span>
      <Avatar src={row.profile.profileImageUrl} name={row.profile.handle} size={32} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 font-medium text-chad-text">
          <Link
            href={`/u/${row.profile.handle}`}
            className="truncate after:absolute after:inset-0 after:content-['']"
          >
            @{row.profile.handle}
          </Link>
          <span className="relative z-10 flex shrink-0 items-center">
            <XLink handle={row.profile.handle} />
          </span>
          {/* The tag only from md up: on the phone it cut the names. */}
          <span className="relative z-10 hidden shrink-0 md:inline-flex">
            <MainTagPill tags={row.profile.tags} />
          </span>
        </span>
        <span className="type-small block truncate text-chad-text-dim">
          {usdAndDrops(row, board)}
        </span>
      </span>
      <span
        className={cn(
          "num shrink-0 text-right font-medium",
          top && "type-stat",
          first ? "text-chad-accent" : "text-chad-text",
        )}
      >
        <BigNumber row={row} rankedBy={rankedBy} />
      </span>
    </div>
  );
}
