"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { BoardBlock } from "@/components/boards/BoardBlock";
import { BOARD_TABS, RANGE_TABS, TabButton, Tabs } from "@/components/boards/BoardTabs";
import { LiveLine, useLiveBoard } from "@/components/boards/LiveBoard";
import { ChainRail } from "@/components/chains/ChainRail";
import { FrontClaimLine } from "@/components/drops/ClaimEntry";
import { DropRows } from "@/components/drops/DropRows";
import { fromListEntry, isListed, type DropCardData } from "@/components/drops/drop-card-data";
import {
  dropTabs,
  tabFromHash,
  urlWithoutLiveHash,
  type DropTab,
} from "@/components/front/drop-tabs";
import { urlWithBoardPage } from "@/components/front/board-page";
import { urlWithDropsPage } from "@/components/front/drops-page";
import { FrontLine } from "@/components/front/FrontLine";
import { TrendingBlock } from "@/components/front/Trending";
import { payoutsPaid, peoplePaid } from "@/components/front/people";
import { Empty } from "@/components/site/Empty";
import { Pager } from "@/components/site/Pager";
import { Section } from "@/components/site/Section";
import { Skeleton } from "@/components/site/Skeleton";
import { TestCoinsLine } from "@/components/site/TestCoinsLine";
import { TickingNumber } from "@/components/site/TickingNumber";
import { HOME_EVENT } from "@/lib/home";
import {
  ApiError,
  getBoard,
  listDropsPage,
  type Board,
  type BoardRange,
  type BoardType,
  type DropListEntry,
  type DropsPage,
  type Stats,
  type Trending,
} from "@/lib/api";
import {
  ALL,
  boardChainOf,
  chainKeyIsOn,
  selectedChainIds,
  type ChainSelection,
} from "@/lib/chain-filter";
import type { ChainPill } from "@/lib/chains";
import { droppedLine, formatPeople, formatUsd } from "@/lib/format";

/** An empty first `latest` page, when the caller hands none in. */
const NO_DROPS: DropsPage = { drops: [], page: 1, pageSize: 10, total: 0 };

/**
 * The front page, in the locked order: the numbers, make a drop with its line
 * (under it on the phone, right of it on desktop), one drops list with `latest` and `live` tabs,
 * top chads. Client side because the chain rail is state, the numbers tick
 * and the line's `@name` changes. Everything it shows was fetched by the server page and handed
 * in, except the board after a rail tap or a tab tap: that follows the rail like every list, so it
 * is fetched again here, `getBoard`, the old rows kept while the new ones load.
 *
 * Layout, the axiom take: on phone the rail is a horizontal row under the top bar, then the
 * numbers, the button, the sections. On desktop the rail is a narrow vertical strip floating
 * left of the content, and drops are rows, not cards.
 */
