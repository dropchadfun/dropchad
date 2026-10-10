/**
 * The X link: the X logo next to the name on the profile page
 * and next to the sender on the drop page. It opens that person's X account in a new tab. Never
 * on drop rows or board rows. Rendered with `react-dom/server`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import { DropRows } from "@/components/drops/DropRows";
import { XLink } from "@/components/site/XLink";
import type { BoardRow, Profile } from "@/lib/api";
import { xProfileUrl } from "@/lib/social";

const SRC = join(__dirname, "..", "src");

const sample: Profile = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: null,
  kind: "chad",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
};

describe("the X link", () => {
  it("is the person's X page", () => {
    expect(xProfileUrl("samplechad")).toBe("https://x.com/samplechad");
    expect(xProfileUrl("@samplechad")).toBe("https://x.com/samplechad");
  });

  it("opens in a new tab, with a name a screen reader can say", () => {
    const html = renderToStaticMarkup(<XLink handle="samplechad" />);
    expect(html).toContain('href="https://x.com/samplechad"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="@samplechad on X"');
    expect(html).toContain("<svg");
  });

  it("sits next to the name on the profile page", () => {
    const page = readFileSync(join(SRC, "app", "u", "[handle]", "page.tsx"), "utf8");
    expect(page).toContain("<XLink handle={profile.handle}");
  });

  it("sits next to the sender on the drop page, live and finished", () => {
    for (const file of ["LiveView.tsx", "AfterView.tsx"]) {
      const src = readFileSync(join(SRC, "components", "drops", file), "utf8");
      expect(src, file).toContain("<XLink handle={creator.handle}");
    }
  });

  it("is never on a drop row; every board row has it", () => {
    const rows = renderToStaticMarkup(
      <DropRows
        rows={[
          {
            address: "0x1111111111111111111111111111111111110001",
            chainId: 46630,
            title: "gm",
            imageUrl: null,
            creator: sample,
            chip: "LIVE",
            amountWei: "1",
            receivers: 1,
            claimed: 0,
            createdAt: 1,
          },
        ]}
      />,
    );
    expect(rows).not.toContain("x.com");
    const board: BoardRow = {
      rank: 1,
      profile: sample,
      totalWei: "1",
      dropCount: 1,
      claimCount: 1,
      uniqueReceivers: 1,
      biggestDropWei: "1",
      lastDropAt: 1,
      usd: 0,
      byChain: [],
    };
    expect(renderToStaticMarkup(<BoardRows rows={[board]} />)).toContain(
      'href="https://x.com/samplechad"',
    );
  });
});
