"use client";

import { useRouter } from "next/navigation";

import { BoardBlock } from "@/components/boards/BoardBlock";
import { BoardsFoot } from "@/components/boards/BoardsFoot";
import { BOARD_TABS, RANGE_TABS, TabLink, Tabs } from "@/components/boards/BoardTabs";
import { LiveLine, useLiveBoard } from "@/components/boards/LiveBoard";
import { ChainRail } from "@/components/chains/ChainRail";
import { getBoard, type Board, type BoardRange, type BoardType } from "@/lib/api";
import { ALL, boardChainOf, type ChainSelection } from "@/lib/chain-filter";
import type { ChainPill } from "@/lib/chains";

/**
 * `/boards`, the trending race: the chain is the rail, all or one, like every
 * other list; then two tab rows, `best dropchad` / `best token` and `24h` / `this week` / `all
 * time`. Every choice is in the url so a board can be linked; the page gets a new key on each,
 * `app/boards/page.tsx`. Under the title the live line; the board fetches itself again every 60
 * seconds. The footnote says what the board is and is not.
 */
export function BoardsPage({
  range,
  type,
  chain,
  pills,
  board: initial,
}: {
  range: BoardRange;
  type: BoardType;
  /** A pill key, or `all`. In the url like the tabs, so a board can be linked. */
  chain: string;
  pills: readonly ChainPill[];
  board: Board | null;
}) {
  const router = useRouter();
  const live = useLiveBoard(initial, () => getBoard(range, type, chain));
  const href = (r: BoardRange, t: BoardType, c: string = chain) =>
    `/boards?range=${r}&board=${t}&chain=${c}`;

  const selection: ChainSelection = chain === "all" ? ALL : new Set([chain]);
  const onChain = (next: ChainSelection) => {
    router.push(href(range, type, boardChainOf(next)));
  };

  const empty =
    range === "day"
      ? "nobody has dropped in the last 24 hours yet."
      : range === "week"
        ? "nobody has dropped this week yet."
        : "no finished drops yet.";

  const rail = <ChainRail pills={pills} value={selection} onChange={onChain} />;

  return (
    <>
      {/* row two on phone: the rail */}
      <div className="sticky top-12 z-20 border-b border-chad-border bg-chad-bg/95 backdrop-blur md:hidden">
        <div className="flex h-12 items-center px-3">{rail}</div>
      </div>

      <main className="mx-auto w-full max-w-(--container-content) px-4 md:grid md:grid-cols-[44px_minmax(0,1fr)] md:gap-6">
        <aside className="hidden md:block">
          <div className="sticky top-16 pt-6">{rail}</div>
        </aside>

        <div className="min-w-0 pt-4 md:pt-6">
          <h1 className="type-h1">top chads</h1>
          <LiveLine fetchedAt={live.fetchedAt} />
          <p className="type-small mt-1 text-chad-text-dim">
            who really gives, by what people actually received.
          </p>

          {/* the filter row: the type, then the range */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Tabs label="board">
              {BOARD_TABS.map((tab) => (
                <TabLink key={tab.value} href={href(range, tab.value)} active={tab.value === type}>
                  {tab.label}
                </TabLink>
              ))}
            </Tabs>
            <Tabs label="range">
              {RANGE_TABS.map((tab) => (
                <TabLink key={tab.value} href={href(tab.value, type)} active={tab.value === range}>
                  {tab.label}
                </TabLink>
              ))}
            </Tabs>
          </div>

          <div className="mt-4">
            <BoardBlock board={live.board} empty={empty} header />
          </div>

          <BoardsFoot />
        </div>
      </main>
    </>
  );
}
