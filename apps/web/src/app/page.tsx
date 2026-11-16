import { boardPageFromParam } from "@/components/front/board-page";
import { dropsPageFromParam } from "@/components/front/drops-page";
import { FrontPage } from "@/components/front/FrontPage";
import { chainPills } from "@/lib/chains";
import { readLiveChains } from "@/lib/live-chains";
import { ApiError, getBoard, getStats, getTrending, listDrops, listDropsPage } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The front page, in the locked order: header, chain pills, three numbers,
 * make a drop, trending, live now, latest drops, top chads this week. The bottom bar is in the layout.
 *
 * Every read here is public, so it happens on the server. The api being down is not a crash:
 * each block renders what it has and says what it could not get.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ board_page?: string; drops_page?: string }>;
}) {
  const params = await searchParams;
  // The `top chads` page, its own `board_page=`. Anything else is page 1.
  const boardPage = boardPageFromParam(params.board_page);
  // The `latest` page, its own `drops_page=`. Anything else is page 1.
  const dropsPage = dropsPageFromParam(params.drops_page);
  // The pills of the live chains, from the api switch.
  const [view, stats, drops, latest, board, trending] = await Promise.all([
    readLiveChains(),
    settle(getStats()),
    // The newest drops, for the `live` tab, as before.
    settle(listDrops(50)),
    settle(listDropsPage(dropsPage, "all")),
    // Most fed, every chain: what the rail shows first. The block refetches on a rail tap.
    settle(getBoard("week", "fed", "all", boardPage)),
    // The trending cards, every chain; a rail tap reads again.
    settle(getTrending("all")),
  ]);

  return (
    <FrontPage
      pills={chainPills({ view })}
      stats={stats}
      drops={drops === null ? null : drops.drops}
      board={board}
      trending={trending}
      boardPage={boardPage}
      latest={latest}
      dropsPage={dropsPage}
    />
  );
}

/** `null` when the api could not answer. A 503 from the indexer is the usual reason. */
async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError || error instanceof TypeError) return null;
    throw error;
  }
}
