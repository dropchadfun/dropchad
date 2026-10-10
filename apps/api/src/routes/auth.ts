/**
 * Sign in with X. Authorization code flow with PKCE, backend for frontend.
 *
 * The browser never sees an X token. It gets one opaque cookie, and every call to X happens here.
 * is not involved: this is off chain only.
 *
 * The flow, and what each step defends against:
 *
 * 1. `GET /api/auth/x/start`
 *    - makes a `code_verifier`, a `code_challenge` (S256) and a `state`
 *    - makes a **pre-session** id, sets it in a ten minute `dc_oauth` cookie, and stores its hash
 *      next to the state row. This binds the login to one browser, so a `state` copied out of a
 *      redirect URL is useless anywhere else.
 *    - redirects to X
 *
 * 2. `GET /api/auth/x/callback`
 *    - the `state` row must exist, not be expired, and match the `dc_oauth` cookie
 *    - the row is **deleted before anything else happens**, so a replayed callback finds nothing
 *    - exchanges the code, reads `GET /2/users/me`, then **revokes the access token**. Nothing is
 *      stored: no access token, no refresh token, and `offline.access` was never requested
 *    - writes the profile, rotates the session, sets the cookies, redirects to `APP_URL`
 *
 * 3. `POST /api/auth/logout`
 *    - needs a session **and** a matching CSRF token, then deletes the row and clears the cookies
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  clearOauthCookie,
  clearSessionCookies,
  readCsrfCookie,
  readOauthCookie,
  readSessionCookie,
  setCsrfCookie,
  setOauthCookie,
  setSessionCookie,
} from "../auth/cookies.js";
import { codeChallengeFor, createCodeVerifier, randomToken, safeEqual } from "../auth/pkce.js";
import {
  CSRF_HEADER,
  createSession,
  csrfTokenMatches,
  deleteSession,
  hashToken,
} from "../auth/session.js";
import { OAUTH_STATE_TTL_SECONDS, SESSION_TTL_SECONDS } from "../config.js";
import { oauthStates } from "../db/schema.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type { AppEnv } from "../app.js";

/**
 * What X sends back. Either a `code` **or** an `error` — the user can also press cancel, and that
 * arrives as `error=access_denied`, which is not a failure of ours.
 */
/**
 * The login return path: an allowlist, never a pattern of
 * "anything relative". Exactly `/claim`, or `/claim?drop=` and one drop address in either
 * chain's shape. Everything else is `null`, the front page. No open redirect.
 */
const EVM_DROP = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_DROP = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function safeNextPath(raw: string | undefined): string | null {
  if (raw === "/claim") return raw;
  const prefix = "/claim?drop=";
  if (raw === undefined || !raw.startsWith(prefix)) return null;
  const drop = raw.slice(prefix.length);
  return EVM_DROP.test(drop) || SOLANA_DROP.test(drop) ? raw : null;
}

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(500).optional(),
  error: z.string().min(1).max(200).optional(),
});

