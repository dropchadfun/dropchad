import Link from "next/link";
import type { ReactNode } from "react";

import { Section } from "@/components/site/Section";
import { DROP_CAPS } from "@/lib/beta";

/** One card: a small title and its lines, one idea per line. */
export interface TrustSection {
  readonly title: string;
  readonly lines: readonly ReactNode[];
}

const LINK = "text-chad-accent hover:text-chad-accent-hover hover:underline";

/**
 * Mainnet only: in place of `testnet only` on
 * `/terms` and `/about`, the same words on both. The words since; the
 * caps from `lib/beta.ts`, shared with `/create`.
 */
export const BETA_SECTIONS: readonly TrustSection[] = [
  {
    title: "beta",
    lines: [
      "dropchad is in beta. the code is new and it can have bugs.",
      "each drop has a limit, so less money is at risk while the code is new.",
      "you use dropchad at your own risk.",
      "drops use real coins. only drop what you are ok to lose.",
    ],
  },
  {
    title: "caps per drop",
    lines: [
      `in the beta one drop can hold at most ${DROP_CAPS}.`,
      "other tokens have no value cap.",
      "a drop over the cap is refused when you make it.",
    ],
  },
];

/**
 * The trust pages, `/about`, `/terms`, `/privacy`, `/contact`
 * The `/how` look: one column of 640px, one `h1`, a card per section.
 */
export function TrustPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro?: ReactNode;
  sections: readonly TrustSection[];
}) {
  return (
    <main className="mx-auto w-full max-w-160 px-4 pt-6 pb-10 md:pt-10">
      <h1 className="type-h1">{title}</h1>
      {intro === undefined ? null : <p className="type-body mt-3 text-chad-text-dim">{intro}</p>}
      {sections.map((section) => (
        <Section key={section.title} title={section.title}>
          <div className="card divide-y divide-chad-border">
            {section.lines.map((line, i) => (
              <p key={i} className="type-body px-4 py-3">
                {line}
              </p>
            ))}
          </div>
        </Section>
      ))}
    </main>
  );
}

/** A link off the site: mint, a new tab. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

/** A link on the site, or a `mailto:`: mint, the same tab. */
export function InLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith("/") ? (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  ) : (
    <a href={href} className={LINK}>
      {children}
    </a>
  );
}
