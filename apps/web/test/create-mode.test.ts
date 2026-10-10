/**
 * The `drop` / `multisend` switch on `/create`
 * - `drop` is first and the default; `multisend` is always last
 * - when `GET /api/chains` says `handleMode: false` for the chosen chain, `drop` cannot be picked
 *   and the page is on `multisend`; until the api answers, `drop` is
 *   selected but `next` waits
 * - each mode keeps its own box
 * - drop mode: the handle list is checked on the phone, then one paid lookup on `next`; any
 *   handle X does not know keeps the page on step 1
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  initialForm,
  modeFromSearch,
  reduceForm,
  viewOf,
  type FormAction,
  type FormState,
  type HandlePreview,
} from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;

const HANDLES = "@alice 0.01\n@bob 0.02";
const SOL_P = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";

const bothOn = { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true };

function run(...actions: FormAction[]): FormState {
  return actions.reduce(reduceForm, initialForm(pills));
}

const preview = (text: string, missing: string[] = []): HandlePreview => ({
  forText: text,
  found: [
    { handle: "alice", xUserId: "1", displayName: "Alice", profileImageUrl: null },
    { handle: "bob", xUserId: "2", displayName: "Bob", profileImageUrl: null },
  ],
  missing,
});

describe("opening /create on a mode, the front page multisend link", () => {
  it("?mode=multisend opens on multisend; anything else on drop", () => {
    expect(modeFromSearch("multisend")).toBe("multisend");
    expect(modeFromSearch("drop")).toBe("drop");
    expect(modeFromSearch(undefined)).toBe("drop");
    expect(modeFromSearch("other")).toBe("drop");
    expect(modeFromSearch(["multisend", "drop"])).toBe("multisend");
  });

  it("the form starts on the mode it is given, drop by default", () => {
    expect(initialForm(pills).mode).toBe("drop");
    expect(initialForm(pills, "multisend").mode).toBe("multisend");
  });

  it("the page reads ?mode and hands it to the form", () => {
    const page = readFileSync(join(__dirname, "..", "src", "app", "create", "page.tsx"), "utf8");
    expect(page).toContain("modeFromSearch(");
    expect(page).toContain("initialMode=");
  });
});

describe("the mode switch", () => {
  it("starts on drop, and next waits until the api says whether handle mode is on", () => {
    const state = run({ type: "handleText", value: HANDLES });
    expect(state.mode).toBe("drop");
    const view = viewOf(state, pills);
    expect(view.dropAvailable).toBeNull();
    expect(view.paused).toBe(false);
    expect(view.step1Ok).toBe(false);
  });

  it("with handle mode on, drop stays the default and next is open for a clean list", () => {
    const view = viewOf(
      run({ type: "handleModes", value: bothOn }, { type: "handleText", value: HANDLES }),
      pills,
    );
    expect(view.dropAvailable).toBe(true);
    expect(view.step1Ok).toBe(true);
    expect(view.people).toBe(2);
    expect(view.totalWei).toBe(30_000_000n);
    expect(view.placeholder.startsWith("@")).toBe(true);
  });

  it("with handle mode off, the page is on multisend, drop cannot be picked, and it says paused", () => {
    const off = run({ type: "handleModes", value: { [SOLANA_KEY]: false } });
    expect(off.mode).toBe("multisend");
    const view = viewOf(off, pills);
    expect(view.dropAvailable).toBe(false);
    expect(view.paused).toBe(true);
    expect(reduceForm(off, { type: "mode", mode: "drop" }).mode).toBe("multisend");
  });

  it("moving to a chain where handle mode is off moves drop to multisend", () => {
    const state = run(
      { type: "handleModes", value: { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: false } },
      { type: "chain", key: "solana" },
    );
    expect(state.mode).toBe("drop");
    const moved = reduceForm(state, { type: "chain", key: "robinhood" });
    expect(moved.mode).toBe("multisend");
    expect(viewOf(moved, pills).paused).toBe(true);
  });

  it("each mode keeps its own box", () => {
    const state = run(
      { type: "handleModes", value: bothOn },
      { type: "handleText", value: HANDLES },
      { type: "mode", mode: "multisend" },
      { type: "text", value: `${SOL_P} 0.01` },
      { type: "mode", mode: "drop" },
    );
    expect(state.handleText).toBe(HANDLES);
    expect(state.text).toBe(`${SOL_P} 0.01`);
  });

  it("changing the mode on step 2 goes back to step 1, so a list is never sent unchecked", () => {
    const step2 = run(
      { type: "handleModes", value: bothOn },
      { type: "handleText", value: HANDLES },
      { type: "preview", preview: preview(HANDLES) },
    );
    expect(step2.step).toBe(2);
    const switched = reduceForm(step2, { type: "mode", mode: "multisend" });
    expect(switched.step).toBe(1);
    expect(switched.mode).toBe("multisend");
    // Tapping the mode already on does nothing.
    expect(reduceForm(step2, { type: "mode", mode: "drop" })).toBe(step2);
  });

  it("the fee in drop mode follows the handle total", () => {
    const view = viewOf(
      run({ type: "handleModes", value: bothOn }, { type: "handleText", value: HANDLES }),
      pills,
      100,
      0n,
    );
    expect(view.feeWei).toBe(300_000n);
  });

  it("the sender's own handle keeps next off", () => {
    const view = viewOf(
      run({ type: "handleModes", value: bothOn }, { type: "handleText", value: "@alice 0.01" }),
      pills,
      null,
      0n,
      "Alice",
    );
    expect(view.handles.errors).toHaveLength(1);
    expect(view.step1Ok).toBe(false);
  });
});

describe("the one lookup on next", () => {
  const ready = () =>
    run({ type: "handleModes", value: bothOn }, { type: "handleText", value: HANDLES });

  it("next in drop mode does not move by itself: the lookup does", () => {
    expect(reduceForm(ready(), { type: "next" }).step).toBe(1);
  });

  it("a clean lookup moves to step 2 and keeps the names and avatars for the list", () => {
    const state = reduceForm(ready(), { type: "preview", preview: preview(HANDLES) });
    expect(state.step).toBe(2);
    expect(viewOf(state, pills).found.map((f) => f.handle)).toEqual(["alice", "bob"]);
  });

  it("a handle X does not know keeps step 1 and lists the misses", () => {
    const state = reduceForm(ready(), {
      type: "preview",
      preview: preview(HANDLES, ["ghost"]),
    });
    expect(state.step).toBe(1);
    const view = viewOf(state, pills);
    expect(view.missing).toEqual(["ghost"]);
    expect(view.step1Ok).toBe(false);
  });

  it("editing the list clears an old lookup, and a lookup for old text is ignored", () => {
    const missed = reduceForm(ready(), { type: "preview", preview: preview(HANDLES, ["ghost"]) });
    const edited = reduceForm(missed, { type: "handleText", value: "@alice 0.01" });
    expect(viewOf(edited, pills).missing).toEqual([]);
    expect(viewOf(edited, pills).step1Ok).toBe(true);

    const stale = reduceForm(edited, { type: "preview", preview: preview(HANDLES) });
    expect(stale.step).toBe(1);
  });
});
