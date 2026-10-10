/**
 * `GET /api/me` — who is signed in.
 * `PATCH /api/me` — the one thing a chad can change about themselves: the tags.
 *
 * `GET` returns `null` rather than a 401 when there is no session. "Nobody is signed in" is a
 * normal answer for a front page, not an error, and it keeps the frontend from treating a
 * logged out visitor as a failure.
 *
 * `PATCH` is a write, so it runs the same gate as `POST /api/drops`: a live session and a CSRF
 * token bound to it. The body is `{ tags }` and nothing else: one to `MAX_TAGS` of
 * `PROFILE_TAGS`, no repeat, kept in the order sent, the main tag first. **The set locks for
 * `TAG_LOCK_DAYS`**: the update is conditional on `tag_set_at` being empty or old enough, one
 * statement, so two requests cannot both win; a locked profile gets `409 tag_locked` with the
 * moment it opens; a change of the main tag alone is a save like any other. A set is never
 * emptied. The kind is derived here from the main tag, `kindFromTags`, never an input. A tag is
 * self picked and is not verification; nothing reads it as proof.
 */
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { readSessionCookie } from "../auth/cookies.js";
import { readSession } from "../auth/session.js";
import {
  boardProfile,
  kindFromTags,
  MAX_TAGS,
  PROFILE_TAGS,
  TAG_LOCK_MS,
  tagLockedUntil,
} from "../boards/compute.js";
import { profiles } from "../db/schema.js";
import { requireSessionAndCsrf } from "../middleware/require-auth.js";
import type { AppEnv } from "../app.js";

const patchBody = z
  .object({
    tags: z
      .array(z.enum(PROFILE_TAGS))
      .min(1)
      .max(MAX_TAGS)
      .refine((tags) => new Set(tags).size === tags.length),
  })
  .strict();

export function createMeRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const { db, config, now } = c.var.deps;

    const sessionId = readSessionCookie(c);
    if (sessionId === undefined) return c.json({ profile: null });

    const session = await readSession(db, {
      secret: config.SESSION_SECRET,
      sessionId,
      now: now(),
    });
    if (session === null) return c.json({ profile: null });

    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.xUserId, session.xUserId))
      .limit(1);

    const profile = rows[0];
    if (profile === undefined) return c.json({ profile: null });

    return c.json({
      // The numeric X id is the identity. It is public, it is on every X profile page.
      profile: boardProfile(profile),
      session: { expiresAt: session.expiresAt.toISOString() },
    });
  });

  routes.patch("/", async (c) => {
    const { db, now } = c.var.deps;

    const auth = await requireSessionAndCsrf(c);
    if (auth.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
    if (auth.kind === "csrf_failed") return c.json({ error: "csrf_failed" }, 403);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = patchBody.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const at = now();
    const { tags } = parsed.data;
    const rows = await db
      .update(profiles)
      .set({ tags, tagSetAt: at, kind: kindFromTags(tags), updatedAt: at })
      .where(
        and(
          eq(profiles.xUserId, auth.session.xUserId),
          or(
            isNull(profiles.tagSetAt),
            lte(profiles.tagSetAt, new Date(at.getTime() - TAG_LOCK_MS)),
          ),
        ),
      )
      .returning();
    const profile = rows[0];
    if (profile === undefined) {
      // Nothing changed: either no such profile, or the lock. One read tells which.
      const current = await db
        .select({ tagSetAt: profiles.tagSetAt })
        .from(profiles)
        .where(eq(profiles.xUserId, auth.session.xUserId))
        .limit(1);
      const until = tagLockedUntil(current[0]?.tagSetAt);
      if (until === null) return c.json({ error: "unauthorized" }, 401);
      return c.json({ error: "tag_locked", until: until.toISOString() }, 409);
    }

    return c.json({ profile: boardProfile(profile) });
  });

  return routes;
}
