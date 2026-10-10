import { SocialMark } from "@/components/site/SocialIcons";
import { xProfileUrl } from "@/lib/social";

/**
 * The X link: the X logo right after a person's `@handle`, on
 * the profile page and the drop page only. It opens their X account in a new tab. Grey, mint on
 * hover, 16px in a 44px target. Never inside a row that is itself a link.
 */
export function XLink({ handle }: { handle: string }) {
  return (
    <a
      href={xProfileUrl(handle)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`@${handle.replace(/^@/, "")} on X`}
      className="-m-3.5 inline-flex size-11 shrink-0 items-center justify-center text-chad-text-dim transition-colors hover:text-chad-accent"
    >
      <SocialMark mark="x" className="size-4" />
    </a>
  );
}
