/**
 * The profile tags. One flat list, `chad` first and a normal pick.
 * A chad picks one tag, the main tag, the one rows and boards show. It locks for 30 days once
 * saved. `project` is a kind the api derives, never a tag.
 */
import { describe, expect, it } from "vitest";

import {
  isLocked,
  isTag,
  mainTag,
  MAX_TAGS,
  pickerLine,
  pickerView,
  PROFILE_TAGS,
  sameTags,
  TAG_LOCK_DAYS,
  tagColorVar,
  toggleTag,
} from "@/lib/tags";

describe("the tag list", () => {
  it("is one flat list in this order, chad first", () => {
    expect(PROFILE_TAGS).toEqual([
      "chad",
      "kol",
      "dev",
      "streamer",
      "musician",
      "trader",
      "community",
      "memecoin",
      "utility",
      "nft",
    ]);
  });

  it("has chad as a pick and no project tag", () => {
    expect(isTag("chad")).toBe(true);
    expect(isTag("project")).toBe(false);
    expect(isTag("nft")).toBe(true);
    expect(isTag("")).toBe(false);
  });

  it("names one colour token per tag, never a hex", () => {
    for (const tag of PROFILE_TAGS) expect(tagColorVar(tag)).toBe(`var(--chad-tag-${tag})`);
  });

  it("takes one, the main tag, and locks for 30 days", () => {
    expect(MAX_TAGS).toBe(1);
    expect(TAG_LOCK_DAYS).toBe(30);
  });
});

describe("toggleTag, one tag at a time", () => {
  it("a tap makes that tag the one on", () => {
    expect(toggleTag([], "dev")).toEqual(["dev"]);
    expect(toggleTag(["dev"], "kol")).toEqual(["kol"]);
    // A list from before keeps nothing but the new tap.
    expect(toggleTag(["dev", "kol", "chad"], "nft")).toEqual(["nft"]);
  });

  it("a tap on the one that is on takes it off", () => {
    expect(toggleTag(["dev"], "dev")).toEqual([]);
  });

  it("mainTag is the one rows and boards show, or none", () => {
    expect(mainTag(["streamer", "dev"])).toBe("streamer");
    expect(mainTag([])).toBeNull();
  });

  it("sameTags counts the order: the main tag decides what rows show", () => {
    expect(sameTags(["dev", "kol"], ["dev", "kol"])).toBe(true);
    expect(sameTags(["dev", "kol"], ["kol", "dev"])).toBe(false);
    expect(sameTags(["dev"], ["dev", "kol"])).toBe(false);
  });
});

describe("isLocked", () => {
  const until = "2026-10-09T00:00:00.000Z";

  it("is locked before the date", () => {
    expect(isLocked(until, new Date("2026-09-09T00:00:00.000Z").getTime())).toBe(true);
    expect(isLocked(until, new Date("2026-10-08T23:59:59.000Z").getTime())).toBe(true);
  });

  it("opens at the date, and stays open after", () => {
    expect(isLocked(until, new Date(until).getTime())).toBe(false);
    expect(isLocked(until, new Date("2027-01-01T00:00:00.000Z").getTime())).toBe(false);
  });

  it("is never locked without a date", () => {
    expect(isLocked(null, Date.now())).toBe(false);
  });
});

describe("pickerView, what the profile picker shows", () => {
  const now = new Date("2026-10-01T12:00:00.000Z").getTime();
  const locked = "2026-10-31T12:00:00.000Z";
  const passed = "2026-09-01T00:00:00.000Z";

  it("is the full editable list while nothing is picked, whatever expanded says", () => {
    expect(pickerView([], null, now, false)).toBe("empty");
    expect(pickerView([], null, now, true)).toBe("empty");
  });

  it("collapses to the chosen pills once tags exist", () => {
    expect(pickerView(["kol", "dev"], locked, now, false)).toBe("collapsed");
    expect(pickerView(["kol"], passed, now, false)).toBe("collapsed");
  });

  it("opens read only while locked", () => {
    expect(pickerView(["kol", "dev"], locked, now, true)).toBe("readonly");
  });

  it("opens editable once the lock passed, or when the api never said", () => {
    expect(pickerView(["kol"], passed, now, true)).toBe("editable");
    expect(pickerView(["kol"], null, now, true)).toBe("editable");
  });
});

describe("pickerLine, the one grey line under the pills, simple words", () => {
  const now = new Date("2026-10-01T12:00:00.000Z").getTime();
  const locked = "2026-10-31T12:00:00.000Z";
  // Day and month only, never the year, held together by a no-break space.
  const in30 = "31\u00a0oct";
  const base = { current: [], pending: null, lockedUntil: null, now, failed: null } as const;

  it("asks for one when nothing is picked", () => {
    expect(pickerLine({ ...base, view: "empty" })).toBe("pick one. it locks for 30 days.");
    expect(pickerLine({ ...base, view: "empty", pending: [] })).toBe(
      "pick one. it locks for 30 days.",
    );
  });

  it("names the pick and the day it locks until, before the save", () => {
    expect(pickerLine({ ...base, view: "empty", pending: ["dev"] })).toBe(
      `dev locks until ${in30}. sure?`,
    );
    expect(pickerLine({ ...base, view: "editable", current: ["dev"], pending: ["nft"] })).toBe(
      `nft locks until ${in30}. sure?`,
    );
  });

  it("says when it opens while locked", () => {
    expect(pickerLine({ ...base, view: "collapsed", current: ["dev"], lockedUntil: locked })).toBe(
      "locked until 31\u00a0oct",
    );
    expect(pickerLine({ ...base, view: "readonly", current: ["dev"], lockedUntil: locked })).toBe(
      "locked until 31\u00a0oct",
    );
  });

  it("says how to change once open", () => {
    expect(pickerLine({ ...base, view: "collapsed", current: ["dev"] })).toBe(
      "tap change to pick again. it locks for 30 days.",
    );
    expect(pickerLine({ ...base, view: "editable", current: ["dev"] })).toBe(
      "tap to change. it locks for 30 days.",
    );
  });

  it("says a failed save plainly", () => {
    expect(pickerLine({ ...base, view: "empty", pending: ["dev"], failed: "save" })).toBe(
      "could not save. try again.",
    );
    expect(pickerLine({ ...base, view: "collapsed", current: ["dev"], failed: "locked" })).toBe(
      "locked by an earlier save. reload the page.",
    );
  });
});
