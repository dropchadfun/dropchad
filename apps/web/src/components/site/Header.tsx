"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";

import { claimBadge, claimLabel } from "@/components/drops/claim";
import { Avatar } from "@/components/site/Avatar";
import { CLAIM_DOT, useClaimCount } from "@/components/site/claim-count";
import { useSession } from "@/components/site/SessionProvider";
import { SocialLinks } from "@/components/site/SocialIcons";
import { Wordmark } from "@/components/site/Wordmark";
import { useDismiss } from "@/lib/dismiss";
import { useExtraNav } from "@/lib/extra-nav";
import { homeTap } from "@/lib/home";
import { withExtras } from "@/lib/nav-extra";
import { cn } from "@/lib/utils";

/**
 * The desktop menu: home, boards, `drop`, `claim`. The phone bottom bar has
 * `claim` too. `how it works` last; on the
 * phone it is in the footer. No `live`: the `live` tab under drops is the way
 * to it.
 */
export const NAV = [
  { href: "/", label: "home" },
  { href: "/boards", label: "boards" },
  { href: "/create", label: "drop" },
  { href: "/claim", label: "claim" },
  { href: "/how", label: "how it works" },
] as const;

/**
 * The top bar, the axiom take: 48px, thin, the wordmark left with the menu
 * in the same row, sign in on the right with the social icons before it on desktop. On phone the
 * menu is the bottom bar and the icons are in the footer.
 * `claim` carries the bottom bar's mint number, the same count from the same read.
 */
export function Header({
  claimCount,
}: {
  /** The count to claim; the browser's shared read of `GET /api/claims` when absent. */
  claimCount?: number | null;
} = {}) {
  const extras = useExtraNav();
  const pathname = usePathname();
  const { profile, logout } = useSession();
  const read = useClaimCount(Boolean(profile), pathname);
  const count = profile ? (claimCount === undefined ? read : claimCount) : null;
  const badge = count === null ? null : claimBadge(count);
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A click or tap outside, Escape, or the avatar again closes it.
  useDismiss(menu, box, setMenu);

  return (
    <header className="sticky top-0 z-30 border-b border-chad-border bg-chad-bg/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-(--container-content) items-center gap-6 px-4">
        <Wordmark />

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="main">
          {withExtras(NAV, extras).map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const isClaim = item.href === "/claim";
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (item.href === "/") homeTap(pathname);
                }}
                {...(isClaim ? { "aria-label": claimLabel(count ?? 0) } : {})}
                className={cn(
                  "interactive type-body flex h-8 items-center rounded-md px-2.5 font-medium",
                  active ? "text-chad-text" : "text-chad-text-dim hover:text-chad-text",
                )}
              >
                {item.label}
                {isClaim && badge !== null ? (
                  <span
                    data-claim-count={badge}
                    aria-hidden="true"
                    className={cn(CLAIM_DOT, "ml-1.5")}
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto flex items-center gap-3">
          <SocialLinks placement="header" />
          {profile === undefined ? (
            <span className="skeleton size-7 rounded-full" aria-hidden="true" />
          ) : profile === null ? (
            <a href="/api/auth/x/start" className="btn btn-x h-8 px-3">
              sign in with X
            </a>
          ) : (
            <div ref={box} className="relative">
              <button
                type="button"
                onClick={() => setMenu((open) => !open)}
                aria-expanded={menu}
                aria-haspopup="menu"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full"
              >
                <Avatar src={profile.profileImageUrl} name={profile.handle} size={28} />
                <span className="sr-only">account menu</span>
              </button>
              {menu ? (
                <div
                  role="menu"
                  className="card type-body absolute top-11 right-0 w-48 bg-chad-surface-2 p-1"
                >
                  <Link
                    role="menuitem"
                    href={`/u/${profile.handle}`}
                    onClick={() => setMenu(false)}
                    className="interactive block min-h-11 rounded-md px-3 py-2 hover:bg-chad-surface"
                  >
                    <span className="block font-medium">@{profile.handle}</span>
                    <span className="type-small block text-chad-text-dim">your drops</span>
                  </Link>
                  {/* the sender's own multisends, only to them. */}
                  <Link
                    role="menuitem"
                    href="/multisends"
                    onClick={() => setMenu(false)}
                    className="interactive flex min-h-11 items-center rounded-md px-3 py-2 hover:bg-chad-surface"
                  >
                    your multisends
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      void logout();
                    }}
                    className="interactive flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-chad-text-dim hover:bg-chad-surface hover:text-chad-text"
                  >
                    <LogOut className="size-4" aria-hidden="true" /> log out
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
