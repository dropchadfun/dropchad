/**
 * Create and fund, item 1: when `drop it` (or `send
 * it`) is grey on step 2, one grey `small` line under the buttons says why. The first reason that
 * applies, one line only:
 * - no refund address: `add a refund address to drop it.` (multisend: `…to send it.`)
 * - a refund address in the wrong shape for the chain: `this is not a Solana address.` or `this is
 *   not a Robinhood address. it starts with 0x.`
 * - handle drops paused, or the token not ok: the page already says so, so no new line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  initialForm,
  reduceForm,
  viewOf,
  type FormAction,
  type FormState,
  type HandlePreview,
} from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
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

describe("item 1: the reason line when drop it is grey", () => {
  it("a drop with no refund address says to add one", () => {
    const v = viewOf(dropStep2("solana"), pills);
    expect(v.step2Ok).toBe(false);
    expect(v.step2Reason).toBe("add a refund address to drop it.");
  });

  it("a multisend with no refund address says send it, never drop", () => {
    const v = viewOf(multisendStep2("solana"), pills);
    expect(v.step2Ok).toBe(false);
    expect(v.step2Reason).toBe("add a refund address to send it.");
  });

  it("spaces only count as no refund address", () => {
    const v = viewOf(dropStep2("solana", { type: "refund", value: "   " }), pills);
    expect(v.step2Reason).toBe("add a refund address to drop it.");
  });

  it("an EVM address on Solana says it is not a Solana address", () => {
    const v = viewOf(dropStep2("solana", { type: "refund", value: EVM_A }), pills);
    expect(v.step2Ok).toBe(false);
    expect(v.step2Reason).toBe("this is not a Solana address.");
  });

  it("a Solana address on Robinhood says it starts with 0x", () => {
    const v = viewOf(dropStep2("robinhood", { type: "refund", value: SOL_Q }), pills);
    expect(v.step2Ok).toBe(false);
    expect(v.step2Reason).toBe("this is not a Robinhood address. it starts with 0x.");
  });

  it("the same shape line on a multisend", () => {
    const v = viewOf(multisendStep2("robinhood", { type: "refund", value: "0x12" }), pills);
    expect(v.step2Reason).toBe("this is not a Robinhood address. it starts with 0x.");
  });

  it("a good refund address: the button is on and there is no line", () => {
    const drop = viewOf(dropStep2("solana", { type: "refund", value: SOL_P }), pills);
    expect(drop.step2Ok).toBe(true);
    expect(drop.step2Reason).toBeNull();

    const multi = viewOf(multisendStep2("robinhood", { type: "refund", value: EVM_A }), pills);
    expect(multi.step2Ok).toBe(true);
    expect(multi.step2Reason).toBeNull();
  });

  it("a token not checked yet gets no new line, the token card already says so", () => {
    const state = dropStep2("solana", { type: "asset", value: "token" });
    const v = viewOf(state, pills);
    expect(v.step2Ok).toBe(false);
    expect(v.step2Reason).toBeNull();
  });
});

describe("item 1: the create page shows the line under the buttons", () => {
  const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");

  it("renders view.step2Reason as one grey small line", () => {
    expect(page).toMatch(
      /view\.step2Reason[\s\S]{0,200}type-small[^"]*text-chad-text-dim|type-small[^"]*text-chad-text-dim[^>]*>\s*\{view\.step2Reason\}/,
    );
  });

  it("hides it while the drop is being made", () => {
    expect(page).toMatch(/!busy\s*&&\s*view\.step2Reason/);
  });
});
