/**
 * `GET /api/users/:handle` — one chad: the profile, the final totals, and the wall of drops.
 *
 * Public. The handle is display only and is refreshed on every login
 * so the lookup is case insensitive and the page always shows the handle as X last spelled it.
 * The X id stays the identity underneath.
 *
 * The totals come from the same code as the board, so the number on a profile is the number
 * that ranks the chad. When the indexer is down the profile and the wall still render, because
 * both are ours, and `totals.available` says the final numbers could not be read.
 *
 * `received`: the paid handle drops of this X id, from the same chain rows
 * as the totals, read once. A chain that cannot be read makes both unavailable together.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { loadStreams } from "../auth/stream-links.js";
import { boardProfile } from "../boards/compute.js";
import { loadBoardRows, loadChadTotals, loadReceived } from "../boards/load.js";
import { chainFilter, unitOf, type ChainFilter } from "../chain/filter.js";
import { drops, profiles } from "../db/schema.js";
import { ownDropCard } from "../drops/card.js";
import { droppedList, SolanaUnavailableError } from "../drops/read.js";
import { tokenInfoOf } from "../drops/token-info.js";
import { IndexerUnavailableError } from "../indexer/client.js";
import type { AppEnv } from "../app.js";

/** X handles: 1 to 15 of `[A-Za-z0-9_]`. Anything else never reaches the database. */
const handleParam = z.object({ handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/) });

/** A wall, not a history. The full list belongs on a later page. */
const WALL_LIMIT = 50;

/** The received list, newest first, the same size as the wall. */
const RECEIVED_LIMIT = 50;

export function createUserRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/:handle", async (c) => {
    const parsed = handleParam.safeParse({ handle: c.req.param("handle") });
    if (!parsed.success) return c.json({ error: "invalid_handle" }, 400);

    const { db, indexer, now, config, solanaReader } = c.var.deps;

    const rows = await db
      .select()
      .from(profiles)
      .where(sql`lower(${profiles.handle}) = ${parsed.data.handle.toLowerCase()}`)
      .limit(1);
    const profile = rows[0];
    if (profile === undefined) return c.json({ error: "not_found" }, 404);

    const streams = await loadStreams(db, config, [profile.xUserId]);
    const publicProfile = boardProfile(profile, streams.get(profile.xUserId));

    const wall = await db
      .select()
      .from(drops)
      // Handle drops only. A multisend is never on a profile.
      .where(and(eq(drops.xUserId, profile.xUserId), eq(drops.mode, "handle")))
      .orderBy(desc(drops.createdAt))
      .limit(WALL_LIMIT);

    let totals;
    let received;
    try {
      const source = { db, indexer, now, indexerChainKey: config.CHAIN_KEY, solana: solanaReader };
      const everyChain = chainFilter("all") as ChainFilter;
      const rows = await loadBoardRows(source, everyChain, null);
      // Every chain. `totalWei` stays the EVM wei it always was; `byChain` has each coin.
      const all = await loadChadTotals(source, "all", everyChain, "all", rows);
      const mine = all.find((entry) => entry.profile.xUserId === profile.xUserId);
      totals = {
        available: true,
        finality: "final",
        totalWei: (mine?.totalWei ?? 0n).toString(),
        dropCount: mine?.dropCount ?? 0,
        uniqueReceivers: mine?.uniqueReceivers ?? 0,
        // Payouts, every final claim.
        claimCount: mine?.claimCount ?? 0,
        // Usd from the prices frozen at activation, two decimals. Unpriced drops count zero.
        usd: Math.round((mine?.usd ?? 0) * 100) / 100,
        biggestDropWei: (mine?.biggestDropWei ?? 0n).toString(),
        byChain: (mine?.byChain ?? []).map((chain) => ({
          chainKey: chain.chainKey,
          total: chain.total.toString(),
          biggestDrop: chain.biggestDrop.toString(),
          dropCount: chain.dropCount,
          uniqueReceivers: chain.uniqueReceivers,
          claimCount: chain.claimCount,
        })),
        // The coin line under `dropped`, the same rule as the front page tile: the coins, then
        // the number of different tokens.
        dropped: droppedList(
          (mine?.byChain ?? []).map((chain) => ({
            ...unitOf(chain.chainKey),
            amount: chain.total,
          })),
          mine?.tokens ?? 0,
        ),
      };
      // The senders carry their Kick and Twitch links, like a board row.
      const items = await loadReceived(
        { ...source, config },
        rows,
        profile.xUserId,
        RECEIVED_LIMIT,
      );
      received = {
        available: true,
        // Never another receiver, the address paid or a usd value.
        items: items.map(({ drop, amount, sender }) => ({
          address: drop.address,
          chainKey: drop.chainKey,
          title: drop.title,
          createdAt: drop.createdAt.toISOString(),
          amount,
          token: tokenInfoOf(drop),
          sender,
        })),
      };
    } catch (error) {
      // The indexer down or the Solana cluster unreadable: the profile and its wall still stand,
      // the totals say so, never a 500.
      if (!(error instanceof IndexerUnavailableError || error instanceof SolanaUnavailableError))
        throw error;
      if (error instanceof SolanaUnavailableError)
        console.error("solana profile totals unavailable", error.cause);
      totals = { available: false, finality: "final" };
      received = { available: false };
    }

    return c.json({
      profile: publicProfile,
      totals,
      received,
      drops: wall.map((row) => ownDropCard(row, publicProfile)),
    });
  });

  return routes;
}
