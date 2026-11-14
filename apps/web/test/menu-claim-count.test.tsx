/**
 * `claim` in the desktop top menu shows the same small mint number as `claim` in
 * the phone bottom bar, the same count from the same source, only when signed in and above 0.
 * One read of `GET /api/claims` per page load feeds both menus. `claimCount` stands in for the
 * browser's own read, which never runs in the server HTML.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BottomBar } from "@/components/site/BottomBar";
import { Header } from "@/components/site/Header";
import type * as Api from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));
const nav = { pathname: "/" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const session = {
  profile: null as { handle: string; profileImageUrl: string | null } | null,
  logout: () => Promise.resolve(),
};
vi.mock("@/components/site/SessionProvider", () => ({ useSession: () => session }));

const getClaims = vi.fn();
vi.mock("@/lib/api", async (real) => ({
  ...(await real<typeof Api>()),
  getClaims: () => getClaims() as unknown,
}));

const SRC = join(__dirname, "..", "src");
const BADGE = /data-claim-count="[^"]*"[^>]*>([^<]+)</;

const header = (claimCount?: number | null) =>
  renderToStaticMarkup(claimCount === undefined ? <Header /> : <Header claimCount={claimCount} />);

/** The `<a …>…</a>` whose href is `href`. */
function linkTo(html: string, href: string): string {
  const match = [...html.matchAll(/<a [^>]*>.*?<\/a>/g)]
    .map((m) => m[0])
    .find((a) => a.includes(`href="${href}"`));
  return match ?? "";
}

/** The class of the number itself. */
const dotClass = (html: string) => /data-claim-count="[^"]*"[^>]*class="([^"]*)"/.exec(html)?.[1];

beforeEach(() => {
  session.profile = null;
  nav.pathname = "/";
});

describe("the top menu: the number on claim", () => {
  it("signed out: no number, the plain name", () => {
    const claim = linkTo(header(3), "/claim");
    expect(claim).not.toMatch(BADGE);
    expect(claim).toContain('aria-label="claim"');
  });

  describe("signed in", () => {
    beforeEach(() => {
      session.profile = { handle: "samplechad", profileImageUrl: null };
    });

    it("0, not read yet or a failed read: no number", () => {
      expect(linkTo(header(0), "/claim")).not.toMatch(BADGE);
      expect(linkTo(header(null), "/claim")).not.toMatch(BADGE);
      expect(linkTo(header(), "/claim")).not.toMatch(BADGE);
    });

    it("3 to claim: the number 3, and the link's name says it", () => {
      const claim = linkTo(header(3), "/claim");
      expect(BADGE.exec(claim)?.[1]).toBe("3");
      expect(claim).toContain('aria-label="claim, 3 to claim"');
      expect(claim).toContain(">claim<");
    });

    it("12 to claim: 9+", () => {
      expect(BADGE.exec(linkTo(header(12), "/claim"))?.[1]).toBe("9+");
    });

    it("only on claim, never on another item", () => {
      const html = header(3);
      expect(html.match(/data-claim-count=/g)).toHaveLength(1);
      expect(linkTo(html, "/boards")).not.toMatch(BADGE);
    });

    it("the same mint number as the phone bar", () => {
      const top = dotClass(linkTo(header(3), "/claim"));
      const phone = dotClass(renderToStaticMarkup(<BottomBar claimCount={3} />));
      expect(top).toContain("bg-chad-accent");
      expect(top).toContain("text-chad-bg");
      expect(top).toContain("rounded-full");
      const shape = (cls: string | undefined) =>
        (cls ?? "")
          .split(/\s+/)
          .filter((c) => !/^(absolute|-?top-|-?right-|ml-)/.test(c))
          .sort();
      expect(shape(top)).toEqual(shape(phone));
    });
  });
});

describe("one read for both menus", () => {
  beforeEach(() => {
    vi.resetModules();
    getClaims.mockReset();
  });

  it("two asks in the same page load read GET /api/claims once, the same count", async () => {
    getClaims.mockResolvedValue({
      claims: [{ state: "claimable" }, { state: "retry" }, { state: "paid" }],
      unavailable: [],
      freshLoginSecondsLeft: 0,
    });
    const { claimCountRead } = await import("@/components/site/claim-count");
    const [a, b] = await Promise.all([claimCountRead(0), claimCountRead(0)]);
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(a).toBe(2);
    expect(b).toBe(2);
  });

  it("a failed read is no number", async () => {
    getClaims.mockRejectedValue(new Error("down"));
    const { claimCountRead } = await import("@/components/site/claim-count");
    expect(await claimCountRead(0)).toBeNull();
  });

  it("leaving /claim reads again once, however many menus see it", async () => {
    const { routeGeneration } = await import("@/components/site/claim-count");
    expect(routeGeneration("/")).toBe(0);
    expect(routeGeneration("/claim")).toBe(0);
    // Both menus see the same new path: one new read, not two.
    expect(routeGeneration("/boards")).toBe(1);
    expect(routeGeneration("/boards")).toBe(1);
    expect(routeGeneration("/claim?drop=x")).toBe(1);
    expect(routeGeneration("/")).toBe(2);
  });

  it("both menus take the shared read; neither calls the api itself", () => {
    const shared = readFileSync(join(SRC, "components", "site", "claim-count.ts"), "utf8");
    expect(shared).toContain("getClaims()");
    expect(shared).toContain("openClaimCount(");
    for (const file of ["Header.tsx", "BottomBar.tsx"]) {
      const src = readFileSync(join(SRC, "components", "site", file), "utf8");
      expect(src).toContain("useClaimCount(");
      expect(src).not.toContain("getClaims");
    }
  });
});
