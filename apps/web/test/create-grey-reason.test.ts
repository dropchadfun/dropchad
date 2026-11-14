/**
 * The refund address on step 2. No line under `drop it` or
 * `send it` any more. A refund address in the wrong shape for the chain gets one short red line
 * right under the refund box: `this is not a Solana address.` or `this is not a Robinhood
 * address. it starts with 0x.` An empty box shows nothing. Drop and multisend the same.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  initialForm,
  reduceForm,
  titleForSubmit,
  viewOf,
  type FormAction,
  type FormState,
  type HandlePreview,
} from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills({ testnetSite: true }); // the testnet site pills
const SRC = join(import.meta.dirname, "..", "src");
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;
const bothOn = { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true };

const HANDLES = "@alice 0.01\n@bob 0.02";
const EVM_A = "0x1111111111111111111111111111111111110001";
const SOL_P = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const SOL_Q = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";

const preview = (text: string): HandlePreview => ({
  forText: text,
  found: [
    { handle: "alice", xUserId: "1", displayName: "Alice", profileImageUrl: null },
    { handle: "bob", xUserId: "2", displayName: "Bob", profileImageUrl: null },
  ],
  missing: [],
});

/** A handle drop on step 2, everything ok but the refund box. */
function dropStep2(chain: "solana" | "robinhood", ...more: FormAction[]): FormState {
  return [
    { type: "handleModes", value: bothOn } as const,
    { type: "chain", key: chain } as const,
    { type: "handleText", value: HANDLES } as const,
    { type: "preview", preview: preview(HANDLES) } as const,
    { type: "next" } as const,
    ...more,
  ].reduce(reduceForm, initialForm(pills));
}

/** A multisend on step 2, everything ok but the refund box. */
function multisendStep2(chain: "solana" | "robinhood", ...more: FormAction[]): FormState {
  const list = chain === "solana" ? `${SOL_P} 0.01` : `${EVM_A} 0.0001`;
  return [
    { type: "chain", key: chain } as const,
    { type: "text", value: list } as const,
    { type: "next" } as const,
    ...more,
  ].reduce(reduceForm, initialForm(pills, "multisend"));
}

describe("the refund shape line", () => {
  it("an empty box: the button is grey, no line", () => {
    for (const v of [viewOf(dropStep2("solana"), pills), viewOf(multisendStep2("solana"), pills)]) {
      expect(v.step2Ok).toBe(false);
      expect(v.refundShapeError).toBeNull();
    }
  });

  it("spaces only count as an empty box", () => {
    const v = viewOf(dropStep2("solana", { type: "refund", value: "   " }), pills);
    expect(v.refundShapeError).toBeNull();
  });

  it("an EVM address on Solana says it is not a Solana address", () => {
    const v = viewOf(dropStep2("solana", { type: "refund", value: EVM_A }), pills);
    expect(v.step2Ok).toBe(false);
    expect(v.refundShapeError).toBe("this is not a Solana address.");
  });

  it("a Solana address on Robinhood says it starts with 0x", () => {
    const v = viewOf(dropStep2("robinhood", { type: "refund", value: SOL_Q }), pills);
    expect(v.step2Ok).toBe(false);
    expect(v.refundShapeError).toBe("this is not a Robinhood address. it starts with 0x.");
  });

  it("the same line on a multisend", () => {
    const sol = viewOf(multisendStep2("solana", { type: "refund", value: EVM_A }), pills);
    expect(sol.refundShapeError).toBe("this is not a Solana address.");
    const rh = viewOf(multisendStep2("robinhood", { type: "refund", value: "0x12" }), pills);
    expect(rh.refundShapeError).toBe("this is not a Robinhood address. it starts with 0x.");
  });

  it("a good refund address: the button is on and there is no line", () => {
    const drop = viewOf(dropStep2("solana", { type: "refund", value: SOL_P }), pills);
    expect(drop.step2Ok).toBe(true);
    expect(drop.refundShapeError).toBeNull();

    const multi = viewOf(multisendStep2("robinhood", { type: "refund", value: EVM_A }), pills);
    expect(multi.step2Ok).toBe(true);
    expect(multi.refundShapeError).toBeNull();
  });

  it("the old reason line is gone from the view", () => {
    const v = viewOf(dropStep2("solana"), pills) as unknown as Record<string, unknown>;
    expect(v).not.toHaveProperty("step2Reason");
  });
});

describe("the create page", () => {
  const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
  const form = readFileSync(join(SRC, "components", "create", "form.ts"), "utf8");

  it("draws the shape line in red right under the refund box, inside its field", () => {
    const box = page.indexOf('id="refund"');
    const line = page.indexOf("view.refundShapeError");
    const refundNote = page.indexOf("whatever people do not claim in 3 days");
    expect(box).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(box);
    expect(line).toBeLessThan(refundNote);
    expect(page).toMatch(/view\.refundShapeError[\s\S]{0,200}type-small[^"]*text-chad-error/);
  });

  it("no line under the buttons, and the old texts are gone", () => {
    expect(page).not.toContain("step2Reason");
    expect(form).not.toContain("step2Reason");
    expect(form).not.toContain("add a refund address to");
  });
});

describe("no title on a multisend multisend mode", () => {
  const page = () => readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");

  it("a multisend sends no title, even one typed in drop mode before the switch", () => {
    expect(titleForSubmit({ mode: "multisend", title: "rent split" })).toBeUndefined();
    expect(titleForSubmit({ mode: "multisend", title: "" })).toBeUndefined();
  });

  it("a drop sends its title as now, trimmed, and none when empty", () => {
    expect(titleForSubmit({ mode: "drop", title: "  drop for chads " })).toBe("drop for chads");
    expect(titleForSubmit({ mode: "drop", title: "   " })).toBeUndefined();
  });

  it("an old long title never holds a multisend back; a drop still checks it", () => {
    const long = { type: "title", value: "x".repeat(81) } as const;
    const multi = viewOf(
      multisendStep2("robinhood", long, { type: "refund", value: EVM_A }),
      pills,
    );
    expect(multi.step2Ok).toBe(true);
    const drop = viewOf(dropStep2("solana", long, { type: "refund", value: SOL_P }), pills);
    expect(drop.step2Ok).toBe(false);
  });

  it("the title field shows on a drop only, the same field as now", () => {
    const src = page();
    expect(src).toMatch(/\{drop \? \(\s*<div>\s*<label htmlFor="title" className="type-label">/);
    expect(src).toContain('placeholder="drop for chads"');
    expect(src).toContain("maxLength={80}");
    expect(src.match(/id="title"/g)).toHaveLength(1);
  });

  it("the submit takes the title from titleForSubmit only", () => {
    const src = page();
    expect(src).toContain("titleForSubmit(form)");
    expect(src).not.toMatch(/title\.trim\(\) \? \{ title: title\.trim\(\) \}/);
  });
});
