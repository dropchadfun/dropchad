/**
 * The lines of a drop, `drop-lines.ts`. Never an invented title.
 */
import { describe, expect, it } from "vitest";

import type { DropCardData } from "@/components/drops/drop-card-data";
import { dropLines, factsLine, linesOfCard } from "@/components/drops/drop-lines";
import type { Profile } from "@/lib/api";

const NOW = 1_700_000_000_000;
const TWO_HOURS_AGO = NOW / 1000 - 2 * 3600;
const sample: Profile = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: null,
  kind: "kol",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
};

const card = (patch: Partial<DropCardData>): DropCardData => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  title: null,
  imageUrl: null,
  creator: sample,
  chip: "DONE",
  amountWei: "300000000000000",
  receivers: 3,
  claimed: 3,
  createdAt: TWO_HOURS_AGO,
  ...patch,
});

describe("linesOfCard, rows and cards", () => {
  it("shows the title first and the sender second, no kind word", () => {
    expect(linesOfCard(card({ title: "gm trenches" }))).toEqual({
      first: "gm trenches",
      sender: { handle: "samplechad" },
    });
  });

  it("names the asset when there is no title, never the amount, chain or age", () => {
    expect(linesOfCard(card({})).first).toBe("ETH drop");
    expect(linesOfCard(card({ chainId: 103 })).first).toBe("SOL drop");
  });

  it("has no sender when nobody is known", () => {
    expect(linesOfCard(card({ creator: null })).sender).toBeNull();
  });

  it("never invents a chad move", () => {
    for (const c of [card({}), card({ creator: null }), card({ title: "x" })]) {
      expect(linesOfCard(c).first).not.toContain("chad");
    }
  });
});

describe("factsLine, the phone row's grey line", () => {
  it("is people, claimed and age, dot separated", () => {
    expect(factsLine(card({}), NOW)).toBe("3 people · 100% claimed · 2h ago");
    expect(factsLine(card({ receivers: 840, claimed: 0 }), NOW)).toBe(
      "840 people · 0% claimed · 2h ago",
    );
  });

  it("says person for one, and reads the age against the clock it is given", () => {
    expect(factsLine(card({ receivers: 1, claimed: 1, createdAt: NOW / 1000 - 30 }), NOW)).toBe(
      "1 person · 100% claimed · just now",
    );
  });

  it("never says wallet: the rows list handle drops only", () => {
    expect(factsLine(card({}), NOW)).not.toContain("wallet");
  });
});

describe("dropLines, the drop page headline", () => {
  const base = {
    title: null,
    handle: "samplechad",
    amountWei: "300000000000000",
    chainId: 46630,
    createdAt: TWO_HOURS_AGO,
    finished: true,
  };

  it("keeps a title and hands the second line to the sender", () => {
    expect(dropLines({ ...base, title: "gm trenches" }, NOW)).toEqual({
      first: "gm trenches",
      second: { kind: "sender" },
    });
  });

  it("says what happened when there is no title, then the chain and the age", () => {
    expect(dropLines(base, NOW)).toEqual({
      first: "samplechad dropped 0.0003 ETH",
      second: { kind: "meta", text: "Robinhood test · 2h ago" },
    });
  });

  it("uses the present tense until the drop is finished", () => {
    expect(dropLines({ ...base, finished: false }, NOW).first).toBe(
      "samplechad is dropping 0.0003 ETH",
    );
  });

  it("keeps the sender slot when there is no sender", () => {
    expect(dropLines({ ...base, handle: null }, NOW)).toEqual({
      first: "dropped 0.0003 ETH",
      second: { kind: "sender" },
    });
  });

  it("speaks SOL on solana and skips the age when nobody knows it", () => {
    expect(
      dropLines({ ...base, amountWei: "3000000", chainId: 103, createdAt: null }, NOW),
    ).toEqual({
      first: "samplechad dropped 0.003 SOL",
      second: { kind: "meta", text: "Solana test" },
    });
  });
});
