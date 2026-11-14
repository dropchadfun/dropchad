"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/components/site/SessionProvider";
import { pillStyle, TagList } from "@/components/site/TagPill";
import { ApiError, setMyTags, type ProfileTag } from "@/lib/api";
import { readCsrfToken } from "@/lib/csrf";
import {
  isLocked,
  MAIN_TAG_HINT,
  pickerLine,
  pickerView,
  PROFILE_TAGS,
  sameTags,
  toggleTag,
} from "@/lib/tags";
import { cn } from "@/lib/utils";

/**
 * The tag block. On your own profile one flat row of pills, one on:
 * the main tag, the one your drops and the boards show. A tap only marks the pill; `lock it in`
 * saves, because a save locks the tag for 30 days and the line under the row says so before the
 * first save. Once a tag exists the block collapses to that pill and a small `change` link; the
 * link opens the full list, read only while the lock holds, editable after. On anyone else's
 * profile only their pill, no label, nothing at all when there is none. The api derives the
 * kind and enforces the lock.
 */
export function ProfileTags({ xUserId, tags }: { xUserId: string; tags: readonly ProfileTag[] }) {
  const { profile } = useSession();
  if (profile && profile.xUserId === xUserId) {
    return <TagPicker current={profile.tags} lockedUntil={profile.tagLockedUntil} />;
  }
  if (tags.length === 0) return null;
  return (
    <div className="mt-4">
      <TagList tags={tags} />
    </div>
  );
}

function TagPicker({
  current,
  lockedUntil,
}: {
  current: readonly ProfileTag[];
  lockedUntil: string | null;
}) {
  const { refresh } = useSession();
  const router = useRouter();
  // Read once at mount. This branch only renders on the client, after the session loaded.
  const [now] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<ProfileTag[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<"save" | "locked" | null>(null);

  const locked = isLocked(lockedUntil, now);
  const view = pickerView(current, lockedUntil, now, expanded);
  const shown = pending ?? current;
  const changed = pending !== null && pending.length > 0 && !sameTags(pending, current);

  const pick = (tag: ProfileTag) => {
    if (saving || view === "readonly") return;
    setFailed(null);
    setPending(toggleTag(shown, tag));
  };

  const toggle = () => {
    setExpanded((open) => !open);
    setPending(null);
    setFailed(null);
  };

  const confirm = async () => {
    if (pending === null || !changed || saving) return;
    const token = readCsrfToken();
    if (token === null) return;
    setSaving(true);
    setFailed(null);
    try {
      await setMyTags(pending, token);
      setPending(null);
      setExpanded(false);
      await refresh();
      // The profile page around it is server rendered from the api; ask for it again.
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // An earlier save locked it. The refreshed session carries the date.
        setFailed("locked");
        setPending(null);
        await refresh();
      } else {
        setFailed("save");
      }
    } finally {
      setSaving(false);
    }
  };

  const line = pickerLine({ view, current, pending, lockedUntil, now, failed });
  const picking = view === "empty" || view === "editable";

  const changeLink = current.length > 0 && (
    <button
      type="button"
      onClick={toggle}
      className="type-small text-chad-text-dim underline-offset-2 hover:text-chad-text hover:underline"
    >
      {expanded ? "hide" : "change"}
    </button>
  );

  return (
    <div className="mt-4">
      <p className="type-label">your tag</p>
      {view === "collapsed" ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <TagList tags={current} />
          {changeLink}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="tags">
            {PROFILE_TAGS.map((tag) => {
              const on = shown.includes(tag);
              // Locked: nothing taps.
              const blocked = view === "readonly";
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={blocked || undefined}
                  disabled={saving}
                  onClick={() => pick(tag)}
                  className={cn("pill type-small", on && "pill-on")}
                  style={pillStyle(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
          {changeLink}
        </div>
      )}
      <p className="type-small mt-2 text-chad-text-dim">{line}</p>
      {picking && !locked && <p className="type-small mt-1 text-chad-text-dim">{MAIN_TAG_HINT}</p>}
      {changed && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void confirm()}
          className="btn btn-secondary mt-2 h-8 px-3"
        >
          {saving ? "locking…" : "lock it in"}
        </button>
      )}
    </div>
  );
}
