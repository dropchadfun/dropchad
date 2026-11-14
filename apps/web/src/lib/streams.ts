/**
 * Streamer connect on the profile. The link to a channel is built here, from a fixed host and a name
 * checked against the same pattern the api saves with; a name that fails gets no link.
 */
import type { ProfileStream, StreamPlatform } from "@/lib/api";

export const STREAM_PLATFORMS: readonly StreamPlatform[] = ["kick", "twitch"];

const HOST: Record<StreamPlatform, string> = {
  kick: "https://kick.com/",
  twitch: "https://www.twitch.tv/",
};

/** The api's channel name check: the Kick `slug`, the Twitch `login`. */
const CHANNEL_PATTERN: Record<StreamPlatform, RegExp> = {
  kick: /^[A-Za-z0-9_-]{1,25}$/,
  twitch: /^[a-z0-9_]{1,25}$/,
};

/** The logo files, byte for byte. */
export const STREAM_LOGO: Record<StreamPlatform, string> = {
  kick: "/social/kick-logo.png",
  twitch: "/social/twitch-logo.png",
};

/**
 * The box each logo is drawn in, so the X, Kick and Twitch icons look the same height:
 * the Kick K fills its 15px box (16px looked a little big); the Twitch
 * glyph fills 70% of its file (538 of 768 px, measured), so 25px draws about 17.5px.
 */
export const STREAM_BOX_PX: Record<StreamPlatform, number> = { kick: 15, twitch: 25 };

/**
 * The grey line under the card's rows. Not "we read nothing else": Kick's own screen says it
 * reads the email.
 */
export const STREAMS_NOTE = "only used to show your channel link.";

function isPlatform(value: string): value is StreamPlatform {
  return value === "kick" || value === "twitch";
}

/** `https://kick.com/<slug>` or `https://www.twitch.tv/<login>`, or `null` for a bad name. */
export function streamUrl(stream: ProfileStream): string | null {
  if (!isPlatform(stream.platform)) return null;
  if (!CHANNEL_PATTERN[stream.platform].test(stream.channel)) return null;
  return `${HOST[stream.platform]}${stream.channel}`;
}

/** The api route that starts a connect, a full page visit. */
export function connectStartUrl(platform: StreamPlatform): string {
  return `/api/auth/${platform}/start`;
}

/**
 * The line at the top of the card after the return, from `connect=`, and its words.
 * `ok` has no line, the row's `connected` pill says it; `signin`
 * lands on `/`, which shows nothing new; anything unknown shows nothing.
 */
export function connectLine(result: string, platform: StreamPlatform): string | null {
  switch (result) {
    case "cancelled":
      return "nothing changed.";
    case "taken":
      return `this ${platform} account is linked to another X account. unlink it there first.`;
    case "expired":
      return "that took too long. try again.";
    case "failed":
      return `${platform} did not answer right. try again.`;
    default:
      return null;
  }
}

/** Kick first, links with a bad name left out. */
export function shownStreams(streams: readonly ProfileStream[] | undefined): ProfileStream[] {
  return STREAM_PLATFORMS.flatMap((platform) =>
    (streams ?? []).filter((s) => s.platform === platform && streamUrl(s) !== null),
  );
}
