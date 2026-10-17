import { CopyButton } from "@/components/site/CopyButton";

/** How long `copy drop link` says `copied`. */
export const DROP_LINK_COPIED_MS = 2000;

/** The drop's own page on dropchad.com, the link everyone can copy. */
export function dropLink(address: string): string {
  return `https://dropchad.com/d/${address}`;
}

/**
 * `copy drop link`, for everyone, on every drop page, live and finished. Copies the drop
 * link only: no X post, no post text.
 */
export function CopyDropLink({ address }: { address: string }) {
  return (
    <div className="mt-4">
      <CopyButton value={dropLink(address)} label="copy drop link" doneMs={DROP_LINK_COPIED_MS} />
    </div>
  );
}
