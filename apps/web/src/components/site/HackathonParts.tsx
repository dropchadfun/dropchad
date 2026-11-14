"use client";

import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { HACKATHON_TEXT, closeHackathonLine, typedLength } from "@/lib/hackathon";

/**
 * The typed words. The server and the first client render show the whole text, so still,
 * reduced motion and no JS read it all. When the inline script said `type`, this starts the one
 * typing before paint (layout effect) and stops at the last letter: no loop, and the cursor goes.
 */
export function HackathonTyped() {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(HACKATHON_TEXT.length);
  const [typing, setTyping] = useState(false);

  useLayoutEffect(() => {
    const bar = ref.current?.closest<HTMLElement>(".hackathon-line");
    // `typing` too: in dev React runs this twice with a cleanup between, and the second run must
    // start the clock again, or the line stays empty.
    const state = bar?.dataset["state"];
    if (bar === null || bar === undefined || (state !== "type" && state !== "typing")) return;
    bar.dataset["state"] = "typing";
    setShown(0);
    setTyping(true);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const length = typedLength(now - start, HACKATHON_TEXT.length);
      setShown(length);
      if (length < HACKATHON_TEXT.length) {
        frame = requestAnimationFrame(tick);
      } else {
        setTyping(false);
        bar.dataset["state"] = "still";
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <span ref={ref} aria-hidden="true" className="hackathon-type">
        {HACKATHON_TEXT.slice(0, shown)}
      </span>
      {typing ? (
        <span aria-hidden="true" className="hackathon-caret">
          ▍
        </span>
      ) : null}
    </>
  );
}

/** `×`, small to look at, a 44px tap area. Closed is remembered in this browser. */
export function HackathonClose() {
  return (
    <button
      type="button"
      aria-label="close the hackathon line"
      onClick={(event) => {
        const bar = event.currentTarget.closest<HTMLElement>(".hackathon-line");
        if (bar !== null) closeHackathonLine(bar, window.localStorage);
      }}
      className="interactive relative -mr-1 flex size-4 shrink-0 md:size-5 items-center justify-center rounded text-chad-text-dim before:absolute before:-inset-3.5 before:content-[''] md:before:-inset-3 hover:text-chad-accent"
    >
      <X className="size-3.5" aria-hidden="true" />
    </button>
  );
}
