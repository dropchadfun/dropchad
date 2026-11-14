import type { CSSProperties } from "react";

import { type ProfileTag, tagColorVar } from "@/lib/tags";

/**
 * The tag pill: a small round pill like a discord role, a dark fill, the word and
 * a thin border in the tag's colour, nothing else. The colour is the tag's token through
 * `--pill`; `.pill` paints it when on, grey with no fill when off. One place, so the picker, the
 * profile, the drop rows, the boards and the drop page agree.
 */

/** The colour var for an element that carries the `pill` classes. */
export function pillStyle(tag: ProfileTag): CSSProperties {
  return { "--pill": tagColorVar(tag) } as CSSProperties;
}

/** The read only pill: always on. */
export function TagPill({ tag, className }: { tag: ProfileTag; className?: string }) {
  return (
    <span
      className={`pill pill-on type-small${className ? ` ${className}` : ""}`}
      style={pillStyle(tag)}
    >
      {tag}
    </span>
  );
}

/** Every tag of a chad, in order, the profile under the name. Nothing at all with none. */
export function TagList({ tags }: { tags: readonly ProfileTag[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <TagPill key={tag} tag={tag} />
      ))}
    </div>
  );
}
