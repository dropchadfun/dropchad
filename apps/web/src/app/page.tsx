import { FrontPage } from "@/components/front/FrontPage";
import { chainPills } from "@/lib/chains";
import { ApiError, getBoard, getStats, listDrops } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The front page, in the locked order: header, chain pills, three numbers,
 * make a drop, live now, latest drops, top chads this week. The bottom bar is in the layout.
 *
 * Every read here is public, so it happens on the server. The api being down is not a crash:
 * each block renders what it has and says what it could not get.
 */
export default async function HomePage() {
  const [stats, drops, board] = await Promise.all([
    settle(getStats()),
    settle(listDrops(50)),
    // Most fed, every chain: what the rail shows first. The block refetches on a rail tap.
    settle(getBoard("week", "fed", "all")),
  ]);

  return (
    <FrontPage
      pills={chainPills()}
      stats={stats}
      drops={drops === null ? null : drops.drops}
      board={board}
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
