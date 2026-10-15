/**
 * The check every write route runs first: a live session, and a CSRF token that matches it.
 *
 * It is a function rather than Hono middleware so the route keeps deciding what a failure looks
 * like, and so a test can call it directly. The rules are the ones `POST /api/auth/logout`
 * already follows
 *
 * - the session cookie must name a live session row
 * - the `x-dropchad-csrf` header must equal the `dc_csrf` cookie (double submit)
 * - and that token must also match the hash stored on the session row
 *
 * The last one is not decoration. Header equals cookie on its own would accept a valid pair
 * borrowed from another session; binding it to the row is what closes that.
 */
import type { Context } from "hono";

import type { AppEnv } from "../app.js";
import { readCsrfCookie, readSessionCookie } from "../auth/cookies.js";
import { CSRF_HEADER, csrfTokenMatches, readSession, type SessionRecord } from "../auth/session.js";

export type AuthOutcome =
  | { readonly kind: "ok"; readonly session: SessionRecord }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "csrf_failed" };

/** Constant time compare of two same length strings. Length itself is not a secret here. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireSessionAndCsrf(c: Context<AppEnv>): Promise<AuthOutcome> {
  const { db, config, now } = c.var.deps;

  const sessionId = readSessionCookie(c);
  if (sessionId === undefined) return { kind: "unauthorized" };

  const session = await readSession(db, {
    secret: config.SESSION_SECRET,
    sessionId,
    now: now(),
  });
  if (session === null) return { kind: "unauthorized" };

  const headerToken = c.req.header(CSRF_HEADER);
  const cookieToken = readCsrfCookie(c);
  if (
    headerToken === undefined ||
    cookieToken === undefined ||
    !safeEqual(headerToken, cookieToken) ||
    !(await csrfTokenMatches(db, {
      secret: config.SESSION_SECRET,
      sessionId,
      token: headerToken,
    }))
  ) {
    return { kind: "csrf_failed" };
  }

  return { kind: "ok", session };
}
