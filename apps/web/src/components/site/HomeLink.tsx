"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { homeTap } from "@/lib/home";

/** A link to `/` that also brings the front page back to `latest`, page 1, `lib/home.ts`. */
export function HomeLink({
  className,
  children,
  "aria-label": label,
}: {
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const pathname = usePathname();
  return (
    <Link href="/" className={className} aria-label={label} onClick={() => homeTap(pathname)}>
      {children}
    </Link>
  );
}
