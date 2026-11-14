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
  createsOffFromChains,
  handlesForSubmit,
  initialForm,
  MULTISEND_REFUND_LINE,
  modeFromSearch,
  reduceForm,
  viewOf,
  type FormAction,
  type FormState,
  type HandlePreview,
} from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills({ testnetSite: true }); // the testnet site pills
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

describe("the submit carries the X id the sender saw", () => {
  const found = preview(HANDLES).found;

  it("each line gets the id of its name on step 2, whatever the case", () => {
    expect(
      handlesForSubmit(
        [
          { handle: "Alice", amountWei: 10n },
          { handle: "bob", amountWei: 20n },
          { handle: "alice", amountWei: 5n },
        ],
        found,
      ),
    ).toEqual([
      { handle: "Alice", amount: "10", xUserId: "1" },
      { handle: "bob", amount: "20", xUserId: "2" },
      { handle: "alice", amount: "5", xUserId: "1" },
    ]);
  });

  it("a line with no id sends nothing", () => {
    expect(handlesForSubmit([{ handle: "carol", amountWei: 1n }], found)).toBeNull();
  });

  it("handles_changed goes back to step 1 and drops the old lookup", () => {
    const step2 = run(
      { type: "handleModes", value: bothOn },
      { type: "handleText", value: HANDLES },
      { type: "preview", preview: preview(HANDLES) },
    );
    expect(step2.step).toBe(2);
    const back = reduceForm(step2, { type: "handlesChanged" });
    expect(back.step).toBe(1);
    expect(back.preview).toBeNull();
    expect(back.handleText).toBe(HANDLES);
  });

  it("the page sends the ids and handles the 409", () => {
    const page = readFileSync(
      join(__dirname, "..", "src", "components", "create", "CreateDrop.tsx"),
      "utf8",
    );
    expect(page).toContain("handlesForSubmit(");
    expect(page).toContain('"handles_changed"');
    expect(page).toContain('type: "handlesChanged"');
  });
});

describe("the refund line under the refund address create step 2", () => {
  const create = () =>
    readFileSync(join(__dirname, "..", "src", "components", "create", "CreateDrop.tsx"), "utf8");

  it("a multisend: a failed payment or too much comes back after 3 days, nobody claims", () => {
    expect(MULTISEND_REFUND_LINE).toBe(
      "if a payment fails or you send too much, the rest comes back here after 3 days.",
    );
    expect(MULTISEND_REFUND_LINE).not.toContain("claim");
  });

  it("a drop keeps its line word for word; the mode picks the line", () => {
    expect(create()).toMatch(
      /drop\s+\?\s+"whatever people do not claim in 3 days comes back here\."\s+:\s+MULTISEND_REFUND_LINE/,
    );
  });

  it("both modes keep the refund field and the same exchange warning, once", () => {
    const page = create();
    expect(page.match(/id="refund"/g)).toHaveLength(1);
    expect(
      page.match(/a wallet you hold the keys to\. never an exchange deposit address:/g),
    ).toHaveLength(1);
    expect(
      page.match(/exchanges do not credit contract transfers and the money is gone\./g),
    ).toHaveLength(1);
  });
});

describe("new drops off", () => {
  const ONE_SOLANA =
    "We are fixing something on Solana. Short break. New Solana drops are off. Claims still work.";
  /** What the page dispatches when `/api/chains` says Solana is off: handle off and creates off. */
  const solanaOff: FormAction = {
    type: "handleModes",
    value: { [SOLANA_KEY]: false, [ROBINHOOD_KEY]: true },
    createsOff: { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: false },
  };

  it("createsOn false is off; true, null or absent is not", () => {
    expect(
      createsOffFromChains([
        { key: "solana-devnet", createsOn: false },
        { key: "robinhood-testnet", createsOn: true },
        { key: "other", createsOn: null },
        { key: "old" },
      ]),
    ).toEqual({ "solana-devnet": true, "robinhood-testnet": false, other: false, old: false });
  });

  it("drop does not move to multisend; both tabs off and the line", () => {
    const state = run(solanaOff, { type: "handleText", value: HANDLES });
    expect(state.mode).toBe("drop");
    const view = viewOf(state, pills);
    expect(view.createsOff).toBe(true);
    expect(view.pauseLine).toBe(ONE_SOLANA);
    expect(view.step1Ok).toBe(false);
    expect(view.step2Ok).toBe(false);
    expect(reduceForm(state, { type: "mode", mode: "multisend" }).mode).toBe("drop");
  });

  it("a page opened on multisend stays there, and next stays off for a clean list", () => {
    const state = [solanaOff, { type: "text", value: `${SOL_P} 0.01` } as FormAction].reduce(
      reduceForm,
      initialForm(pills, "multisend"),
    );
    expect(state.mode).toBe("multisend");
    const view = viewOf(state, pills);
    expect(view.createsOff).toBe(true);
    expect(view.step1Ok).toBe(false);
    expect(view.step2Ok).toBe(false);
    expect(reduceForm(state, { type: "mode", mode: "drop" }).mode).toBe("multisend");
  });

  it("handle mode off with creates on still moves to multisend, as before", () => {
    const state = run({
      type: "handleModes",
      value: { [SOLANA_KEY]: false },
      createsOff: { [SOLANA_KEY]: false },
    });
    expect(state.mode).toBe("multisend");
    const view = viewOf(state, pills);
    expect(view.createsOff).toBe(false);
    expect(view.pauseLine).toBeNull();
    expect(view.paused).toBe(true);
  });

  it("the other chain works as normal", () => {
    const state = run(solanaOff, { type: "chain", key: "robinhood" });
    const view = viewOf(state, pills);
    expect(view.createsOff).toBe(false);
    expect(view.pauseLine).toBeNull();
    expect(view.dropAvailable).toBe(true);
  });

  it("a later handleModes without createsOff keeps the creates state", () => {
    const state = run(solanaOff, { type: "handleModes", value: { [SOLANA_KEY]: false } });
    expect(state.mode).toBe("drop");
    expect(viewOf(state, pills).createsOff).toBe(true);
  });

  it("the page reads createsOn, passes the line to the switch and hides the steps", () => {
    const page = readFileSync(
      join(__dirname, "..", "src", "components", "create", "CreateDrop.tsx"),
      "utf8",
    );
    expect(page).toContain("createsOffFromChains(");
    expect(page).toContain("pauseLine={view.pauseLine}");
    expect(page).toMatch(/view\.createsOff\s*\?/);
  });
});
