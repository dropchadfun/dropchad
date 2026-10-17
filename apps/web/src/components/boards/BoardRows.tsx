import Link from "next/link";

import { Avatar } from "@/components/site/Avatar";
import { MainTagPill } from "@/components/site/MainTag";
import { StreamLinks } from "@/components/site/StreamLinks";
import { TEST_COINS } from "@/components/site/TestCoinsLine";
import { TokenLogo } from "@/components/site/TokenLogo";
import { XLink } from "@/components/site/XLink";
import type { Board, BoardRow, BoardType, TokenInfo } from "@/lib/api";
import { TESTNET_ONLY, unitForKey } from "@/lib/chains";
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
  testnetOnly = TESTNET_ONLY,
}: {
  rows: readonly BoardRow[];
  highlightTop?: boolean;
  rankedBy?: Board["rankedBy"];
  /** `project`, `best token`, has no usd part on its rows. */
  board?: BoardType;
  /** On testnet every usd total says `in test coins`. */
  testnetOnly?: boolean;
}) {
  return (
    <div className="type-table">
      {rows.map((row) => (
        <Row
          key={row.profile.xUserId}
          row={row}
          rankedBy={rankedBy}
          board={board}
          testnetOnly={testnetOnly}
        />
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

function BigNumber({
  row,
  rankedBy,
  testnetOnly,
}: {
  row: BoardRow;
  rankedBy: Board["rankedBy"];
  testnetOnly: boolean;
}) {
  if (rankedBy === "usd") {
    return (
      <>
        {formatUsd(row.usd)}
        {testnetOnly ? (
          // Under the number on the phone, so the name keeps its room; after it on desktop.
          <span className="type-small block font-normal text-chad-text-dim md:ml-1 md:inline">
            {TEST_COINS}
          </span>
        ) : null}
      </>
    );
  }
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
 * token` no usd part, `3 drops · 5 payouts`: tokens never get a usd number. On testnet
 * `$3.61 in test coins · …`; the row passes the flag.
 */
export function usdAndDrops(row: BoardRow, board?: BoardType, testnetOnly = false): string {
  const drops = `${formatCount(row.dropCount)} ${row.dropCount === 1 ? "drop" : "drops"}`;
  const payouts = `${formatCount(row.claimCount)} ${row.claimCount === 1 ? "payout" : "payouts"}`;
  const counts = `${drops} · ${payouts}`;
  if (board === "project") return counts;
  // No-break spaces hold `$3.61 in test coins` together: on the phone the line wraps at a `·`.
  const usd = testnetOnly
    ? `${formatUsd(row.usd)} ${TEST_COINS}`.replace(/ /g, "\u00a0")
    : formatUsd(row.usd);
  return `${usd} · ${counts}`;
}

/**
 * `best token`: the chad's top token after the X link. The logo always; the ticker (`token`
 * when none) and a grey `+N` from `sm` up, so
 * on the phone the handle keeps its room. Not a link: a tap still opens the profile.
 */
function TopToken({ token, more }: { token: TokenInfo; more: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-normal">
      <TokenLogo token={token} size={16} />
      <span className="hidden text-chad-text sm:inline">
        {token.symbol ?? "token"}
        {more > 0 && <span className="ml-1 text-chad-text-dim">{`+${String(more)}`}</span>}
      </span>
    </span>
  );
}

function Row({
  row,
  rankedBy,
  board,
  testnetOnly,
}: {
  row: BoardRow;
  rankedBy: Board["rankedBy"];
  board: BoardType | undefined;
  testnetOnly: boolean;
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
          <span className="relative z-10 flex shrink-0 items-center gap-2">
            <XLink handle={row.profile.handle} />
            <StreamLinks streams={row.profile.streams} />
          </span>
          {board === "project" && row.topToken ? (
            <TopToken token={row.topToken} more={(row.tokens ?? 1) - 1} />
          ) : null}
          {/* The tag only from md up: on the phone it cut the names. */}
          <span className="relative z-10 hidden shrink-0 md:inline-flex">
            <MainTagPill tags={row.profile.tags} />
          </span>
        </span>
        {/* Wraps on the phone so nothing is cut; one line on desktop. */}
        <span className="type-small block text-chad-text-dim md:truncate">
          {usdAndDrops(row, board, testnetOnly)}
        </span>
      </span>
      <span
        className={cn(
          "num shrink-0 text-right font-medium",
          top && "type-stat",
          first ? "text-chad-accent" : "text-chad-text",
        )}
      >
        <BigNumber row={row} rankedBy={rankedBy} testnetOnly={testnetOnly} />
      </span>
    </div>
  );
}
