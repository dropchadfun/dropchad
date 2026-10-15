/**
 * `GET /api/me/multisends` — the signed in sender's own multisends
 *
 * Only to that account: no session or a dead one is `401 unauthorized`. Only `mode = address`
 * drops whose `x_user_id` is the session's X id, newest first, at most `MY_MULTISENDS_MAX`. The
 * rows come from the api's own table, kept up by the worker; no chain call. A row carries no
 * handle, no name and no X id, so this door names nobody either. Rate limited like
 * `GET /api/claims`, and `private, no-store`, so no shared cache keeps one sender's list.
 */
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../app.js";
import { readSessionCookie } from "../auth/cookies.js";
import { readSession } from "../auth/session.js";
import { drops } from "../db/schema.js";
import { clientIp, rateLimit } from "../middleware/rate-limit.js";

export const MY_MULTISENDS_MAX = 100;

export function createMyMultisendRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use(
    "/",
    rateLimit({ limit: 30, windowSeconds: 60, keyOf: (c) => readSessionCookie(c) ?? clientIp(c) }),
  );

  routes.get("/", async (c) => {
    const { db, config, now } = c.var.deps;
    c.header("cache-control", "private, no-store");

    const sessionId = readSessionCookie(c);
    if (sessionId === undefined) return c.json({ error: "unauthorized" }, 401);
    const session = await readSession(db, {
      secret: config.SESSION_SECRET,
      sessionId,
      now: now(),
    });
    if (session === null) return c.json({ error: "unauthorized" }, 401);

    const rows = await db
      .select({
        address: drops.address,
        chainKey: drops.chainKey,
        title: drops.title,
        asset: drops.asset,
        tokenSymbol: drops.tokenSymbol,
        tokenDecimals: drops.tokenDecimals,
        totalEntitlements: drops.totalEntitlements,
        leafCount: drops.leafCount,
        paidCount: drops.paidCount,
        state: drops.state,
        createdAt: drops.createdAt,
      })
      .from(drops)
      .where(and(eq(drops.xUserId, session.xUserId), eq(drops.mode, "address")))
      .orderBy(desc(drops.createdAt))
      .limit(MY_MULTISENDS_MAX);

    return c.json({
      multisends: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  });

  return routes;
}
