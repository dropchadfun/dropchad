/**
 * The Kick and Twitch OAuth clients, streamer connect.
 *
 * One job: prove that the person holds the account. Exchange the code, read the own account once,
 * revoke. Nothing here keeps a token, and nothing here logs a token, a code, or a url with either.
 *
 * Endpoints, read on the official docs
 * - Kick (docs.kick.com): authorize `https://id.kick.com/oauth/authorize`, token
 *   `https://id.kick.com/oauth/token` (form body with `client_id`, `client_secret`, `code`,
 *   `code_verifier`, `redirect_uri`, `grant_type`), revoke `https://id.kick.com/oauth/revoke`
 *   (`token` and `token_hint_type` in the query), the own user `https://api.kick.com/public/v1/users`
 *   (`user:read`), the own channel `https://api.kick.com/public/v1/channels` (`channel:read`).
 *   PKCE S256 is required. The token answer carries a `refresh_token` though none is asked for;
 *   both are revoked. The user answer carries the email; it is never read.
 * - Twitch (dev.twitch.tv): authorize `https://id.twitch.tv/oauth2/authorize`, token
 *   `https://id.twitch.tv/oauth2/token` (form body with `client_id`, `client_secret`, `code`,
 *   `grant_type`, `redirect_uri`), revoke `POST https://id.twitch.tv/oauth2/revoke` (`client_id`,
 *   `token`), the own user `https://api.twitch.tv/helix/users` with `Client-Id`, no scope. No PKCE:
 *   Twitch's docs have none.
 */

export type StreamPlatform = "kick" | "twitch";

export const STREAM_PLATFORMS: readonly StreamPlatform[] = ["kick", "twitch"];

/** The account behind the token: the identity and the name the link is built from. */
export interface StreamAccount {
  readonly platformUserId: string;
  readonly channel: string;
}

export interface StreamTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
}

export interface StreamClient {
  readonly platform: StreamPlatform;
  /** False on Twitch: no `code_challenge` is sent and no `code_verifier`. */
  readonly pkce: boolean;
  authorizeUrl(args: { state: string; codeChallenge: string }): string;
  exchangeCode(args: { code: string; codeVerifier: string }): Promise<StreamTokens>;
  readAccount(accessToken: string): Promise<StreamAccount>;
  /** Best effort and silent: a failure must never turn a proven link into an error. */
  revoke(tokens: StreamTokens): Promise<void>;
}

export interface StreamClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Exactly the callback registered with the platform. */
  readonly redirectUri: string;
  readonly fetchImpl?: typeof fetch | undefined;
}

export class StreamAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamAuthError";
  }
}

/** The channel name check of. A name that fails is never saved and never linked. */
export const CHANNEL_PATTERN: Record<StreamPlatform, RegExp> = {
  twitch: /^[a-z0-9_]{1,25}$/,
  kick: /^[A-Za-z0-9_-]{1,25}$/,
};

export const KICK_SCOPES = ["user:read", "channel:read"] as const;

const FORM = "application/x-www-form-urlencoded";

async function tokensFrom(response: Response): Promise<StreamTokens> {
  if (!response.ok) {
    // The body can echo the code back, so it is never part of the error.
    throw new StreamAuthError("token exchange failed");
  }
  const payload: unknown = await response.json();
  const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const accessToken = record["access_token"];
  const refreshToken = record["refresh_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new StreamAuthError("token answer had no access_token");
  }
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null,
  };
}

/** The first object of a `{ data: [...] }` answer, or an error. */
async function firstOf(response: Response, what: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new StreamAuthError(`${what} failed`);
  const payload: unknown = await response.json();
  const data =
    typeof payload === "object" && payload !== null && "data" in payload ? payload.data : undefined;
  const first: unknown = Array.isArray(data) ? data[0] : undefined;
  if (typeof first !== "object" || first === null) {
    throw new StreamAuthError(`${what} returned no data`);
  }
  return first as Record<string, unknown>;
}

/** A positive whole number id, as Kick sends it (a JSON integer), turned into text. */
function kickId(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : null;
}

export function createKickClient(options: StreamClientOptions): StreamClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    platform: "kick",
    pkce: true,

    authorizeUrl({ state, codeChallenge }) {
      const url = new URL("https://id.kick.com/oauth/authorize");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", options.redirectUri);
      url.searchParams.set("scope", KICK_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier }) {
      const response = await doFetch("https://id.kick.com/oauth/token", {
        method: "POST",
        headers: { "content-type": FORM, accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: options.redirectUri,
        }),
      });
      return await tokensFrom(response);
    },

    async readAccount(accessToken) {
      const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
      // No ids: both answer for the account behind the token.
      const user = await firstOf(
        await doFetch("https://api.kick.com/public/v1/users", { headers }),
        "kick users",
      );
      const channel = await firstOf(
        await doFetch("https://api.kick.com/public/v1/channels", { headers }),
        "kick channels",
      );
      // Only the id is read from the user answer; it also carries the email, never touched.
      const userId = kickId(user["user_id"]);
      if (userId === null) throw new StreamAuthError("kick user had no id");
      if (kickId(channel["broadcaster_user_id"]) !== userId) {
        throw new StreamAuthError("kick channel is not this user's");
      }
      const slug = channel["slug"];
      if (typeof slug !== "string") throw new StreamAuthError("kick channel had no slug");
      return { platformUserId: userId, channel: slug };
    },

    async revoke(tokens) {
      const pairs: [string, string][] = [[tokens.accessToken, "access_token"]];
      if (tokens.refreshToken !== null) pairs.push([tokens.refreshToken, "refresh_token"]);
      for (const [token, hint] of pairs) {
        try {
          const url = new URL("https://id.kick.com/oauth/revoke");
          url.searchParams.set("token", token);
          url.searchParams.set("token_hint_type", hint);
          await doFetch(url, { method: "POST", headers: { "content-type": FORM } });
        } catch {
          // Swallowed on purpose. Nothing is logged: the message could carry the token.
        }
      }
    },
  };
}

export function createTwitchClient(options: StreamClientOptions): StreamClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    platform: "twitch",
    pkce: false,

    authorizeUrl({ state }) {
      const url = new URL("https://id.twitch.tv/oauth2/authorize");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", options.redirectUri);
      // No scope: reading the own user needs none.
      url.searchParams.set("scope", "");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode({ code }) {
      const response = await doFetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "content-type": FORM, accept: "application/json" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: options.redirectUri,
        }),
      });
      return await tokensFrom(response);
    },

    async readAccount(accessToken) {
      const user = await firstOf(
        await doFetch("https://api.twitch.tv/helix/users", {
          headers: {
            authorization: `Bearer ${accessToken}`,
            "client-id": options.clientId,
            accept: "application/json",
          },
        }),
        "twitch users",
      );
      const id = user["id"];
      const login = user["login"];
      if (typeof id !== "string" || !/^\d+$/.test(id)) {
        throw new StreamAuthError("twitch user had no id");
      }
      if (typeof login !== "string") throw new StreamAuthError("twitch user had no login");
      return { platformUserId: id, channel: login };
    },

    async revoke(tokens) {
      // Twitch's revoke takes the access token; its docs name no refresh token revoke.
      try {
        await doFetch("https://id.twitch.tv/oauth2/revoke", {
          method: "POST",
          headers: { "content-type": FORM },
          body: new URLSearchParams({ client_id: options.clientId, token: tokens.accessToken }),
        });
      } catch {
        // Swallowed on purpose. Nothing is logged: the message could carry the token.
      }
    },
  };
}
