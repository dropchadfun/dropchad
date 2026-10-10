/**
 * Liveness. No auth, no rate limit, no database write.
 *
 * It does touch the database with a trivial read, because a health check that only proves the
 * process is alive is not worth having: the api is useless without its database.
 */
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../app.js";

export function createHealthRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const { db, now } = c.var.deps;
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      return c.json({ ok: false, database: "unreachable" }, 503);
    }
    return c.json({ ok: true, time: now().toISOString() });
  });

  return routes;
}
