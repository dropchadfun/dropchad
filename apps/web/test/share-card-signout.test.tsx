/**
 * The `your card` section hides at once on sign out, with no reload, and keeps nothing for the
 * next person who signs in on that browser.
 * Before this the card was read once on mount and stayed until a
 * refresh. The real click on sign out is checked in a browser; here, what static markup shows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/api";

const session: { profile: Profile | null | undefined } = { profile: undefined };

vi.mock("@/components/site/SessionProvider", () => ({
  useSession: () => ({
    profile: session.profile,
    streamConnect: { kick: false, twitch: false },
    refresh: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  }),
}));

const { ShareCardSection, shareCardViewer } = await import("@/components/drops/ShareCard");

const ME = { xUserId: "1234", handle: "samplechad" } as Profile;
const DROP = "0x441c39e8d120bce8846d11f4a6908aa0f25e2568";

describe("the your card section and the session", () => {
  beforeEach(() => {
    session.profile = undefined;
  });

  it("has no viewer when signed out or not known yet, and the X id when signed in", () => {
    expect(shareCardViewer(null)).toBeNull();
    expect(shareCardViewer(undefined)).toBeNull();
    expect(shareCardViewer(ME)).toBe("1234");
  });

  it("renders nothing when signed out", () => {
    session.profile = null;
    expect(renderToStaticMarkup(<ShareCardSection address={DROP} live />)).toBe("");
  });

  it("renders nothing while the session is not known yet", () => {
    session.profile = undefined;
    expect(renderToStaticMarkup(<ShareCardSection address={DROP} live />)).toBe("");
  });

  it("starts fresh for every viewer: the card's loader is keyed by the viewer", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/components/drops/ShareCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/useSession\(\)/);
    expect(source).toMatch(/key=\{viewer\}/);
  });
});
