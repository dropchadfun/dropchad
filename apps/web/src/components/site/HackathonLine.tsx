import { HackathonClose, HackathonTyped } from "@/components/site/HackathonParts";
import { InlineScript } from "@/components/site/InlineScript";
import { HACKATHON_TEXT, HACKATHON_URL, hackathonLineScript } from "@/lib/hackathon";

/**
 * The hackathon line: above the top bar on every page,
 * not sticky. Mint mono on the page dark, like a line of code. The server sends the whole text;
 * the script right after the bar sets `data-state` before paint (`closed`, `still` or `type`),
 * and `HackathonTyped` types it once when it says `type`. On a narrow phone it wraps to two lines.
 * The whole sentence links to our project page in a new tab; the `×` stays
 * its own button outside the link. Nothing else from the organiser (logo, images, style).
 */
export function HackathonLine() {
  return (
    <>
      <div
        className="hackathon-line min-h-7 border-b border-chad-border bg-chad-bg"
        suppressHydrationWarning
      >
        <div className="mx-auto flex min-h-7 w-full max-w-(--container-content) items-center gap-1.5 px-4 py-1 md:gap-2">
          {/* As wide as the ×, so the centered text sits in the true middle of the line. */}
          <span aria-hidden="true" className="size-4 shrink-0 md:size-5" />
          <a
            href={HACKATHON_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hackathon-text min-w-0 flex-1 text-center font-mono text-chad-accent underline-offset-2 hover:underline focus-visible:underline"
          >
            <span className="sr-only">{HACKATHON_TEXT}</span>
            <span aria-hidden="true">&gt; </span>
            <HackathonTyped />
          </a>
          <HackathonClose />
        </div>
      </div>
      <InlineScript html={hackathonLineScript()} />
    </>
  );
}
