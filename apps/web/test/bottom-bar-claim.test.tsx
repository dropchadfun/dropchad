/**
 * `claim` in the phone bottom bar: home, boards, claim,
 * profile, four even columns, the lucide `Gift` icon. It goes to `/claim` signed in or not.
 * Signed in with something to claim now, a small mint dot on the icon with the number, the same
 * count as the front page line `you got dropped. 3 to claim →`: `claimable` or `failed`. `9+`
 * above 9. The link's name says the count. `claimCount` stands in for the browser's own read of
 * `GET /api/claims`, which never runs in the server HTML.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimBadge, claimLabel, frontLine, openClaimCount } from "@/components/drops/claim";
import type { ClaimItem } from "@/components/drops/claim";
import { BottomBar } from "@/components/site/BottomBar";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));
const nav = { pathname: "/" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const session = { profile: null as { handle: string } | null };
vi.mock("@/components/site/SessionProvider", () => ({ useSession: () => session }));

const SRC = join(__dirname, "..", "src");

const item = (state: ClaimItem["state"]): ClaimItem => ({
  drop: "0x00000000000000000000000000000000000d0b01",
  chainKey: "robinhood-testnet",
  chainId: 46630,
  title: null,
  sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
  amount: "500000000000000000",
  symbol: "ETH",
  decimals: 18,
  index: 0,
  claimDeadline: "1791806400",
  state,
  recipient: null,
  claimTxHash: null,
});

const bar = (claimCount?: number | null) =>
  renderToStaticMarkup(
    claimCount === undefined ? <BottomBar /> : <BottomBar claimCount={claimCount} />,
  );

/** The `<a …>…</a>` of the bar item whose href is `href`. */
function itemTo(html: string, href: string): string {
  const match = [...html.matchAll(/<a [^>]*>.*?<\/a>/g)]
    .map((m) => m[0])
    .find((a) => a.includes(`href="${href}"`));
  return match ?? "";
}

const BADGE = /data-claim-count="[^"]*"[^>]*>([^<]+)</;

beforeEach(() => {
  session.profile = null;
  nav.pathname = "/";
});

describe("the count, the same as the front page line", () => {
  it("counts claimable and failed only", () => {
    const claims = [
      item("claimable"),
      item("failed"),
      item("paid"),
      item("paused"),
      item("claimable"),
    ];
    expect(openClaimCount(claims)).toBe(3);
    expect(frontLine(claims)).toBe("you got dropped. 3 to claim →");
    expect(openClaimCount([item("paid")])).toBe(0);
    expect(openClaimCount([])).toBe(0);
  });

  it("the dot: nothing at 0, the number up to 9, 9+ above", () => {
    expect(claimBadge(0)).toBeNull();
    expect(claimBadge(1)).toBe("1");
    expect(claimBadge(9)).toBe("9");
    expect(claimBadge(10)).toBe("9+");
    expect(claimBadge(42)).toBe("9+");
  });

  it("the link's name says the count", () => {
    expect(claimLabel(0)).toBe("claim");
    expect(claimLabel(3)).toBe("claim, 3 to claim");
    expect(claimLabel(12)).toBe("claim, 12 to claim");
  });
});

describe("the bar: home, boards, claim, profile", () => {
  it("four items in order, four even columns", () => {
    const html = bar();
    const labels = [...html.matchAll(/>([a-z]+)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(["home", "boards", "claim", "profile"]);
    expect(html).toContain("grid-cols-4");
    expect(html).not.toContain("grid-cols-3");
  });

  it("claim has the Gift icon and the same classes as boards", () => {
    const html = bar();
    const claim = itemTo(html, "/claim");
    expect(claim).toContain("lucide-gift");
    const cls = (a: string) => /class="([^"]*)"/.exec(a)?.[1];
    expect(cls(claim)).toBe(cls(itemTo(html, "/boards")));
  });

  it("signed out: claim still shows, a Next link to /claim, no dot", () => {
    const claim = itemTo(bar(), "/claim");
    expect(claim).toContain("data-next-link");
    expect(claim).not.toMatch(BADGE);
    expect(claim).toContain('aria-label="claim"');
  });

  it("signed out: no dot even if a count were known", () => {
    expect(itemTo(bar(3), "/claim")).not.toMatch(BADGE);
  });

  it("mint on /claim", () => {
    nav.pathname = "/claim";
    expect(itemTo(bar(), "/claim")).toContain("text-chad-accent");
    expect(itemTo(bar(), "/boards")).toContain("text-chad-text-dim");
  });
});

describe("signed in: the mint dot with the number", () => {
  beforeEach(() => {
    session.profile = { handle: "samplechad" };
  });

  it("0 to claim: no dot, the plain name", () => {
    const claim = itemTo(bar(0), "/claim");
    expect(claim).not.toMatch(BADGE);
    expect(claim).toContain('aria-label="claim"');
  });

  it("3 to claim: the dot says 3, the name says it too", () => {
    const claim = itemTo(bar(3), "/claim");
    expect(BADGE.exec(claim)?.[1]).toBe("3");
    expect(claim).toContain('aria-label="claim, 3 to claim"');
    expect(claim).toMatch(/data-claim-count="3"[^>]*class="[^"]*bg-chad-accent[^"]*text-chad-bg/);
  });

  it("12 to claim: the dot says 9+", () => {
    expect(BADGE.exec(itemTo(bar(12), "/claim"))?.[1]).toBe("9+");
  });

  it("the read failed or not back yet: no dot", () => {
    expect(itemTo(bar(null), "/claim")).not.toMatch(BADGE);
    expect(itemTo(bar(), "/claim")).not.toMatch(BADGE);
  });
});

describe("the read", () => {
  it("the bar reads GET /api/claims itself, and again after leaving /claim", () => {
    const src = readFileSync(join(SRC, "components", "site", "BottomBar.tsx"), "utf8");
    expect(src).toContain("getClaims()");
    expect(src).toContain("openClaimCount(");
    expect(src).toMatch(/leftClaim|left \/claim|"\/claim"/);
  });

  it("the desktop menu comment no longer says three items", () => {
    const src = readFileSync(join(SRC, "components", "site", "Header.tsx"), "utf8");
    expect(src).not.toContain("stays three items");
  });
});
