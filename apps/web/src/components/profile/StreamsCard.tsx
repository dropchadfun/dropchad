"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { useSession } from "@/components/site/SessionProvider";
import { unlinkStream, type ProfileStream, type StreamPlatform } from "@/lib/api";
import { readCsrfToken } from "@/lib/csrf";
import {
  connectLine,
  connectStartUrl,
  STREAM_BOX_PX,
  STREAM_LOGO,
  STREAM_PLATFORMS,
  STREAMS_NOTE,
} from "@/lib/streams";

/**
 * The `streams` card.
 * Only on your own profile, under the tag picker: one row per platform that is on, `connect
 * kick` / `connect twitch` (a full page visit to the api start route) or the channel name, a
 * `connected` pill and a one tap `unlink`, no confirm. After the return, an
 * error line at the top (`ok` has none), then the url is cleaned. Someone else's profile shows
 * only the icons after the X link.
 */
export function StreamsCard({ xUserId }: { xUserId: string }) {
  const { profile, streamConnect, refresh } = useSession();
  const [result, setResult] = useState<{ line: string } | null>(null);
  const [busy, setBusy] = useState<StreamPlatform | null>(null);

  useEffect(() => {
    // `connect=<result>&platform=<kick|twitch>` from the api callback, read once, then cleaned
    // from the url.
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("connect");
    const platform = url.searchParams.get("platform");
    if (raw === null) return;
    url.searchParams.delete("connect");
    url.searchParams.delete("platform");
    window.history.replaceState(null, "", url.toString());
    if (platform !== "kick" && platform !== "twitch") return;
    const line = connectLine(raw, platform);
    if (line !== null) queueMicrotask(() => setResult({ line }));
  }, []);

  if (!profile || profile.xUserId !== xUserId) return null;

  async function unlink(platform: StreamPlatform) {
    const token = readCsrfToken();
    if (token === null) return;
    setBusy(platform);
    setResult(null);
    try {
      await unlinkStream(platform, token);
      await refresh();
    } catch {
      setResult({ line: "that did not work. try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <StreamsCardView
      streams={profile.streams ?? []}
      connect={streamConnect}
      result={result}
      busy={busy}
      onUnlink={(platform) => void unlink(platform)}
    />
  );
}

/** The mint of a state, not an action. */
const CONNECTED_PILL = { "--pill": "var(--chad-accent)" } as CSSProperties;

export function StreamsCardView({
  streams,
  connect,
  result,
  busy,
  onUnlink,
}: {
  streams: readonly ProfileStream[];
  connect: Readonly<Record<StreamPlatform, boolean>>;
  result: { line: string } | null;
  busy: StreamPlatform | null;
  onUnlink: (platform: StreamPlatform) => void;
}) {
  const platforms = STREAM_PLATFORMS.filter((platform) => connect[platform]);
  if (platforms.length === 0) return null;

  return (
    <section className="card mt-4 p-3 md:p-4">
      <h2 className="type-label">streams</h2>
      {result ? <p className="type-small mt-2 text-chad-text">{result.line}</p> : null}
      <ul className="mt-2 flex flex-col gap-2">
        {platforms.map((platform) => {
          const linked = streams.find((stream) => stream.platform === platform);
          const box = STREAM_BOX_PX[platform];
          return (
            <li key={platform} className="flex min-h-11 items-center gap-3">
              <span className="inline-flex size-7 shrink-0 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- local file, fixed size */}
                <img src={STREAM_LOGO[platform]} alt={platform} width={box} height={box} />
              </span>
              {linked ? (
                <>
                  <span className="type-body min-w-0 flex-1 truncate">{linked.channel}</span>
                  {/* The state, in the tag pill look, on the right before unlink so the pills
                      line up: no `ok` line on top. */}
                  <span className="pill pill-on type-small shrink-0 gap-1.5" style={CONNECTED_PILL}>
                    <span className="size-1.5 rounded-full bg-chad-accent" aria-hidden="true" />
                    connected
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onUnlink(platform)}
                    className="btn btn-secondary h-11 px-3"
                  >
                    unlink
                  </button>
                </>
              ) : (
                <a href={connectStartUrl(platform)} className="btn btn-secondary h-11 px-3">
                  connect {platform}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="type-small mt-2 text-chad-text-dim">{STREAMS_NOTE}</p>
    </section>
  );
}
