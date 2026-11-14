/**
 * The social links, one config place. The footer reads them from here,
 * never from its own file. An empty href means a plain icon, not a link.
 */
import { describe, expect, it } from "vitest";

import { SOCIAL_LINKS, socialLinks } from "@/lib/social";

describe("SOCIAL_LINKS", () => {
  it("has GitHub, X, Telegram and YouTube set", () => {
    const byKey = Object.fromEntries(SOCIAL_LINKS.map((link) => [link.key, link.href]));
    expect(byKey).toEqual({
      github: "https://github.com/dropchadfun/dropchad",
      x: "https://x.com/dropchadfun",
      telegram: "https://t.me/dropchad",
      youtube: "https://www.youtube.com/@dropchad",
    });
  });

  it("keeps GitHub, X, Telegram, YouTube in that order", () => {
    expect(SOCIAL_LINKS.map((link) => link.key)).toEqual(["github", "x", "telegram", "youtube"]);
  });

  it("labels YouTube for a screen reader like the others", () => {
    expect(SOCIAL_LINKS.find((link) => link.key === "youtube")?.label).toBe("dropchad on YouTube");
  });

  it("only ever links over https", () => {
    for (const link of SOCIAL_LINKS) {
      if (link.href) expect(link.href).toMatch(/^https:\/\//);
    }
  });
});

describe("socialLinks", () => {
  it("keeps every entry, an empty href included: that one shows as a plain icon", () => {
    expect(socialLinks().map((link) => link.key)).toEqual(["github", "x", "telegram", "youtube"]);
  });
});
