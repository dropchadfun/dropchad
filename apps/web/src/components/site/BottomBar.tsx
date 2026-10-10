"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Trophy, User } from "lucide-react";

import { useSession } from "@/components/site/SessionProvider";
import { homeTap } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * home, boards, profile, no `live`. Phone only; desktop
 * has the top menu.
 * Profile goes to your own page when signed in, to sign in when not.
 */
export function BottomBar() {
  const pathname = usePathname();
  const { profile } = useSession();
  const profileHref = profile ? `/u/${profile.handle}` : "/api/auth/x/start";

  const items = [
    { href: "/", label: "home", icon: Home, active: pathname === "/" },
    { href: "/boards", label: "boards", icon: Trophy, active: pathname.startsWith("/boards") },
    { href: profileHref, label: "profile", icon: User, active: pathname.startsWith("/u/") },
  ] as const;

  return (
    <nav
      aria-label="bottom bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-chad-border bg-chad-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-14 grid-cols-3">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              onClick={() => {
                if (item.href === "/") homeTap(pathname);
              }}
              className={cn(
                "type-label flex h-full flex-col items-center justify-center gap-0.5 tracking-normal normal-case",
                item.active ? "text-chad-accent" : "text-chad-text-dim",
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
