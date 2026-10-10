/**
 * The hackathon line. The words, the typing clock
 * and the two browser flags. The whole line links to our project page (, after
 * we submitted). Nothing else from the organiser: no logo, image, video or copy of their style,
 * the hackathon rules.
 */

export const HACKATHON_TEXT = "building for the Crypto World's Fair hackathon";

/** Our project page, opened in a new tab. */
export const HACKATHON_URL = "https://colosseum.com/arena/projects/dropchad";

/** The whole typing, once: the one exception to the 400ms rule. */
export const TYPE_MS = 1200;

/** Set once `×` is pressed: closed on every page, every visit, in this browser. */
export const CLOSED_KEY = "dc-hackathon-line-closed";

/** Set once the line has typed in this tab: the next page loads show it still. */
export const TYPED_KEY = "dc-hackathon-line-typed";

/** How many letters show `ms` after the typing starts. Never more than the text, never back. */
export function typedLength(ms: number, length: number): number {
  if (ms <= 0) return 0;
  return Math.min(length, Math.floor((ms / TYPE_MS) * length));
}

/** What a bar element needs from the DOM: its `data-state`. */
interface Bar {
  dataset: Record<string, string | undefined>;
}

/** What `localStorage` needs to offer here. It can throw, like a blocked private window. */
interface Store {
  setItem(key: string, value: string): void;
}

/** `×`: hide now, and remember it. A storage that throws still hides the line. */
export function closeHackathonLine(bar: Bar, storage: Store): void {
  bar.dataset["state"] = "closed";
  try {
    storage.setItem(CLOSED_KEY, "1");
  } catch {
    // Blocked storage: closed for this page only. Nothing else to do.
  }
}

/**
 * The inline script right after the bar, run while the browser parses the page, before the first
 * paint (the Next guide "preventing flash before hydration"). It writes the bar's `data-state`:
 * `closed` when `×` was pressed before, `still` when this tab typed it already or the person asked
 * for reduced motion, else `type`, and marks this tab as typed. Every storage call may throw.
 */
export function hackathonLineScript(): string {
  return `(function(){var b=document.currentScript&&document.currentScript.previousElementSibling;if(!b)return;try{if(localStorage.getItem("${CLOSED_KEY}")==="1"){b.dataset.state="closed";return}}catch(e){}var s=false;try{s=matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}try{if(sessionStorage.getItem("${TYPED_KEY}")==="1")s=true;else if(!s)sessionStorage.setItem("${TYPED_KEY}","1")}catch(e){}b.dataset.state=s?"still":"type"})()`;
}
