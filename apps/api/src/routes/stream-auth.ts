/**
 * Streamer connect, Kick and Twitch "Kick and Twitch
 * connect".
 *
 * A signed in chad links a Kick or Twitch account only to prove they own it. The flow is the X
 * login's, with one more binding: the state row keeps the X id of the session that started it.
 *
 * 1. `GET /api/auth/{kick,twitch}/start`
 *    - needs a live session, else back to `/?connect=signin`; a platform that is off is
 *      `404 connect_off`
 *    - a state, a pre-session cookie, the PKCE verifier (sent to Kick only), the provider and the
 *      session's X id in one row; then off to the platform
 *
 * 2. `GET /api/auth/{kick,twitch}/callback`
 *    - the row is deleted before anything else; it must exist, be fresh, match the pre-session
 *      cookie, be for this provider, and carry the X id of the session still here
 *    - exchange, read the own account, revoke every token; check the channel name; save
 *    - always back to the chad's own profile with `connect=<result>&platform=<platform>`;
 *      the result is `ok`, `cancelled`, `taken`, `expired` or `failed`; with no session,
 *      `/?connect=signin`
 *
 * Nothing here logs a token, a code, or a url with either.
 */
import { and, eq, ne } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  clearOauthCookie,
  readOauthCookie,
  readSessionCookie,
  setOauthCookie,
} from "../auth/cookies.js";
import { codeChallengeFor, createCodeVerifier, randomToken, safeEqual } from "../auth/pkce.js";
import { hashToken, readSession } from "../auth/session.js";
import {
  CHANNEL_PATTERN,
  type StreamAccount,
  type StreamPlatform,
  type StreamTokens,
} from "../auth/stream-client.js";
import { streamClientFor } from "../auth/stream-links.js";
import { OAUTH_STATE_TTL_SECONDS } from "../config.js";
import { oauthStates, profiles, streamLinks } from "../db/schema.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type { AppEnv } from "../app.js";

type ConnectResult = "ok" | "cancelled" | "taken" | "expired" | "failed";

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(500).optional(),
  error: z.string().min(1).max(200).optional(),
});