export function FrontPage({
  pills,
  stats,
  drops,
  board,
  trending,
  boardPage: firstBoardPage = 1,
  latest: firstLatest = NO_DROPS,
  dropsPage: firstDropsPage = 1,
}: {
  pills: readonly ChainPill[];
  stats: Stats | null;
  /** The newest drops, for the `live` tab, as before. */
  drops: DropListEntry[] | null;
  board: Board | null;
  /** `chain=all`. Absent or `null`: the block says it cannot load. */
  trending?: Trending | null;
  /** The `top chads` page the server read, `board_page=` in the url. */
  boardPage?: number;
  /** The `latest` page the server read, every chain. `null`: it cannot load. */
  latest?: DropsPage | null;
  /** That page's number, `drops_page=` in the url. */
  dropsPage?: number;
}) {
  const [selection, setSelection] = useState<ChainSelection>(ALL);
  const [boardType, setBoardType] = useState<BoardType>("fed");
  const [boardRange, setBoardRange] = useState<BoardRange>("week");
  const [boardLoading, setBoardLoading] = useState(false);
  // The `top chads` page, 1 based, its own value: the drops list page below never moves it, and
  // it never moves that one. In the url as `board_page=`.
  const [boardPage, setBoardPage] = useState(firstBoardPage);
  // The current `onBoardPage`, for the logo listener below, which is set up once.
  const boardPageRef = useRef<(next: number) => void>(() => undefined);
  const [tab, setTab] = useState<DropTab>("latest");
  // The `latest` page, 1 based, its own value apart from the board page; read from the api and
  // in the url as `drops_page=`. A page tap never leaves the front page.
  const [page, setPage] = useState(firstDropsPage);
  const [latestList, setLatestList] = useState<DropsPage | null>(firstLatest);
  const [latestLoading, setLatestLoading] = useState(false);
  // The current `onDropsPage`, for the logo listener below, which is set up once.
  const dropsPageRef = useRef<(next: number) => void>(() => undefined);
  const boardRequest = useRef(0);
  const latestRequest = useRef(0);

  // `/#live`, from old links, lands on the live tab once, then the address goes back to plain,
  // so a refresh opens `latest`. Read after mount: the server has no hash.
  useEffect(() => {
    const open = () => {
      if (tabFromHash(window.location.hash) === "live") setTab("live");
      const { pathname, search, hash } = window.location;
      const plain = urlWithoutLiveHash(pathname, search, hash);
      if (plain !== null) window.history.replaceState(null, "", plain);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  // The logo or `home` tapped while already here, `lib/home.ts`: back to `latest`, page 1. The
  // chain choice is kept. The `top chads` board back to page 1 too
  // the `latest` page read again from page 1.
  useEffect(() => {
    const home = () => {
      setTab("latest");
      setPage(1);
      boardPageRef.current(1);
      dropsPageRef.current(1);
    };
    window.addEventListener(HOME_EVENT, home);
    return () => window.removeEventListener(HOME_EVENT, home);
  }, []);

  // The server fetched the week board for all chains and `best dropchad`. Any other choice is a
  // refetch from the tap, the old rows kept while it loads; a late answer to an older tap is
  // dropped. Every 60 seconds the board fetches itself again for the current choice.
  const boardChain = boardChainOf(selection);
  const live = useLiveBoard(board, () => getBoard(boardRange, boardType, boardChain, boardPage));
  const loadBoard = (type: BoardType, range: BoardRange, chain: string, onPage: number) => {
    if (type === "fed" && range === "week" && chain === ALL && onPage === firstBoardPage) {
      live.set(board);
      return;
    }
    const request = ++boardRequest.current;
    setBoardLoading(true);
    getBoard(range, type, chain, onPage)
      .then((next) => {
        if (request === boardRequest.current) live.set(next);
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
        if (request === boardRequest.current) live.set(null);
      })
      .finally(() => {
        if (request === boardRequest.current) setBoardLoading(false);
      });
  };
  // The board page in the address, so a link or a refresh opens the same page. Nothing else in
  // the address moves.
  const showBoardPage = (next: number) => {
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, "", urlWithBoardPage(pathname, search, hash, next));
  };
  // One `latest` page from the api, the old rows kept while it loads; a late answer to an older
  // tap is dropped. The server's page for every chain is reused, never fetched twice.
  const loadLatest = (chain: string, onPage: number) => {
    if (chain === ALL && onPage === firstDropsPage) {
      latestRequest.current += 1;
      setLatestList(firstLatest);
      setLatestLoading(false);
      return;
    }
    const request = ++latestRequest.current;
    setLatestLoading(true);
    listDropsPage(onPage, chain)
      .then((next) => {
        if (request === latestRequest.current) setLatestList(next);
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
        if (request === latestRequest.current) setLatestList(null);
      })
      .finally(() => {
        if (request === latestRequest.current) setLatestLoading(false);
      });
  };
  // The drops page in the address, like the board page, and never the board page.
  const showDropsPage = (next: number) => {
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, "", urlWithDropsPage(pathname, search, hash, next));
  };
  const onDropsPage = (next: number) => {
    setPage(next);
    showDropsPage(next);
    loadLatest(boardChain, next);
  };
  useEffect(() => {
    dropsPageRef.current = onDropsPage;
  });
  const onRail = (next: ChainSelection) => {
    setSelection(next);
    setPage(1);
    showDropsPage(1);
    loadLatest(boardChainOf(next), 1);
    setBoardPage(1);
    showBoardPage(1);
    loadBoard(boardType, boardRange, boardChainOf(next), 1);
  };
  const onTab = (type: BoardType) => {
    setBoardType(type);
    setBoardPage(1);
    showBoardPage(1);
    loadBoard(type, boardRange, boardChain, 1);
  };
  const onRange = (range: BoardRange) => {
    setBoardRange(range);
    setBoardPage(1);
    showBoardPage(1);
    loadBoard(boardType, range, boardChain, 1);
  };
  const onBoardPage = (next: number) => {
    setBoardPage(next);
    showBoardPage(next);
    loadBoard(boardType, boardRange, boardChain, next);
  };
  useEffect(() => {
    boardPageRef.current = onBoardPage;
  });
  // The api says which page it answered and how many rows there are in all.
  const boardPages =
    live.board?.total === undefined
      ? 1
      : Math.max(1, Math.ceil(live.board.total / (live.board.pageSize ?? 10)));

  const cards = useMemo(() => {
    const all = (drops ?? []).filter(isListed).map(fromListEntry);
    const ids = selectedChainIds(selection, pills);
    return ids === null ? all : all.filter((card) => ids.has(card.chainId));
  }, [drops, selection, pills]);

  // `live` is the newest list, as before; `latest` is the page the api sent, its chain filtered
  // there.
  const tabs = dropTabs(cards);
  const latestCards = useMemo(
    () => (latestList?.drops ?? []).filter(isListed).map(fromListEntry),
    [latestList],
  );
  const dropsPages =
    latestList === null
      ? 1
      : Math.max(1, Math.ceil(latestList.total / (latestList.pageSize || 10)));
  const shown = tab === "live" ? tabs.live : latestCards;
  const unreadable = tab === "live" ? drops === null : latestList === null;

  // The numbers for the chains that are on. Usd adds up where coins do not: the
  // dropped tile is the usd from the prices frozen at activation, the coins are listed under it.
  // A chain whose usd could not be read makes the tile a skeleton, never a wrong number.
  const totals = (stats?.totals ?? []).filter((total) =>
    chainKeyIsOn(selection, total.chainKey, pills),
  );
  const usd = totals.some((t) => t.usd === null)
    ? null
    : totals.reduce((sum, t) => sum + (t.usd ?? 0), 0);
  const dropCount = totals.reduce((n, t) => n + t.dropCount, 0);
  // One X account on two chains is one person: the api counts every chain in one set.
  const people = peoplePaid(stats, selection, pills);
  const payouts = payoutsPaid(stats, selection, pills);

  return (
    <>
      {/* 2. the chain filter. Row two on phone; the rail on desktop, inside the grid below. */}
      <div className="sticky top-12 z-20 border-b border-chad-border bg-chad-bg/95 backdrop-blur md:hidden">
        <div className="flex h-12 items-center px-3">
          <ChainRail pills={pills} value={selection} onChange={onRail} />
        </div>
      </div>

      <main className="mx-auto w-full max-w-(--container-content) px-4 md:grid md:grid-cols-[44px_minmax(0,1fr)] md:gap-6">
        <aside className="hidden md:block">
          <div className="sticky top-16 pt-6">
            <ChainRail pills={pills} value={selection} onChange={onRail} />
          </div>
        </aside>

        <div className="min-w-0 pt-4 md:pt-6">
          {/* 3. three numbers. From /api/stats, final rows only. Usd frozen at activation. */}
          <dl className="grid grid-cols-3 gap-2 md:gap-3">
            <Stat
              label="total dropped"
              short="dropped"
              note={stats ? droppedLine(stats.dropped) : undefined}
              value={stats ? usd : null}
              format={formatUsd}
              testCoins
            />
            <Stat
              label="drops made"
              short="drops"
              note="funded and paid"
              value={stats ? dropCount : null}
            />
            {/* Payouts big, the people under it. */}
            <Stat
              label="payouts"
              short="payouts"
              note={people === null ? undefined : formatPeople(people)}
              value={payouts}
            />
          </dl>

          {/* 4. one big button. One tap. 5. its line: under it on the phone, right
              of it in two lines from lg up, centred on the button */}
          <div className="mt-4 md:mt-6 lg:flex lg:items-center lg:gap-6">
            <Link href="/create" className="btn btn-primary h-11 w-full shrink-0 md:w-auto md:px-6">
              make a drop
            </Link>
            <FrontLine />
          </div>
          {/* Only signed in, only with something to claim now */}
          <FrontClaimLine />

          {/* 5b. trending, three cards. Follows the rail like the board. */}
          <TrendingBlock initial={trending ?? null} chain={boardChain} />

          {/* 6. one drops list, two tabs. `id="live"` keeps the `/#live` anchor for old links. */}
          <Section id="live" title="drops">
            <div className="mb-3">
              <Tabs label="drops">
                <TabButton
                  active={tab === "latest"}
                  onClick={() => {
                    setTab("latest");
                    onDropsPage(1);
                  }}
                >
                  latest
                </TabButton>
                <TabButton
                  active={tab === "live"}
                  onClick={() => {
                    setTab("live");
                    onDropsPage(1);
                  }}
                >
                  live
                  {tabs.live.length > 0 ? (
                    <span className="num ml-1.5 text-chad-accent">{tabs.live.length}</span>
                  ) : null}
                </TabButton>
              </Tabs>
            </div>
            {unreadable ? (
              <Empty>drops cannot load right now. try again in a minute.</Empty>
            ) : shown.length === 0 ? (
              <Empty>
                {tab === "live" ? "no drop is live right now." : "no drops on these chains yet."}
              </Empty>
            ) : (
              <>
                <div
                  className={
                    tab === "latest" && latestLoading ? "opacity-60 transition-opacity" : undefined
                  }
                >
                  <DropList cards={shown} />
                </div>
                {tab === "latest" ? (
                  <Pager pages={dropsPages} page={latestList?.page ?? page} onPick={onDropsPage} />
                ) : null}
              </>
            )}
          </Section>

          {/* 7. top chads, the trending race: two tab rows, the live line, the top 10 rows */}
          <Section
            title="top chads"
            aside={{
              href: `/boards?range=${boardRange}&board=${boardType}&chain=${boardChain}`,
              label: "all boards",
            }}
          >
            <div className="-mt-1 mb-3">
              <LiveLine fetchedAt={live.fetchedAt} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Tabs label="board">
                {BOARD_TABS.map((tab) => (
                  <TabButton
                    key={tab.value}
                    active={tab.value === boardType}
                    onClick={() => onTab(tab.value)}
                  >
                    {tab.label}
                  </TabButton>
                ))}
              </Tabs>
              <Tabs label="range">
                {RANGE_TABS.map((tab) => (
                  <TabButton
                    key={tab.value}
                    active={tab.value === boardRange}
                    onClick={() => onRange(tab.value)}
                  >
                    {tab.label}
                  </TabButton>
                ))}
              </Tabs>
            </div>
            <div className={boardLoading ? "opacity-60 transition-opacity" : undefined}>
              <BoardBlock
                board={live.board}
                empty={
                  boardRange === "day"
                    ? "nobody has dropped in the last 24 hours yet."
                    : boardRange === "week"
                      ? "nobody has dropped this week yet."
                      : "no finished drops yet."
                }
                limit={10}
              />
            </div>
            <Pager
              pages={boardPages}
              page={live.board?.page ?? boardPage}
              label="board pages"
              onPick={onBoardPage}
            />
          </Section>
        </div>
      </main>
    </>
  );
}

/** Rows at every width. */
function DropList({ cards }: { cards: readonly DropCardData[] }) {
  return <DropRows rows={cards} />;
}

/**
 * One number tile: a plain label, the number, and on desktop a grey line when there is one:
 * plain words, or under `total dropped` the coins that moved, `0.001 ETH  0.006 SOL`, two
 * spaces apart so the span keeps its whitespace. When the api cannot answer the
 * tile is a quiet skeleton, never a red line. The full label does not fit a third
 * of a phone at 11px, so the phone gets the one word version.
 */
function Stat({
  label,
  short,
  note,
  value,
  format,
  unit,
  testCoins = false,
}: {
  label: string;
  short: string;
  note?: string | undefined;
  value: number | null;
  format?: ((n: number) => string) | undefined;
  unit?: string;
  /** A dollar total: on testnet `in test coins` under it. */
  testCoins?: boolean;
}) {
  return (
    <div className="card min-w-0 p-3 md:p-4">
      <dt className="type-label truncate">
        <span className="md:hidden">{short}</span>
        <span className="hidden md:inline">{label}</span>
      </dt>
      <dd className="mt-1">
        {value === null ? (
          <Skeleton className="h-6 w-16 md:h-7 md:w-24" />
        ) : (
          <span className="type-stat block truncate">
            <TickingNumber value={value} format={format} />
            {unit ? (
              <span className="type-small ml-1 font-medium text-chad-text-dim">{unit}</span>
            ) : null}
          </span>
        )}
        {testCoins && value !== null ? <TestCoinsLine /> : null}
        {note ? (
          <span className="type-small mt-1 hidden truncate whitespace-pre text-chad-text-dim md:block">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
