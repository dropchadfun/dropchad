import { TagPill } from "@/components/site/TagPill";
import { mainTag, type ProfileTag } from "@/lib/tags";

/**
 * The main tag where only one fits: drop rows, board rows and the drop page. Only
 * that one pill: no `+2`, no count and no box with the others. The profile
 * does not use this; it shows every tag, `TagList`.
 */
export function MainTagPill({
  tags,
  className,
}: {
  tags: readonly ProfileTag[];
  className?: string;
}) {
  const main = mainTag(tags);
  if (main === null) return null;
  return <TagPill tag={main} {...(className === undefined ? {} : { className })} />;
}
