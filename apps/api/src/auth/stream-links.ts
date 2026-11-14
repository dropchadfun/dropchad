/**
 * Streamer connect, the shared parts: which platforms are on, their clients,
 * and the `streams` of the public profile.
 */
import { inArray } from "drizzle-orm";

import type { AppDeps } from "../app.js";
import type { ProfileStream } from "../boards/compute.js";
import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import { streamLinks } from "../db/schema.js";
import {
  STREAM_PLATFORMS,
  createKickClient,
  createTwitchClient,
  type StreamClient,
  type StreamPlatform,
} from "./stream-client.js";

function filled(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/** A platform is on when both of its env values are set. Empty is off. */
export function streamConnectOn(config: Config): Record<StreamPlatform, boolean> {
  return {
    kick: filled(config.KICK_CLIENT_ID) && filled(config.KICK_CLIENT_SECRET),
    twitch: filled(config.TWITCH_CLIENT_ID) && filled(config.TWITCH_CLIENT_SECRET),
  };
}

export function streamCallbackUrl(config: Config, platform: StreamPlatform): string {
  return new URL(`/api/auth/${platform}/callback`, config.API_URL).toString();
}

/** The client of a platform that is on, or `null`. */
export function streamClientFor(deps: AppDeps, platform: StreamPlatform): StreamClient | null {
  const { config } = deps;
  const fetchImpl = deps.streamFetch;
  if (platform === "kick") {
    if (!filled(config.KICK_CLIENT_ID) || !filled(config.KICK_CLIENT_SECRET)) return null;
    return createKickClient({
      clientId: config.KICK_CLIENT_ID,
      clientSecret: config.KICK_CLIENT_SECRET,
      redirectUri: streamCallbackUrl(config, "kick"),
      fetchImpl,
    });
  }
  if (!filled(config.TWITCH_CLIENT_ID) || !filled(config.TWITCH_CLIENT_SECRET)) return null;
  return createTwitchClient({
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
    redirectUri: streamCallbackUrl(config, "twitch"),
    fetchImpl,
  });
}

/**
 * The `streams` of each X id, Kick first; a platform that is off is left out. An X id with no
 * link is absent from the map: read it as `[]`.
 */
export async function loadStreams(
  db: Database,
  config: Config,
  xUserIds: readonly string[],
): Promise<Map<string, ProfileStream[]>> {
  const out = new Map<string, ProfileStream[]>();
  const ids = [...new Set(xUserIds)];
  if (ids.length === 0) return out;
  const on = streamConnectOn(config);
  const rows = await db
    .select({
      xUserId: streamLinks.xUserId,
      platform: streamLinks.platform,
      channel: streamLinks.channel,
    })
    .from(streamLinks)
    .where(inArray(streamLinks.xUserId, ids));
  for (const platform of STREAM_PLATFORMS) {
    if (!on[platform]) continue;
    for (const row of rows) {
      if (row.platform !== platform) continue;
      const list = out.get(row.xUserId) ?? [];
      list.push({ platform, channel: row.channel });
      out.set(row.xUserId, list);
    }
  }
  return out;
}
