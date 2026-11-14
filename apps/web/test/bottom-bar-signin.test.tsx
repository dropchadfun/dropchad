/**
 * The bottom bar's sign in item.
 * Signed out, `profile` goes to `/api/auth/x/start`. That must be a plain link: a Next `<Link>`
 * fetches it in the background first, the redirect to X is refused by `connect-src 'self'`, and
 * the api gets two login starts for one tap. Signed in, the own profile stays a Next `<Link>`.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BottomBar } from "@/components/site/BottomBar";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const session = { profile: null as { handle: string } | null };
vi.mock("@/components/site/SessionProvider", () => ({ useSession: () => session }));

function linkTo(html: string, href: string): string | undefined {
  return [...html.matchAll(/<a [^>]*>/g)]
    .map((m) => m[0])
    .find((a) => a.includes(`href="${href}"`));
}

describe("the bottom bar sign in item", () => {
  it("signed out, profile is a plain link to the X login start", () => {
    session.profile = null;
    const link = linkTo(renderToStaticMarkup(<BottomBar />), "/api/auth/x/start");
    expect(link).toBeDefined();
    expect(link).not.toContain("data-next-link");
  });

  it("signed in, the own profile stays a Next link", () => {
    session.profile = { handle: "samplechad" };
    const link = linkTo(renderToStaticMarkup(<BottomBar />), "/u/samplechad");
    expect(link).toContain("data-next-link");
  });

  it("home and boards stay Next links", () => {
    session.profile = null;
    const html = renderToStaticMarkup(<BottomBar />);
    expect(linkTo(html, "/")).toContain("data-next-link");
    expect(linkTo(html, "/boards")).toContain("data-next-link");
  });
});
