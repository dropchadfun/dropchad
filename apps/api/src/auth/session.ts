/**
 * Sessions and cookies.
 *
 * Shape, from
 * - the session id is **opaque**, 32 random bytes. It carries no data and means nothing on its own
 * - the cookie is `httpOnly`, `Secure`, `SameSite=Lax`, host scoped, path `/`
 * - only `HMAC-SHA256(SESSION_SECRET, id)` is stored, so a database dump is not a set of live
 *   sessions
 * - thirty day lifetime, absolute from login, and the id is **rotated** on login: a session id
 *   that existed before the login can never survive it
 * - the X access token is never stored, so it cannot leak from here
 *
 * `SameSite=Lax`, not `Strict`: the browser comes back from x.com on a top level GET, and `Strict`
 * drops the cookie on that return trip in some browsers.
 *
 * `Secure` is set even in dev. Browsers treat `http://localhost` as a secure context, so the
 * cookie still works there, and there is no "insecure in dev only" branch to get wrong later.
 */
import { createHmac } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { profiles, sessions } from "../db/schema.js";
import { randomToken } from "./pkce.js";
import type { XUser } from "./x-client.js";

export const SESSION_COOKIE = "dc_session";
export const OAUTH_COOKIE = "dc_oauth";
/** Readable by the frontend on purpose: it is the double submit half of the CSRF pair. */
export const CSRF_COOKIE = "dc_csrf";
export const CSRF_HEADER = "x-dropchad-csrf";

export interface SessionRecord {
  readonly id: string;
  readonly xUserId: string;
  readonly expiresAt: Date;
  /** When the X login behind this session happened. A login rotates the row, so this is it. */
  readonly loggedInAt: Date;
}

/** Keyed hash. The key gives `SESSION_SECRET` its one real job. */
export function hashToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export interface NewSession {
  /** Goes into the `dc_session` cookie. Never stored. */
  readonly sessionId: string;
  /** Goes into the `dc_csrf` cookie and into the `x-dropchad-csrf` header. Never stored. */
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

/**
 * Write the profile, then create a fresh session for it.
 *
 * `previousSessionId` is the id the browser arrived with, if any. It is deleted in the same
 * transaction, which is what "rotate on login" means: there is never a moment where the old id
 * and the new id both work.
 */
export async function createSession(
  db: Database,
  args: {
    secret: string;
    user: XUser;
    ttlSeconds: number;
    previousSessionId?: string | undefined;
    now?: Date;
  },
): Promise<NewSession> {
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + args.ttlSeconds * 1000);

  const sessionId = randomToken(32);
  const csrfToken = randomToken(32);

  await db.transaction(async (tx) => {
    // The handle, display name and avatar are refreshed on every login. The numeric id never
    // changes, so it is the conflict target.
    await tx
      .insert(profiles)
      .values({
        xUserId: args.user.id,
        handle: args.user.username,
        displayName: args.user.name,
        profileImageUrl: args.user.profileImageUrl,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: profiles.xUserId,
        set: {
          handle: args.user.username,
          displayName: args.user.name,
          profileImageUrl: args.user.profileImageUrl,
          updatedAt: now,
        },
      });

    if (args.previousSessionId !== undefined) {
      await tx
        .delete(sessions)
        .where(eq(sessions.id, hashToken(args.secret, args.previousSessionId)));
    }

    await tx.insert(sessions).values({
      id: hashToken(args.secret, sessionId),
      xUserId: args.user.id,
      csrfTokenHash: hashToken(args.secret, csrfToken),
      createdAt: now,
      expiresAt,
    });
  });

  return { sessionId, csrfToken, expiresAt };
}

/** The live session for a cookie value, or `null`. An expired row is deleted, not returned. */
export async function readSession(
  db: Database,
  args: { secret: string; sessionId: string; now?: Date },
): Promise<SessionRecord | null> {
  const now = args.now ?? new Date();
  const id = hashToken(args.secret, args.sessionId);

  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  return { id: row.id, xUserId: row.xUserId, expiresAt: row.expiresAt, loggedInAt: row.createdAt };
}

/** True when the token matches the session's stored CSRF hash. */
export async function csrfTokenMatches(
  db: Database,
  args: { secret: string; sessionId: string; token: string },
): Promise<boolean> {
  const rows = await db
    .select({ csrfTokenHash: sessions.csrfTokenHash })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, hashToken(args.secret, args.sessionId)),
        eq(sessions.csrfTokenHash, hashToken(args.secret, args.token)),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export async function deleteSession(
  db: Database,
  args: { secret: string; sessionId: string },
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(args.secret, args.sessionId)));
}

/** Housekeeping. Expired rows are not a security hole, they are just rubbish. */
export async function deleteExpiredSessions(db: Database, now = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
