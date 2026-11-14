"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gift, Home, Trophy, User } from "lucide-react";

import { claimBadge, claimLabel } from "@/components/drops/claim";
import { CLAIM_DOT, useClaimCount } from "@/components/site/claim-count";
import { useSession } from "@/components/site/SessionProvider";
import { useExtraNav } from "@/lib/extra-nav";
import { homeTap } from "@/lib/home";
import { withExtras } from "@/lib/nav-extra";
import { cn } from "@/lib/utils";

/**
 * home, boards, claim, profile, no `live`. Phone only; desktop has the top menu.
 * Profile goes to your own page when signed in, to sign in when not. The sign in item is a plain
 * link: a Next `<Link>` fetches it in the background first, and the strict CSP refuses the
 * redirect to X.
 * Claim goes to `/claim` signed in or not. Signed in with something to claim now, a mint dot with
 * the number, the front page line's count; the top menu shows the same number.
 */
export function BottomBar({
  claimCount,
}: {
  /** The count to claim; the browser's own read of `GET /api/claims` when absent. */
  claimCount?: number | null;
} = {}) {
  const pathname = usePathname();
  const { profile } = useSession();
  const profileHref = profile ? `/u/${profile.handle}` : "/api/auth/x/start";
  const read = useClaimCount(profile !== null, pathname);
  const count = profile ? (claimCount === undefined ? read : claimCount) : null;
  const badge = count === null ? null : claimBadge(count);

  const extras = useExtraNav();
  const items = withExtras(
    [
      { href: "/", label: "home", icon: Home, active: pathname === "/" },
      { href: "/boards", label: "boards", icon: Trophy, active: pathname.startsWith("/boards") },
      { href: "/claim", label: "claim", icon: Gift, active: pathname.startsWith("/claim") },
      { href: profileHref, label: "profile", icon: User, active: pathname.startsWith("/u/") },
    ],
    extras.map((extra) => ({ ...extra, active: pathname.startsWith(extra.href) })),
  );

  return (
    <nav
      aria-label="bottom bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-chad-border bg-chad-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className={cn("grid h-14", items.length > 4 ? "grid-cols-5" : "grid-cols-4")}>
        {items.map((item) => {
          const Tag = item.href.startsWith("/api/") ? "a" : Link;
          const isClaim = item.label === "claim";
          return (
            <li key={item.label}>
              <Tag
                href={item.href}
                onClick={() => {
                  if (item.href === "/") homeTap(pathname);
                }}
                {...(isClaim ? { "aria-label": claimLabel(count ?? 0) } : {})}
                className={cn(
                  "type-label flex h-full flex-col items-center justify-center gap-0.5 tracking-normal normal-case",
                  item.active ? "text-chad-accent" : "text-chad-text-dim",
                )}
              >
                <span className="relative">
                  <item.icon className="size-5" aria-hidden="true" />
                  {isClaim && badge !== null ? (
                    <span
                      data-claim-count={badge}
                      aria-hidden="true"
                      className={cn(CLAIM_DOT, "absolute -top-1.5 -right-2.5")}
                    >
                      {badge}
                    </span>
                  ) : null}
                </span>
                {item.label}
              </Tag>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