/** The signed in X id and handle, or `null`. */
async function signedIn(c: Context<AppEnv>): Promise<{ xUserId: string; handle: string } | null> {
  const sessionId = readSessionCookie(c);
  if (sessionId === undefined) return null;
  const { db, config, now } = c.var.deps;
  const session = await readSession(db, {
    secret: config.SESSION_SECRET,
    sessionId,
    now: now(),
  });
  if (session === null) return null;
  const rows = await db
    .select({ handle: profiles.handle })
    .from(profiles)
    .where(eq(profiles.xUserId, session.xUserId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : { xUserId: session.xUserId, handle: row.handle };
}

function toSignin(c: Context<AppEnv>): Response {
  return c.redirect(new URL("/?connect=signin", c.var.deps.config.APP_URL).toString(), 302);
}

function toProfile(
  c: Context<AppEnv>,
  handle: string,
  platform: StreamPlatform,
  result: ConnectResult,
): Response {
  const url = new URL(`/u/${encodeURIComponent(handle)}`, c.var.deps.config.APP_URL);
  url.searchParams.set("connect", result);
  // So the profile can name the platform in its line.
  url.searchParams.set("platform", platform);
  return c.redirect(url.toString(), 302);
}

/**
 * Save the link, or `taken` when this platform account belongs to another X id. A second X id
 * stays refused until the first one unlinks. The same X id linking again, or
 * linking another account on the same platform, replaces its own row.
 */
async function saveLink(
  c: Context<AppEnv>,
  xUserId: string,
  platform: StreamPlatform,
  account: StreamAccount,
): Promise<"ok" | "taken"> {
  const { db, now } = c.var.deps;
  const other = await db
    .select({ xUserId: streamLinks.xUserId })
    .from(streamLinks)
    .where(
      and(
        eq(streamLinks.platform, platform),
        eq(streamLinks.platformUserId, account.platformUserId),
        ne(streamLinks.xUserId, xUserId),
      ),
    )
    .limit(1);
  if (other.length > 0) return "taken";
  try {
    await db
      .insert(streamLinks)
      .values({
        xUserId,
        platform,
        platformUserId: account.platformUserId,
        channel: account.channel,
        linkedAt: now(),
      })
      .onConflictDoUpdate({
        target: [streamLinks.xUserId, streamLinks.platform],
        set: {
          platformUserId: account.platformUserId,
          channel: account.channel,
          linkedAt: now(),
        },
      });
  } catch {
    // The unique index on (platform, platform_user_id): another X id won a race to it.
    return "taken";
  }
  return "ok";
}

function routesFor(platform: StreamPlatform): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use("/start", rateLimit({ limit: 10, windowSeconds: 60 }));
  routes.use("/callback", rateLimit({ limit: 20, windowSeconds: 60 }));

  routes.get("/start", async (c) => {
    const { db, config, now } = c.var.deps;
    const client = streamClientFor(c.var.deps, platform);
    if (client === null) return c.json({ error: "connect_off" }, 404);

    const who = await signedIn(c);
    if (who === null) return toSignin(c);

    const codeVerifier = createCodeVerifier();
    const state = randomToken(32);
    const preSessionId = randomToken(32);
    const at = now();
    await db.insert(oauthStates).values({
      stateHash: hashToken(config.SESSION_SECRET, state),
      codeVerifier,
      preSessionHash: hashToken(config.SESSION_SECRET, preSessionId),
      nextPath: null,
      provider: platform,
      xUserId: who.xUserId,
      createdAt: at,
      expiresAt: new Date(at.getTime() + OAUTH_STATE_TTL_SECONDS * 1000),
    });
    setOauthCookie(c, preSessionId, OAUTH_STATE_TTL_SECONDS);

    // Never logged: this url carries the state and the challenge.
    return c.redirect(
      client.authorizeUrl({ state, codeChallenge: codeChallengeFor(codeVerifier) }),
      302,
    );
  });

  routes.get("/callback", async (c) => {
    const { db, config, now } = c.var.deps;
    const client = streamClientFor(c.var.deps, platform);
    if (client === null) return c.json({ error: "connect_off" }, 404);

    const who = await signedIn(c);
    if (who === null) {
      clearOauthCookie(c);
      return toSignin(c);
    }

    const parsed = callbackQuery.safeParse(c.req.query());
    const query = parsed.success ? parsed.data : {};
    const preSessionId = readOauthCookie(c);
    clearOauthCookie(c);

    // Used up first, whatever happens next: a replayed callback finds nothing.
    const stateRow =
      query.state === undefined
        ? undefined
        : (
            await db
              .delete(oauthStates)
              .where(eq(oauthStates.stateHash, hashToken(config.SESSION_SECRET, query.state)))
              .returning()
          )[0];

    // The person pressed cancel, or the platform refused. Not a failure of ours.
    if (query.error !== undefined) return toProfile(c, who.handle, platform, "cancelled");

    if (
      query.code === undefined ||
      stateRow === undefined ||
      preSessionId === undefined ||
      stateRow.expiresAt.getTime() <= now().getTime() ||
      !safeEqual(stateRow.preSessionHash, hashToken(config.SESSION_SECRET, preSessionId)) ||
      stateRow.provider !== platform ||
      stateRow.xUserId !== who.xUserId
    ) {
      return toProfile(c, who.handle, platform, "expired");
    }

    let account: StreamAccount;
    let tokens: StreamTokens | undefined;
    try {
      tokens = await client.exchangeCode({
        code: query.code,
        codeVerifier: stateRow.codeVerifier,
      });
      account = await client.readAccount(tokens.accessToken);
    } catch {
      // Never echo the error: it can carry the code or the token.
      return toProfile(c, who.handle, platform, "failed");
    } finally {
      // The tokens have done their one job. None is kept.
      if (tokens !== undefined) await client.revoke(tokens);
    }

    if (!CHANNEL_PATTERN[platform].test(account.channel)) {
      return toProfile(c, who.handle, platform, "failed");
    }

    return toProfile(c, who.handle, platform, await saveLink(c, who.xUserId, platform, account));
  });

  return routes;
}

/** Mounted at `/api/auth`, next to the X login. */
export function createStreamAuthRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.route("/kick", routesFor("kick"));
  routes.route("/twitch", routesFor("twitch"));
  return routes;
}
