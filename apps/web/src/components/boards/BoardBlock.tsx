import { BoardRows } from "@/components/boards/BoardRows";
import { Empty } from "@/components/site/Empty";
import type { Board } from "@/lib/api";

/**
 * The rows of a board, or the honest reason there are none. A usd board says
 * `usd totals come when tokens are priced.` in one grey line and never a fake number. Shared by
 * the boards page and the front page block; `limit` is the front page's top three.
 */
export function BoardBlock({
  board,
  empty,
  limit,
  header = false,
}: {
  board: Board | null;
  /** What to say when a live board has no rows. */
  empty: string;
  limit?: number;
  header?: boolean;
}) {
  if (board === null) return <Empty>the board cannot load right now. try again in a minute.</Empty>;
  if (!board.available)
    return <Empty>{`${board.note ?? "usd totals come when tokens are priced"}.`}</Empty>;
  if (board.rows.length === 0) return <Empty>{empty}</Empty>;
  const rows = limit === undefined ? board.rows : board.rows.slice(0, limit);
  return (
    <>
      {header && (
        <div className="type-label flex h-8 items-center gap-3 border-b border-chad-border px-2 md:px-3">
          <span className="w-5 text-right">#</span>
          <span className="w-8" />
          <span className="flex-1">chad</span>
          <span>
            {board.rankedBy === "uniqueReceivers"
              ? "people"
              : board.rankedBy === "usd"
                ? "usd"
                : "given"}
          </span>
        </div>
      )}
      <BoardRows rows={rows} rankedBy={board.rankedBy} board={board.board} />
    </>
  );
}
