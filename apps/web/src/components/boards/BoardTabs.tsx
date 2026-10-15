import Link from "next/link";
import type { ReactNode } from "react";

import type { BoardRange, BoardType } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The two tabs, in this order. `fed` is the default. Both
 * rank by people paid; `project` keeps kind `project` until real tokens exist. The api's usd
 * board, `dropper`, has no tab.
 */
export const BOARD_TABS: { readonly value: BoardType; readonly label: string }[] = [
  { value: "fed", label: "best dropchad" },
  { value: "project", label: "best token" },
];

/** The range tabs: `this week` is the default. */
export const RANGE_TABS: { readonly value: BoardRange; readonly label: string }[] = [
  { value: "day", label: "24h" },
  { value: "week", label: "this week" },
  { value: "all", label: "all time" },
];

/** The range a url may name. Anything else is this week. */
export function rangeFromParam(value: string | undefined): BoardRange {
  return RANGE_TABS.find((tab) => tab.value === value)?.value ?? "week";
}

/** The tab a url may name. Anything else, `dropper` included, is the default. */
export function tabFromParam(value: string | undefined): BoardType {
  return BOARD_TABS.find((tab) => tab.value === value)?.value ?? "fed";
}

/**
 * The tab row: one look on the boards page and the front page. A tab is a link when the page
 * carries the choice in the url, a button when the block switches in place.
 */
export function Tabs({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-chad-surface p-0.5" role="group" aria-label={label}>
      {children}
    </div>
  );
}

const tabClass = (active: boolean) =>
  cn(
    "interactive type-body flex h-8 items-center rounded-md px-2.5 font-medium whitespace-nowrap",
    active
      ? "bg-chad-surface-2 text-chad-text hover:bg-chad-surface-2"
      : "text-chad-text-dim hover:text-chad-text",
  );

export function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
      {children}
    </Link>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={tabClass(active)}>
      {children}
    </button>
  );
}
