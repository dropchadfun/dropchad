import { pagerItems } from "@/components/front/drop-tabs";
import { cn } from "@/lib/utils";

/**
 * The page numbers under a list: the numbers that move
 * with the page, `1 … 6 7 8 … 19`, the current page marked like an active
 * tab. Buttons, not links: the page stays. One page, 10
 * rows or fewer: nothing. The front page's `latest` and the profile tabs. `label`
 * names it apart when a page has two, the front page `top chads`.
 */
export function Pager({
  pages,
  page,
  onPick,
  label = "pages",
}: {
  pages: number;
  page: number;
  onPick: (page: number) => void;
  label?: string;
}) {
  const items = pagerItems(pages, page);
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-center gap-1">
      {items.map((item, index) => {
        const page = item.page;
        // A `…` is not a page and not a button.
        if (page === null) {
          return (
            <span
              key={`gap-${String(index)}`}
              aria-hidden="true"
              className="type-body flex h-8 min-w-8 items-center justify-center text-chad-text-dim"
            >
              {item.label}
            </span>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            aria-current={item.current ? "page" : undefined}
            onClick={() => {
              onPick(page);
            }}
            className={cn(
              "interactive type-body num flex h-8 min-w-8 items-center justify-center rounded-md px-2.5 font-medium",
              item.current
                ? "bg-chad-surface-2 text-chad-text hover:bg-chad-surface-2"
                : "text-chad-text-dim hover:text-chad-text",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
