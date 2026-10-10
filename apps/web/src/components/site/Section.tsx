import Link from "next/link";
import type { ReactNode } from "react";

/** A titled block.: 24 between sections on phone, 32 on desktop. Small calm title. */
export function Section({
  id,
  title,
  aside,
  children,
}: {
  id?: string;
  title: ReactNode;
  /** A small link on the right: "all boards". */
  aside?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-6 md:mt-8">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="type-h2">{title}</h2>
        {aside ? (
          <Link
            href={aside.href}
            className="interactive type-small -mr-2 flex min-h-11 items-center rounded-lg px-2 text-chad-text-dim hover:bg-transparent hover:text-chad-text"
          >
            {aside.label} →
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
