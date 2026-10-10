/**
 * `/#live` opens the live tab once, then the address goes back to plain `/` (,
 * ). A tab tap never changes the address. The logo and `home` always land on
 * plain `/` on `latest`, page 1, also when already on the front page; the chain choice is kept.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("/#live opens live once, then the address is plain", () => {
  it("only #live is cleared, the path and query kept", async () => {
    const { urlWithoutLiveHash } = await import("@/components/front/drop-tabs");
    expect(urlWithoutLiveHash("/", "", "#live")).toBe("/");
    expect(urlWithoutLiveHash("/", "?ref=x", "#live")).toBe("/?ref=x");
    expect(urlWithoutLiveHash("/", "", "")).toBeNull();
    expect(urlWithoutLiveHash("/", "", "#other")).toBeNull();
  });

  it("the front page opens live, then replaces the address without the hash", () => {
    const src = read("components/front/FrontPage.tsx");
    expect(src).toMatch(
      /if \(tabFromHash\(window\.location\.hash\) === "live"\) setTab\("live"\);[\s\S]{0,400}urlWithoutLiveHash\([\s\S]{0,200}window\.history\.replaceState\(/,
    );
  });

  it("a tab tap never touches the address", () => {
    const src = read("components/front/FrontPage.tsx");
    const tabs = src.slice(src.indexOf('<Tabs label="drops">'), src.indexOf("</Tabs>"));
    expect(tabs).not.toBe("");
    expect(tabs).not.toMatch(/history|location|router|href/);
  });
});

describe("the logo and home always land on latest, page 1", () => {
  it("homeTap signals the front page only when already on /", async () => {
    const { HOME_EVENT, homeTap } = await import("@/lib/home");
    const target = new EventTarget();
    let heard = 0;
    target.addEventListener(HOME_EVENT, () => (heard += 1));
    homeTap("/", target);
    expect(heard).toBe(1);
    homeTap("/boards", target);
    homeTap("/u/sample", target);
    expect(heard).toBe(1);
  });

  it("the front page goes back to latest and page 1, the chain choice kept", () => {
    const src = read("components/front/FrontPage.tsx");
    const handler = src.match(/const home = \(\) => \{([\s\S]*?)\};/)?.[1] ?? "";
    expect(handler).toMatch(/setTab\("latest"\);\s*setPage\(1\);/);
    expect(handler).not.toContain("setSelection");
    expect(src).toContain("window.addEventListener(HOME_EVENT, home)");
    expect(src).toContain("window.removeEventListener(HOME_EVENT, home)");
  });

  it("the logo is a HomeLink, a link to / that calls homeTap", () => {
    expect(existsSync(join(SRC, "components/site/HomeLink.tsx"))).toBe(true);
    const link = read("components/site/HomeLink.tsx");
    expect(link).toContain('href="/"');
    expect(link).toContain("homeTap(pathname)");
    expect(read("components/site/Wordmark.tsx")).toMatch(
      /<HomeLink[^>]*aria-label="dropchad home"/,
    );
  });

  it("home in the top menu and in the bottom bar calls homeTap", () => {
    expect(read("components/site/Header.tsx")).toContain("homeTap(pathname)");
    expect(read("components/site/BottomBar.tsx")).toContain("homeTap(pathname)");
  });
});
