/**
 * The profile's `received` list (
 * ). A section under `drops`, the same rows as the wall: the sender's picture, the
 * title, `from @sender`, the main tag pill; right, the amount received and the age. No
 * receivers, claimed or state column, every row is paid. No usd. Empty: `nothing received
 * yet.` A chain that cannot be read: skeleton rows, never a guess. No fourth tile.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReceivedRows } from "@/components/profile/ReceivedRows";
import type { ReceivedItem } from "@/lib/api";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const sender = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "sample chad",
  profileImageUrl: null,
  kind: "chad",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
  streams: [],
} as unknown as ReceivedItem["sender"];

const SOL_DROP = "So1anaDrop1111111111111111111111111111111111";

const solItem: ReceivedItem = {
  address: SOL_DROP,
  chainKey: "solana-devnet",
  title: "gm drop",
  createdAt: "2026-10-12T10:00:00.000Z",
  amount: "100000000",
  token: null,
  sender,
};

const tokenItem: ReceivedItem = {
  address: "0x0000000000000000000000000000000000000701",
  chainKey: "robinhood-testnet",
  title: null,
  createdAt: "2026-10-11T10:00:00.000Z",
  amount: "1000000000",
  token: {
    mint: "0x00000000000000000000000000000000000000a1",
    symbol: "PONS",
    name: "Pons",
    decimals: 6,
    tokenProgram: "erc20",
    logoUrl: "/api/tokens/0x00000000000000000000000000000000000000a1/logo?chain=robinhood",
    launchpad: null,
  },
  sender,
};

const html = (received: Parameters<typeof ReceivedRows>[0]["received"]) =>
  renderToStaticMarkup(<ReceivedRows received={received} />);

describe("ReceivedRows", () => {
  it("one row per paid drop: from @sender, the amount in its coin, a link to the drop", () => {
    const out = html({ available: true, items: [solItem] });
    expect(out).toContain("from @samplechad");
    expect(out).toContain("gm drop");
    expect(out).toMatch(/0\.1\s*(<[^>]+>\s*)*SOL/);
    expect(out).toContain(`href="/d/${SOL_DROP}"`);
  });

  it("a token row is in its token, with its ticker", () => {
    const out = html({ available: true, items: [tokenItem] });
    expect(out).toMatch(/1,000\s*(<[^>]+>\s*)*PONS/);
  });

  it("no usd, no receivers, claimed or state column", () => {
    const out = html({ available: true, items: [solItem, tokenItem] });
    expect(out).not.toContain("$");
    expect(out).not.toContain("in test coins");
    expect(out).not.toMatch(/>receivers</);
    expect(out).not.toMatch(/>claimed</);
    expect(out).not.toMatch(/>state</);
  });

  it("empty: nothing received yet.", () => {
    expect(html({ available: true, items: [] })).toContain("nothing received yet.");
  });

  it("a chain that cannot be read: skeleton rows, never a guess", () => {
    const out = html({ available: false });
    expect(out).toContain("skeleton");
    expect(out).not.toContain("nothing received yet.");
  });
});

describe("the profile page", () => {
  it("puts the received section under drops, and no fourth tile", () => {
    const page = read("app/u/[handle]/page.tsx");
    expect(page).toMatch(/<Section title="drops">[\s\S]*<Section title="received">/);
    expect(page).toContain("<ReceivedRows received={user.received} />");
    expect(page.match(/<Stat\b/g)).toHaveLength(3);
  });
});
