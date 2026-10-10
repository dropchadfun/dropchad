"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";

import { Avatar } from "@/components/site/Avatar";
import { useSession } from "@/components/site/SessionProvider";
import { SocialLinks } from "@/components/site/SocialIcons";
import { Wordmark } from "@/components/site/Wordmark";
import { useDismiss } from "@/lib/dismiss";
import { homeTap } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * The desktop menu: the phone bottom bar's destinations plus `claim`. The
 * phone bar stays three items; on the phone claim is reached from the front
 * page line, a drop's page and the profile page. `how it works` last; on the
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
 */
export function Header() {
  const pathname = usePathname();
  const { profile, logout } = useSession();
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A click or tap outside, Escape, or the avatar again closes it.
  useDismiss(menu, box, setMenu);

  return (
    <header className="sticky top-0 z-30 border-b border-chad-border bg-chad-bg/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-(--container-content) items-center gap-6 px-4">
        <Wordmark />

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="main">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (item.href === "/") homeTap(pathname);
                }}
                className={cn(
                  "interactive type-body flex h-8 items-center rounded-md px-2.5 font-medium",
                  active ? "text-chad-text" : "text-chad-text-dim hover:text-chad-text",
                )}
              >
                {item.label}
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
