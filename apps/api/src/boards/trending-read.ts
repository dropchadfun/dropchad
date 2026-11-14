/**
 * The trending reads: the same reads and counting as `GET /api/boards`.
 * Shared by `GET /api/trending` and the Telegram trending post. Throws
 * `IndexerUnavailableError` and `SolanaUnavailableError` as the reads do; the caller decides.
 * The top coin `newest` is read only with `newestCoin` and an empty top coin card;
 * the route asks for it, the Telegram post never does.
 */
import { chains } from "@dropchad/chains";

import type { ChainFilter } from "../chain/filter.js";
import { DAY_SECONDS } from "./compute.js";
import {
  countHandleDrops,
  loadBoardProfiles,
  loadBoardRows,
  loadFundedDrops,
  type BoardSource,
} from "./load.js";
import { newestCoin, trendingCards, type TrendingCards } from "./trending.js";

export async function readTrending(
  source: BoardSource,
  filter: ChainFilter,
  options: { readonly newestCoin?: boolean } = {},
): Promise<TrendingCards> {
  const nowSeconds = Math.floor(source.now().getTime() / 1000);
  const rows = await loadBoardRows(source, filter, nowSeconds - DAY_SECONDS);
  const counted = await countHandleDrops(source.db, rows, source.indexerChainKey);
  const funded = await loadFundedDrops(source, filter);
  const profilesById = await loadBoardProfiles(source, [
    ...new Set([...counted, ...funded].map((drop) => drop.xUserId)),
  ]);
  const cards = trendingCards(counted, funded, profilesById, {
    filter,
    evmChainKeys: new Set(chains.filter((chain) => chain.family === "evm").map((c) => c.key)),
    nowSeconds,
  });
  if (options.newestCoin !== true || cards.coin.items.length > 0) return cards;

  // No time window: every row in scope, the board's own counting.
  const ever = await countHandleDrops(
    source.db,
    await loadBoardRows(source, filter, null),
    source.indexerChainKey,
  );
  const everProfiles = await loadBoardProfiles(source, [
    ...new Set(ever.map((drop) => drop.xUserId)),
  ]);
  return { ...cards, coin: { ...cards.coin, newest: newestCoin(ever, everProfiles) } };
}
