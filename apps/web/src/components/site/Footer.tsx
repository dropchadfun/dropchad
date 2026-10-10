import Link from "next/link";

import { SocialLinks } from "@/components/site/SocialIcons";
import { WordmarkText } from "@/components/site/Wordmark";
import { githubUrl, socialLinks, type SocialLink } from "@/lib/social";

/** The footer's own pages, same tab, in this order: `how it works`, then the trust pages. */
const PAGE_LINKS = [
  { href: "/how", label: "how it works" },
  { href: "/about", label: "about" },
  { href: "/terms", label: "terms" },
  { href: "/privacy", label: "privacy" },
  { href: "/contact", label: "contact" },
] as const;

const TEXT_LINK = "interactive type-small flex min-h-11 items-center hover:text-chad-accent";

/**
 * The site footer. The wordmark small and grey left; on phone the social
 * icons right, on desktop they sit in the top bar instead. The links come from `lib/social`,
 * never from here. The text links, `how it works` and the trust links (
 * ): right of the wordmark on desktop, one line; on phone they wrap under the wordmark
 * line, one line does not fit at 390. `github` opens the public repo in a new tab. On phone it
 * sits above the fixed bottom bar, so it carries that bar's height underneath.
 */
export function Footer({ links = socialLinks() }: { links?: readonly SocialLink[] }) {
  return (
    <footer className="border-t border-chad-border pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto flex w-full max-w-(--container-content) flex-wrap items-center px-4 text-chad-text-dim">
        <span className="flex h-12 items-center">
          <WordmarkText height={14} tone="dim" />
        </span>
        <nav
          aria-label="site"
          className="order-last -mt-2 mb-1 flex w-full flex-wrap gap-x-4 md:order-none md:mt-0 md:mb-0 md:ml-6 md:w-auto md:gap-x-6"
        >
          {PAGE_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={TEXT_LINK}>
              {link.label}
            </Link>
          ))}
          <a href={githubUrl()} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
            github
          </a>
        </nav>
        <SocialLinks links={links} placement="footer" />
      </div>
    </footer>
  );
}
