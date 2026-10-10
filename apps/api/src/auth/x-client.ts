/**
 * The X OAuth 2 client. Two calls, plus a best effort revoke.
 *
 * Endpoints, all read on the official docs
 * - authorize   `https://x.com/i/oauth2/authorize`
 * - token       `https://api.x.com/2/oauth2/token`
 * - me          `https://api.x.com/2/users/me`
 * - revoke      `https://api.x.com/2/oauth2/revoke`
 *
 * Our X app is a **Web App**, so it is a confidential client: PKCE **and** the client secret. The
 * docs say a confidential client with a valid Authorization header does not send `client_id` in
 * the body, so the secret goes in an HTTP Basic header and nowhere else.
 *
 * Nothing in this file logs a token, a code, or a full URL that contains either.
 */
import { X_SCOPES } from "../config.js";

export interface XUser {
  /** The numeric X user id, as a string. This is the identity. */
  readonly id: string;
  /** `@handle` without the `@`. Display only, refreshed on every login. */
  readonly username: string;
  readonly name: string;
  readonly profileImageUrl: string | null;
}

export interface XClient {
  authorizeUrl(args: { state: string; codeChallenge: string }): string;
  exchangeCode(args: { code: string; codeVerifier: string }): Promise<string>;
  fetchMe(accessToken: string): Promise<XUser>;
  /** Best effort, and silent: a failure must never break a login that already succeeded. */
  revokeToken(accessToken: string): Promise<void>;
}

export interface XClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Must match the callback registered with X exactly. */
  readonly redirectUri: string;
  /** Injectable so tests can drive the real request building against a stub. */
  readonly fetchImpl?: typeof fetch;
  readonly authorizeEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly meEndpoint?: string;
  readonly revokeEndpoint?: string;
}

export class XAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "XAuthError";
  }
}

export function createXClient(options: XClientOptions): XClient {
  const doFetch = options.fetchImpl ?? fetch;
  const authorizeEndpoint = options.authorizeEndpoint ?? "https://x.com/i/oauth2/authorize";
  const tokenEndpoint = options.tokenEndpoint ?? "https://api.x.com/2/oauth2/token";
  const meEndpoint = options.meEndpoint ?? "https://api.x.com/2/users/me";
  const revokeEndpoint = options.revokeEndpoint ?? "https://api.x.com/2/oauth2/revoke";

  const basicAuth =
    "Basic " +
    Buffer.from(`${options.clientId}:${options.clientSecret}`, "utf8").toString("base64");

  return {
    authorizeUrl({ state, codeChallenge }) {
      const url = new URL(authorizeEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", options.redirectUri);
      url.searchParams.set("scope", X_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier }) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectUri,
        code_verifier: codeVerifier,
      });

      const response = await doFetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth,
          accept: "application/json",
        },
        body,
      });

      if (!response.ok) {
        // The body can echo the code back, so it is never included in the error.
        throw new XAuthError(`token exchange failed`, response.status);
      }

      const payload: unknown = await response.json();
      const accessToken =
        typeof payload === "object" && payload !== null && "access_token" in payload
          ? payload.access_token
          : undefined;

      if (typeof accessToken !== "string" || accessToken.length === 0) {
        throw new XAuthError("token response had no access_token");
      }
      return accessToken;
    },

    async fetchMe(accessToken) {
      // The token response does not carry the user id, so it is read here. `user.fields` is needed
      // for the avatar; id, name and username come back by default.
      const url = new URL(meEndpoint);
      url.searchParams.set("user.fields", "profile_image_url,username,name");

      const response = await doFetch(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });

      if (!response.ok) {
        throw new XAuthError("users/me failed", response.status);
      }

      const payload: unknown = await response.json();
      const data =
        typeof payload === "object" && payload !== null && "data" in payload
          ? payload.data
          : undefined;

      if (typeof data !== "object" || data === null) {
        throw new XAuthError("users/me returned no data object");
      }

      const record = data as Record<string, unknown>;
      const id = record["id"];
      const username = record["username"];
      const name = record["name"];
      const profileImageUrl = record["profile_image_url"];

      // The identity is the numeric id. Anything else is display.
      if (typeof id !== "string" || !/^\d+$/.test(id)) {
        throw new XAuthError("users/me returned no numeric id");
      }
      if (typeof username !== "string" || username.length === 0) {
        throw new XAuthError("users/me returned no username");
      }

      return {
        id,
        username,
        name: typeof name === "string" && name.length > 0 ? name : username,
        profileImageUrl: typeof profileImageUrl === "string" ? profileImageUrl : null,
      };
    },

    async revokeToken(accessToken) {
      // We asked for no `offline.access`, so there is no refresh token, and this access token has
      // already done its one job. Revoking is the difference between "we threw it away" and "it
      // is dead". Best effort: a failure must never break a successful login.
      try {
        await doFetch(revokeEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: basicAuth,
          },
          body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
        });
      } catch {
        // Swallowed on purpose. Nothing is logged: the message could carry the token.
      }
    },
  };
}
