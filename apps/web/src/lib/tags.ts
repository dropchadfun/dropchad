/**
 * The profile tags. One flat list, `chad` first and a normal pick,
 * `musician` after `streamer`. A chad picks one to three and one of them is
 * the main tag, the first of the saved list: the one drop rows, board rows and the drop page show,
 * alone. By default it is the first one tapped. Self picked, so a tag proves nothing. Once saved
 * the set locks for 30 days, a change of the main tag alone included; the api enforces that and
 * says when it opens, `tagLockedUntil`, the web only reads the date. The api derives `kind` from
 * the main tag, never the web. `project` is a kind, not a tag.
 *
 * Pure. The picker sends the list to `PATCH /api/me` after the chad confirms.
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

/** How many tags one chad can hold. The api says the same, `MAX_TAGS`. */
export const MAX_TAGS = 3;

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

/** Make a picked tag the main one: it moves to the front, the others keep their order. */
export function setMain(tags: readonly ProfileTag[], tag: ProfileTag): ProfileTag[] {
  if (!tags.includes(tag)) return [...tags];
  return [tag, ...tags.filter((t) => t !== tag)];
}

/** The grey line under the picker while picking. */
export const MAIN_TAG_HINT = "your main tag shows on your drops and the boards.";

/**
 * A tap in the picker. A picked tag comes off and the ones after it move up, so taking the main
 * tag off makes the next one main; a new one goes on the end, so the main tag stays; a fourth
 * does nothing.
 */
export function toggleTag(picked: readonly ProfileTag[], tag: ProfileTag): ProfileTag[] {
  if (picked.includes(tag)) return picked.filter((t) => t !== tag);
  if (picked.length >= MAX_TAGS) return [...picked];
  return [...picked, tag];
}

/** Whether a tap on `tag` does anything: off is always fine, on only below three. */
export function canPick(picked: readonly ProfileTag[], tag: ProfileTag): boolean {
  return picked.includes(tag) || picked.length < MAX_TAGS;
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
  const lock = `they lock for ${String(TAG_LOCK_DAYS)} days.`;
  if (failed === "save") return "could not save. try again.";
  if (isLocked(lockedUntil, now) && lockedUntil !== null) {
    return `locked until ${formatDayMonth(lockedUntil)}`;
  }
  if (failed === "locked") return "locked by an earlier save. reload the page.";
  if (pending !== null && pending.length > 0 && !sameTags(pending, current)) {
    const until = formatDayMonth(new Date(now + TAG_LOCK_DAYS * DAY_MS).toISOString());
    return `${pending.join(", ")} lock until ${until}. sure?`;
  }
  if (view === "empty") return `pick up to ${String(MAX_TAGS)}. ${lock}`;
  if (view === "collapsed") return `tap change to pick again. ${lock}`;
  return `tap to change. up to ${String(MAX_TAGS)}. ${lock}`;
}

/** The pill's colour, as the token from. Never a hex in a component. */
export function tagColorVar(tag: ProfileTag): string {
  return `var(--chad-tag-${tag})`;
}
