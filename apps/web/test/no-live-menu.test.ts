/**
 * No `live` in the top menu or the phone bottom bar (
 * and 9). The `live` tab under drops stays, and `/#live` still opens it, so old links work.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tabFromHash } from "@/components/front/drop-tabs";
import { NAV } from "@/components/site/Header";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("no live in the menus", () => {
  it("the desktop menu has no live and no /#live link", () => {
    expect(NAV.map((item) => item.label)).not.toContain("live");
    expect(NAV.map((item) => item.href)).not.toContain("/#live");
  });

  it("the bottom bar is home, boards, profile, three columns", () => {
    const src = read("components/site/BottomBar.tsx");
    const labels = [...src.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["home", "boards", "profile"]);
    expect(src).not.toContain("/#live");
    expect(src).toContain("grid-cols-3");
    expect(src).not.toContain("grid-cols-4");
  });
});

describe("/#live still opens the live tab", () => {
  it("the drops section keeps id live and the hash picks the live tab", () => {
    expect(read("components/front/FrontPage.tsx")).toContain('<Section id="live" title="drops">');
    expect(tabFromHash("#live")).toBe("live");
  });

  it("the empty claim list still links to /#live", () => {
    expect(read("components/drops/ClaimView.tsx")).toContain('href="/#live"');
  });
});
