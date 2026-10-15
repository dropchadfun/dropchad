/**
 * A stubbed Kick and Twitch, for streamer connect.
 *
 * Like the X stub in `harness.ts`, this is a **`fetch` implementation**, so the real clients run
 * and the tests check the form bodies, the headers and the parsing. The shapes are the ones read
 * on docs.kick.com and dev.twitch.tv.
 */
import type { XCall } from "./harness.js";

export interface KickUser {
  readonly user_id: number;
  readonly name: string;
}

export interface KickChannel {
  readonly broadcaster_user_id: number;
  readonly slug: string;
}

export interface TwitchUser {
  readonly id: string;
  readonly login: string;
  readonly display_name: string;
}

export interface StreamStubOptions {
  kickUser?: KickUser;
  kickChannel?: KickChannel;
  twitchUser?: TwitchUser;
  /** Force a token endpoint to fail with this status. */
  kickTokenStatus?: number;
  twitchTokenStatus?: number;
}

export interface StreamStub {
  readonly calls: XCall[];
  readonly fetchImpl: typeof fetch;
}

export const KICK_ACCESS = "kick-access-token-1";
export const KICK_REFRESH = "kick-refresh-token-1";
export const TWITCH_ACCESS = "twitch-access-token-1";
export const TWITCH_REFRESH = "twitch-refresh-token-1";

export function createStreamStub(options: StreamStubOptions = {}): StreamStub {
  const calls: XCall[] = [];
  const kickUser = options.kickUser ?? { user_id: 4242, name: "Chad_Streams" };
  const kickChannel = options.kickChannel ?? { broadcaster_user_id: 4242, slug: "chad-streams" };
  const twitchUser = options.twitchUser ?? {
    id: "141981764",
    login: "chadstreams",
    display_name: "ChadStreams",
  };

  const json = (status: number, payload: unknown): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  const fetchImpl: typeof fetch = (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) {
      headers[key.toLowerCase()] = value;
    }
    const body =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string"
          ? init.body
          : "";
    calls.push({ url, method, headers, body });

    if (url.startsWith("https://id.kick.com/oauth/token")) {
      return options.kickTokenStatus !== undefined
        ? json(options.kickTokenStatus, { error: "invalid_grant" })
        : json(200, {
            access_token: KICK_ACCESS,
            token_type: "Bearer",
            refresh_token: KICK_REFRESH,
            expires_in: 7200,
            scope: "user:read channel:read",
          });
    }
    if (url.startsWith("https://id.kick.com/oauth/revoke")) return json(200, {});
    if (url.startsWith("https://api.kick.com/public/v1/users")) {
      return json(200, { data: [{ ...kickUser, email: "streamer@example.com" }], message: "OK" });
    }
    if (url.startsWith("https://api.kick.com/public/v1/channels")) {
      return json(200, { data: [kickChannel], message: "OK" });
    }

    if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
      return options.twitchTokenStatus !== undefined
        ? json(options.twitchTokenStatus, { status: 400, message: "Invalid authorization code" })
        : json(200, {
            access_token: TWITCH_ACCESS,
            refresh_token: TWITCH_REFRESH,
            expires_in: 14400,
            scope: [],
            token_type: "bearer",
          });
    }
    if (url.startsWith("https://id.twitch.tv/oauth2/revoke")) return json(200, {});
    if (url.startsWith("https://api.twitch.tv/helix/users")) {
      return json(200, { data: [twitchUser] });
    }

    throw new Error(`unexpected fetch to ${url}`);
  };

  return { calls, fetchImpl };
}
