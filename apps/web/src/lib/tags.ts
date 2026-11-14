/**
 * The profile tags. One flat list, `chad` first and a normal pick,
 * `musician` after `streamer`. A chad picks one tag, the main tag: the one drop rows, board
 * rows, the drop page and the profile show. Self picked, so a tag proves nothing. Once saved it
 * locks for 30 days; the api enforces that and says when it opens, `tagLockedUntil`, the web
 * only reads the date. The api derives `kind` from the main tag, never the web. `project` is a
 * kind, not a tag.
 *
 * Pure. The picker sends a list of one to `PATCH /api/me` after the chad confirms.
 */
import { formatDayMonth } from "@/lib/format";

export const PROFILE_TAGS = [
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
] as const;
export type ProfileTag = (typeof PROFILE_TAGS)[number];

/** How many tags one chad can hold: the main tag alone. The api says the same, `MAX_TAGS`. */
export const MAX_TAGS = 1;

/** How long a saved set locks. The number is the api's, `TAG_LOCK_DAYS`; this is for the copy. */
export const TAG_LOCK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isTag(value: string): value is ProfileTag {
  return (PROFILE_TAGS as readonly string[]).includes(value);
}

/** The main tag, the one rows, boards and the drop page show: the first of the list, or none. */
export function mainTag(tags: readonly ProfileTag[]): ProfileTag | null {
  return tags[0] ?? null;
}

/** The grey line under the picker while picking. */
export const MAIN_TAG_HINT = "your main tag shows on your drops and the boards.";

/** A tap in the picker, one tag at a time: the tag that is on comes off, any other replaces it. */
export function toggleTag(picked: readonly ProfileTag[], tag: ProfileTag): ProfileTag[] {
  return picked.length === 1 && picked[0] === tag ? [] : [tag];
}

/** The same list in the same order. The order counts: the main tag is the one people see. */
export function sameTags(a: readonly ProfileTag[], b: readonly ProfileTag[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/** True while the api would refuse a change: `until` is in the future. No date, never locked. */
export function isLocked(until: string | null, now: number): boolean {
  if (until === null) return false;
  const at = new Date(until).getTime();
  return Number.isFinite(at) && at > now;
}

export type PickerView = "empty" | "collapsed" | "readonly" | "editable";

/**
 * What the profile picker shows. No tags yet: the full list, editable. Tags: the
 * chosen pills until `change` expands it, read only while the lock holds, editable once it has
 * passed.
 */
export function pickerView(
  current: readonly ProfileTag[],
  lockedUntil: string | null,
  now: number,
  expanded: boolean,
): PickerView {
  if (current.length === 0) return "empty";
  if (!expanded) return "collapsed";
  return isLocked(lockedUntil, now) ? "readonly" : "editable";
}

export interface PickerLineInput {
  readonly view: PickerView;
  readonly current: readonly ProfileTag[];
  /** What the chad tapped and has not saved. `null` is no change started. */
  readonly pending: readonly ProfileTag[] | null;
  readonly lockedUntil: string | null;
  readonly now: number;
  readonly failed: "save" | "locked" | null;
}

/** The one grey line under the pills, simple words. */
export function pickerLine(input: PickerLineInput): string {
  const { view, current, pending, lockedUntil, now, failed } = input;
  const lock = `it locks for ${String(TAG_LOCK_DAYS)} days.`;
  if (failed === "save") return "could not save. try again.";
  if (isLocked(lockedUntil, now) && lockedUntil !== null) {
    return `locked until ${formatDayMonth(lockedUntil)}`;
  }
  if (failed === "locked") return "locked by an earlier save. reload the page.";
  if (pending !== null && pending.length > 0 && !sameTags(pending, current)) {
    const until = formatDayMonth(new Date(now + TAG_LOCK_DAYS * DAY_MS).toISOString());
    return `${pending.join(", ")} locks until ${until}. sure?`;
  }
  if (view === "empty") return `pick one. ${lock}`;
  if (view === "collapsed") return `tap change to pick again. ${lock}`;
  return `tap to change. ${lock}`;
}

/** The pill's colour, as a design token. Never a hex in a component. */
export function tagColorVar(tag: ProfileTag): string {
  return `var(--chad-tag-${tag})`;
}
