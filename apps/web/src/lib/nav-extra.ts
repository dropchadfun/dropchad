import type { LucideIcon } from "lucide-react";

/**
 * A menu item that is not in every copy of the site. `useExtraNav` in `lib/extra-nav.ts` gives
 * the ones to show right now; both menus put each one right after the item named in `after`.
 */
export interface ExtraNavItem {
  readonly href: string;
  readonly label: string;
  /** The label of the menu item it follows. */
  readonly after: string;
  /** The phone menu icon. */
  readonly icon: LucideIcon;
}

/** `list` with each extra right after its `after` item; at the end when that item is missing. */
export function withExtras<
  T extends { readonly label: string },
  E extends { readonly label: string; readonly after: string },
>(list: readonly T[], extras: readonly E[]): (T | E)[] {
  const out: (T | E)[] = [...list];
  for (const extra of extras) {
    const at = out.findIndex((item) => item.label === extra.after);
    out.splice(at < 0 ? out.length : at + 1, 0, extra);
  }
  return out;
}
