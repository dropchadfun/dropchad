/**
 * The profile tags. One flat list, `chad` first and a normal pick.
 * A chad picks one to three; the first of the saved list is the main tag, the one rows and
 * boards show. The set locks for 30 days once saved. `project` is a kind the api derives,
 * never a tag.
 */
import { describe, expect, it } from "vitest";

import {
  canPick,
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

  it("takes three at most and locks for 30 days", () => {
    expect(MAX_TAGS).toBe(3);
    expect(TAG_LOCK_DAYS).toBe(30);
  });
});

describe("toggleTag, the order is the order tapped", () => {
  it("adds at the end, so the first tap stays first", () => {
    expect(toggleTag([], "dev")).toEqual(["dev"]);
    expect(toggleTag(["dev"], "kol")).toEqual(["dev", "kol"]);
    expect(toggleTag(["dev", "kol"], "chad")).toEqual(["dev", "kol", "chad"]);
  });

  it("takes a tag off on a second tap, and the next one moves up", () => {
    expect(toggleTag(["dev", "kol", "chad"], "dev")).toEqual(["kol", "chad"]);
    expect(toggleTag(["dev"], "dev")).toEqual([]);
  });

  it("does nothing on a fourth tag", () => {
    expect(toggleTag(["dev", "kol", "chad"], "nft")).toEqual(["dev", "kol", "chad"]);
  });

  it("canPick: a picked tag can always be tapped off, a new one only below three", () => {
    expect(canPick(["dev", "kol"], "nft")).toBe(true);
    expect(canPick(["dev", "kol", "chad"], "nft")).toBe(false);
    expect(canPick(["dev", "kol", "chad"], "kol")).toBe(true);
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

  it("asks for up to 3 when nothing is picked", () => {
    expect(pickerLine({ ...base, view: "empty" })).toBe("pick up to 3. they lock for 30 days.");
    expect(pickerLine({ ...base, view: "empty", pending: [] })).toBe(
      "pick up to 3. they lock for 30 days.",
    );
  });

  it("names the picks in order and the day they lock until, before the save", () => {
    expect(pickerLine({ ...base, view: "empty", pending: ["dev", "kol"] })).toBe(
      `dev, kol lock until ${in30}. sure?`,
    );
    expect(
      pickerLine({ ...base, view: "editable", current: ["dev"], pending: ["nft", "dev"] }),
    ).toBe(`nft, dev lock until ${in30}. sure?`);
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
      "tap change to pick again. they lock for 30 days.",
    );
    expect(pickerLine({ ...base, view: "editable", current: ["dev"] })).toBe(
      "tap to change. up to 3. they lock for 30 days.",
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
