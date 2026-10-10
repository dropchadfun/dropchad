/**
 * Create and fund, item 2
 * an example in an empty box must never look like a filled in value.
 * - every input's placeholder is `--chad-text-mute`, never `--chad-text-dim`, one rule in
 *   `components/ui/input.tsx` (and the same in `components/ui/textarea.tsx`, the receivers box)
 * - the refund box shows a hint, never an example address: `paste your Solana wallet address`,
 *   `paste your Robinhood wallet address, 0x…`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initialForm, reduceForm, viewOf } from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
const UI = join(import.meta.dirname, "..", "src", "components", "ui");

describe("item 2: the placeholder colour", () => {
  for (const file of ["input.tsx", "textarea.tsx"]) {
    const source = readFileSync(join(UI, file), "utf8");

    it(`${file}: the placeholder is --chad-text-mute`, () => {
      expect(source).toContain("placeholder:text-chad-text-mute");
    });

    it(`${file}: never the label grey (muted-foreground is --chad-text-dim)`, () => {
      expect(source).not.toContain("placeholder:text-muted-foreground");
    });
  }
});

describe("item 2: the refund box hint", () => {
  it("on Solana: paste your Solana wallet address", () => {
    const state = reduceForm(initialForm(pills), { type: "chain", key: "solana" });
    expect(viewOf(state, pills).refundPlaceholder).toBe("paste your Solana wallet address");
  });

  it("on Robinhood: paste your Robinhood wallet address, 0x…", () => {
    const state = reduceForm(initialForm(pills), { type: "chain", key: "robinhood" });
    expect(viewOf(state, pills).refundPlaceholder).toBe("paste your Robinhood wallet address, 0x…");
  });

  it("never an example address", () => {
    for (const key of ["solana", "robinhood"]) {
      const state = reduceForm(initialForm(pills), { type: "chain", key });
      const hint = viewOf(state, pills).refundPlaceholder;
      expect(hint.startsWith("paste your ")).toBe(true);
      expect(hint).not.toMatch(/^(G5wp|0x)/);
    }
  });
});

describe("item 2 follow up: the refund hint in the normal font", () => {
  // after the Chrome check: the hint is a sentence, so Inter; a typed address
  // stays mono.
  const page = readFileSync(
    join(import.meta.dirname, "..", "src", "components", "create", "CreateDrop.tsx"),
    "utf8",
  );
  const refundBox = /id="refund"[\s\S]*?className="([^"]*)"/.exec(page)?.[1] ?? "";

  it("a typed address stays mono", () => {
    expect(refundBox.split(" ")).toContain("font-mono");
  });

  it("the hint is the normal font", () => {
    expect(refundBox.split(" ")).toContain("placeholder:font-sans");
  });
});
