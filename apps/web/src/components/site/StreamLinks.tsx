import type { ProfileStream } from "@/lib/api";
import { shownStreams, STREAM_BOX_PX, STREAM_LOGO, streamUrl } from "@/lib/streams";

/**
 * The stream links: a linked Kick or Twitch channel as the
 * platform's logo file, right after the X link, Kick before Twitch. Each in a 44px target, a new
 * tab. Their own colours always: no grey, no hover colour. On board rows, the drop page sender
 * line and the profile only, never on drop rows or the share card.
 */
export function StreamLinks({ streams }: { streams: readonly ProfileStream[] | undefined }) {
  const shown = shownStreams(streams);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((stream) => {
        const box = STREAM_BOX_PX[stream.platform];
        return (
          <a
            key={stream.platform}
            href={streamUrl(stream) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${stream.platform} channel`}
            className="-m-3.5 inline-flex size-11 shrink-0 items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local file, fixed size */}
            <img src={STREAM_LOGO[stream.platform]} alt="" width={box} height={box} />
          </a>
        );
      })}
    </>
  );
}
