/**
 * `GET /api/trending?chain=…` — the trending block on the front page.
 *
 * Public, no session. Final rows only, the same reads and counting as `GET /api/boards`. Only
 * the last 24 hours are read for chad of the day and top coin; just dropped reads the
 * newest funded drops on chain. An empty top coin also reads the newest token drop
 * ever. The reads are in `src/boards/trending-read.ts`, the
 * cards in `src/boards/trending.ts`.
 */
import { Hono } from "hono";
import { z } from "zod";

import { NO_TRENDING, trendingJson } from "../boards/trending.js";
import { readTrending } from "../boards/trending-read.js";
import { chainFilter, defaultPillKey, isMainnetSite } from "../chain/filter.js";
import { SolanaUnavailableError } from "../drops/read.js";
import { IndexerUnavailableError } from "../indexer/client.js";
import type { AppEnv } from "../app.js";

const query = z.object({
  chain: z.string().min(1).max(40).optional(),
});

export function createTrendingRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const parsed = query.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const { db, indexer, now, config, solanaReader } = c.var.deps;
    const filter = chainFilter(parsed.data.chain ?? defaultPillKey(config), {
      mainnetSite: isMainnetSite(config),
    });
    if (filter === undefined) return c.json({ error: "invalid_query" }, 400);

    const source = {
      db,
      indexer,
      now,
      indexerChainKey: config.CHAIN_KEY,
      solana: solanaReader,
      config,
    };
    try {
      const cards = await readTrending(source, filter, { newestCoin: true });
      return c.json({
        chain: filter.key,
        finality: "final",
        available: true,
        ...trendingJson(cards),
      });
    } catch (error) {
      if (error instanceof IndexerUnavailableError) {
        return c.json({ error: "indexer_unavailable" }, 503);
      }
      // As the board: half the chains cannot trend honestly, so no items.
      if (error instanceof SolanaUnavailableError) {
        console.error("solana trending unavailable", error.cause);
        return c.json({
          chain: filter.key,
          finality: "final",
          available: false,
          ...trendingJson(NO_TRENDING),
        });
      }
      throw error;
    }
  });

  return routes;
}