export function createAuthRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Both entry points are rate limited per ip. `start` writes a row, `callback` is guessable
  // surface. The numbers are deliberately loose enough that a real person retrying a login never
  // notices them.
  routes.use("/x/start", rateLimit({ limit: 10, windowSeconds: 60 }));
  routes.use("/x/callback", rateLimit({ limit: 20, windowSeconds: 60 }));
  routes.use("/logout", rateLimit({ limit: 30, windowSeconds: 60 }));

  // -------------------------------------------------------------------------
  // 1. start
  // -------------------------------------------------------------------------
  routes.get("/x/start", async (c) => {
    const { db, config, xClient, now } = c.var.deps;

    const codeVerifier = createCodeVerifier();
    const state = randomToken(32);
    const preSessionId = randomToken(32);
    const at = now();

    await db.insert(oauthStates).values({
      stateHash: hashToken(config.SESSION_SECRET, state),
      codeVerifier,
      preSessionHash: hashToken(config.SESSION_SECRET, preSessionId),
      nextPath: safeNextPath(c.req.query("next")),
      createdAt: at,
      expiresAt: new Date(at.getTime() + OAUTH_STATE_TTL_SECONDS * 1000),
    });

    setOauthCookie(c, preSessionId, OAUTH_STATE_TTL_SECONDS);

    // Never logged: this URL carries the state and the challenge.
    return c.redirect(
      xClient.authorizeUrl({ state, codeChallenge: codeChallengeFor(codeVerifier) }),
      302,
    );
  });

  // -------------------------------------------------------------------------
  // 2. callback
  // -------------------------------------------------------------------------
  routes.get("/x/callback", async (c) => {
    const { db, config, xClient, now } = c.var.deps;

    const parsed = callbackQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "invalid_callback" }, 400);
    }
    const query = parsed.data;

    // The user pressed cancel, or X refused. Not our failure, and not an error page.
    if (query.error !== undefined) {
      clearOauthCookie(c);
      return c.redirect(new URL("/?login=cancelled", config.APP_URL).toString(), 302);
    }

    if (query.code === undefined || query.state === undefined) {
      return c.json({ error: "invalid_callback" }, 400);
    }

    const preSessionId = readOauthCookie(c);
    if (preSessionId === undefined) {
      // No pre-session cookie: a different browser, or the login sat for over ten minutes.
      return c.json({ error: "login_expired" }, 400);
    }

    const stateHash = hashToken(config.SESSION_SECRET, query.state);

    // Read and delete in one step. `returning` makes this single use even if two callbacks arrive
    // at the same moment: only one of them gets a row back.
    const consumed = await db
      .delete(oauthStates)
      .where(eq(oauthStates.stateHash, stateHash))
      .returning();

    const stateRow = consumed[0];
    if (stateRow === undefined) {
      return c.json({ error: "invalid_state" }, 400);
    }
    if (stateRow.expiresAt.getTime() <= now().getTime()) {
      clearOauthCookie(c);
      return c.json({ error: "login_expired" }, 400);
    }
    if (!safeEqual(stateRow.preSessionHash, hashToken(config.SESSION_SECRET, preSessionId))) {
      // The state is real but it belongs to another browser.
      clearOauthCookie(c);
      return c.json({ error: "invalid_state" }, 400);
    }

    let user;
    let accessToken: string | undefined;
    try {
      accessToken = await xClient.exchangeCode({
        code: query.code,
        codeVerifier: stateRow.codeVerifier,
      });
      user = await xClient.fetchMe(accessToken);
    } catch {
      // Never echo the error: it can contain the code or the token.
      clearOauthCookie(c);
      return c.json({ error: "x_auth_failed" }, 502);
    } finally {
      // The token has done its one job. No `offline.access` was requested, so there is nothing
      // else it could ever be used for.
      if (accessToken !== undefined) await xClient.revokeToken(accessToken);
    }

    const session = await createSession(db, {
      secret: config.SESSION_SECRET,
      user,
      ttlSeconds: SESSION_TTL_SECONDS,
      previousSessionId: readSessionCookie(c),
      now: now(),
    });

    clearOauthCookie(c);
    setSessionCookie(c, session.sessionId, SESSION_TTL_SECONDS);
    setCsrfCookie(c, session.csrfToken, SESSION_TTL_SECONDS);

    // `next` only from the state row, checked again on the way out.
    const next = safeNextPath(stateRow.nextPath ?? undefined);
    const landing = new URL(next ?? "/", config.APP_URL);
    landing.searchParams.set("login", "ok");
    return c.redirect(landing.toString(), 302);
  });

  // -------------------------------------------------------------------------
  // 3. logout
  // -------------------------------------------------------------------------
  routes.post("/logout", async (c) => {
    const { db, config } = c.var.deps;

    const sessionId = readSessionCookie(c);
    if (sessionId === undefined) {
      clearSessionCookies(c);
      return c.json({ ok: true });
    }

    // Double submit: the header must match the cookie, and the cookie must match what the session
    // row stores. The header check alone would let any page that can read the cookie replay it.
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
      return c.json({ error: "csrf_failed" }, 403);
    }

    await deleteSession(db, { secret: config.SESSION_SECRET, sessionId });
    clearSessionCookies(c);
    return c.json({ ok: true });
  });

  return routes;
}
