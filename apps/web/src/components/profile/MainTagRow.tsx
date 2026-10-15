import { TabButton, Tabs } from "@/components/boards/BoardTabs";
import type { ProfileTag } from "@/lib/tags";

/**
 * The `main tag` row of the picker. The tags that are on, in the
 * board tabs look; the pressed one is the main tag, the first of the list, the one people see on
 * drops and boards. A tap makes another one main. Nothing while no tag is on.
 */
export function MainTagRow({
  tags,
  onPick,
  disabled = false,
}: {
  tags: readonly ProfileTag[];
  onPick: (tag: ProfileTag) => void;
  disabled?: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="type-label">main tag</p>
      <Tabs label="main tag">
        {tags.map((tag, i) => (
          <TabButton key={tag} active={i === 0} onClick={() => !disabled && onPick(tag)}>
            {tag}
          </TabButton>
        ))}
      </Tabs>
    </div>
  );
}
