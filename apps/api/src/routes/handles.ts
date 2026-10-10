/**
 * `POST /api/handles/resolve` — the create page preview: pasted handles to X ids, names and
 * avatars, and the handles X does not know.
 *
 * Signed in and CSRF checked like every write, because a lookup can cost money. Rate limited
 * per session. The body is `{ handles: string[] }` and nothing else.
 */
import { Hono } from "hono";
import { z } from "zod";

import { readSessionCookie } from "../auth/cookies.js";
import { clientIp, rateLimit } from "../middleware/rate-limit.js";
import { requireSessionAndCsrf } from "../middleware/require-auth.js";
import { HandleResolveError, resolveHandles } from "../x/resolver.js";
import type { AppEnv } from "../app.js";
import { handleModeOnAnywhere } from "../binder/handle-mode.js";

const body = z.object({ handles: z.array(z.string().max(64)).min(1).max(10_000) }).strict();

export function createHandleRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use(
    "/resolve",
    rateLimit({ limit: 20, windowSeconds: 60, keyOf: (c) => readSessionCookie(c) ?? clientIp(c) }),
  );

  routes.post("/resolve", async (c) => {
    const { db, config, now } = c.var.deps;

    const auth = await requireSessionAndCsrf(c);
    if (auth.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
    if (auth.kind === "csrf_failed") return c.json({ error: "csrf_failed" }, 403);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    // every lookup costs a cent of X API. No preview for a drop nobody can make.
    const chains = c.var.deps.writeSides?.all() ?? [];
    if (!(await handleModeOnAnywhere(chains, c.var.deps.binders))) {
      return c.json({ error: "handle_mode_not_ready" }, 503);
    }

    try {
      const result = await resolveHandles({
        db,
        now: now(),
        fetchImpl: c.var.deps.xFetch ?? fetch,
        bearerToken: config.X_BEARER_TOKEN,
        maxHandles: config.HANDLE_MAX_RECEIVERS,
        dailyMax: config.HANDLE_LOOKUPS_DAILY_MAX,
        handles: parsed.data.handles,
      });
      return c.json({
        found: result.found.map((f) => ({
          handle: f.handle,
          xUserId: f.xUserId,
          displayName: f.displayName,
          profileImageUrl: f.profileImageUrl,
        })),
        missing: result.missing,
      });
    } catch (err) {
      if (!(err instanceof HandleResolveError)) throw err;
      switch (err.code) {
        case "bad_handle":
          return c.json({ error: "bad_handle", handles: err.handles }, 400);
        case "too_many":
          return c.json({ error: "too_many", max: config.HANDLE_MAX_RECEIVERS }, 400);
        case "daily_cap":
          return c.json({ error: "daily_cap" }, 429);
        case "not_configured":
          return c.json({ error: "handle_lookup_not_configured" }, 503);
        case "x_unavailable":
          return c.json({ error: "x_unavailable" }, 502);
      }
    }
  });

  return routes;
}
