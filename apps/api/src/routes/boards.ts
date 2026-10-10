/**
 * `GET /api/boards?range=day|week|all&board=fed|dropper|project&chain=…&kind=…` — top chads.
 *
 * Public, no session. Built from **final** rows only, and the response says so. The
 * grouping and the reason it happens here and not in the indexer are in `src/boards/compute.ts`.
 *
 * `kind` filters on `profiles.kind`. Nothing sets that column yet, migration 0004, so today the
 * three kind tabs are empty and everyone is on `all`. That is the honest state, not a bug.
 *
 * `chain` is a pill key, a chain key or `all`. It defaults to the pill of the api's default
 * chain. `board` picks the ranking: `fed`, the default, is wallets fed on any
 * chain view; `dropper` is everyone by usd; `project` is the project profiles by usd. Usd is the
 * price frozen at activation, unpriced drops count zero, `available` is always true now.
 */
import { Hono } from "hono";
import { z } from "zod";

import {
  BOARD_KINDS,
  BOARD_RANGES,
  BOARD_TYPES,
  boardRowJson,
  assetScopeFor,
  rankBoard,
  rankedByFor,
} from "../boards/compute.js";
import { loadChadTotals } from "../boards/load.js";
import { chainFilter, pillKeyOf } from "../chain/filter.js";
import { SolanaUnavailableError } from "../drops/read.js";
import { IndexerUnavailableError } from "../indexer/client.js";
import type { AppEnv } from "../app.js";

/** Fifty rows is a full board. The front page takes the top three of the week. */
const LIMIT = 50;

const query = z.object({
  range: z.enum(BOARD_RANGES).default("week"),
  kind: z.enum(BOARD_KINDS).default("all"),
  board: z.enum(BOARD_TYPES).default("fed"),
  chain: z.string().min(1).max(40).optional(),
});

export function createBoardRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const parsed = query.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const { range, kind, board } = parsed.data;
    const { db, indexer, now, config, solanaReader } = c.var.deps;
    const filter = chainFilter(parsed.data.chain ?? pillKeyOf(config.CHAIN_KEY));
    if (filter === undefined) return c.json({ error: "invalid_query" }, 400);

    // `fed` and `dropper` count SOL and ETH drops only, `project`, the best token
    // tab, token drops only. No board forces a kind any more; `kind` in the query narrows each.
    try {
      const totals = await loadChadTotals(
        { db, indexer, now, indexerChainKey: config.CHAIN_KEY, solana: solanaReader },
        range,
        filter,
        assetScopeFor(board),
      );
      const rankedBy = rankedByFor(board);
      const rows = rankBoard(totals, kind, rankedBy).slice(0, LIMIT).map(boardRowJson);
      return c.json({
        range,
        kind,
        board,
        chain: filter.key,
        rankedBy,
        available: true,
        // Said out loud, like /api/stats. Nothing `seen` is in here.
        finality: "final",
        rows,
      });
    } catch (error) {
      if (error instanceof IndexerUnavailableError) {
        return c.json({ error: "indexer_unavailable" }, 503);
      }
      // Half the chains cannot be ranked honestly: no rows and the reason, never a 500,
      // The web shows the note.
      if (error instanceof SolanaUnavailableError) {
        console.error("solana boards unavailable", error.cause);
        return c.json({
          range,
          kind,
          board,
          chain: filter.key,
          rankedBy: rankedByFor(board),
          available: false,
          note: "the board cannot load right now. try again in a minute",
          finality: "final",
          rows: [],
        });
      }
      throw error;
    }
  });

  return routes;
}
