/**
 * The create form state behind `/create`. The chain is picked on step 1, above the receivers
 * box, and everything the chain decides follows it from the first keystroke.
 *
 * Real pills from the registry: robinhood and solana are both live, so both are selectable.
 *
 * These are the multisend box: the page starts on `drop`, so every
 * case here picks `multisend` first. Drop mode is `create-mode.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills();

const EVM_A = "0x1111111111111111111111111111111111110001";
const EVM_B = "0x2222222222222222222222222222222222220002";
const SOL_P = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const SOL_Q = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";

const SOLANA_LIST = `${SOL_P} 0.01\n${SOL_Q} 0.02`;
const EVM_LIST = `${EVM_A} 0.0001\n${EVM_B} 0.0002`;

/** The page on `multisend`, the address box. */
const multisend = (): FormState =>
  reduceForm(initialForm(pills), { type: "mode", mode: "multisend" });

function run(...actions: Parameters<typeof reduceForm>[1][]): FormState {
  return actions.reduce(reduceForm, multisend());
}

describe("create form, the chain on step 1", () => {
  it("starts on step 1 with the first live pill, solana, and its coin", () => {
    const state = multisend();
    const view = viewOf(state, pills);
    expect(state.step).toBe(1);
    expect(state.chain).toBe("solana");
    expect(view.family).toBe("svm");
    expect(view.symbol).toBe("SOL");
    expect(view.decimals).toBe(9);
    expect(view.placeholder.startsWith("0x")).toBe(false);
  });

  it("solana is a live pill", () => {
    expect(pills.find((pill) => pill.key === "solana")?.selectable).toBe(true);
  });

  it("switching the chain with text already in the box re-reads the list", () => {
    // Pasted under robinhood: every solana line is refused.
    const under = run({ type: "chain", key: "robinhood" }, { type: "text", value: SOLANA_LIST });
    const before = viewOf(under, pills);
    expect(before.parsed.errors).toEqual([
      { line: 1, message: "not an address" },
      { line: 2, message: "not an address" },
    ]);
    expect(before.step1Ok).toBe(false);

    // Tap solana: same text, now valid, in SOL, nine decimals, base58 example.
    const after = viewOf(reduceForm(under, { type: "chain", key: "solana" }), pills);
    expect(after.parsed.errors).toEqual([]);
    expect(after.parsed.receivers).toHaveLength(2);
    expect(after.parsed.totalWei).toBe(30_000_000n);
    expect(after.symbol).toBe("SOL");
    expect(after.decimals).toBe(9);
    expect(after.family).toBe("svm");
    expect(after.placeholder.startsWith("G5wp")).toBe(true);
    expect(after.refundPlaceholder).toBe("paste your Solana wallet address");
    expect(after.step1Ok).toBe(true);
  });

  it("switching back to robinhood refuses the solana list again, and takes an evm list", () => {
    const solana = run({ type: "chain", key: "solana" }, { type: "text", value: SOLANA_LIST });
    expect(viewOf(solana, pills).step1Ok).toBe(true);

    const robinhood = reduceForm(solana, { type: "chain", key: "robinhood" });
    expect(viewOf(robinhood, pills).step1Ok).toBe(false);
    expect(viewOf(robinhood, pills).parsed.errors).toHaveLength(2);

    const evm = reduceForm(robinhood, { type: "text", value: EVM_LIST });
    const view = viewOf(evm, pills);
    expect(view.parsed.errors).toEqual([]);
    expect(view.parsed.totalWei).toBe(300_000_000_000_000n);
    expect(view.symbol).toBe("ETH");
  });

  it("the chain and the text survive next and back", () => {
    const filled = run({ type: "chain", key: "solana" }, { type: "text", value: SOLANA_LIST });
    const step2 = reduceForm(filled, { type: "next" });
    expect(step2.step).toBe(2);
    expect(step2.chain).toBe("solana");
    expect(step2.text).toBe(SOLANA_LIST);

    const step1 = reduceForm(step2, { type: "back" });
    expect(step1.step).toBe(1);
    expect(step1.chain).toBe("solana");
    expect(step1.text).toBe(SOLANA_LIST);
    expect(viewOf(step1, pills).symbol).toBe("SOL");
    expect(viewOf(step1, pills).step1Ok).toBe(true);

    // Everything typed on step 2 is still there after a round trip too.
    const typed = reduceForm(step2, { type: "refund", value: SOL_P });
    const back = reduceForm(reduceForm(typed, { type: "back" }), { type: "next" });
    expect(back).toEqual({ ...typed, step: 2 });
  });

  it("the refund address is checked against the chosen chain", () => {
    const solana = run(
      { type: "chain", key: "solana" },
      { type: "text", value: SOLANA_LIST },
      { type: "next" },
      { type: "refund", value: EVM_A },
    );
    expect(viewOf(solana, pills).refundOk).toBe(false);
    expect(viewOf(solana, pills).step2Ok).toBe(false);

    const fixed = reduceForm(solana, { type: "refund", value: SOL_P });
    expect(viewOf(fixed, pills).refundOk).toBe(true);
    expect(viewOf(fixed, pills).step2Ok).toBe(true);
  });

  it("a refund address typed for one chain is re-checked when the chain changes", () => {
    const solana = run({ type: "chain", key: "solana" }, { type: "refund", value: SOL_P });
    expect(viewOf(solana, pills).refundOk).toBe(true);

    // Back to step 1, robinhood tapped: the base58 refund address is no longer valid.
    const robinhood = reduceForm(solana, { type: "chain", key: "robinhood" });
    expect(robinhood.refund).toBe(SOL_P);
    expect(viewOf(robinhood, pills).refundOk).toBe(false);
    expect(viewOf(robinhood, pills).step2Ok).toBe(false);

    // And the other way round.
    const evm = reduceForm(robinhood, { type: "refund", value: EVM_A });
    expect(viewOf(evm, pills).refundOk).toBe(true);
    expect(viewOf(reduceForm(evm, { type: "chain", key: "solana" }), pills).refundOk).toBe(false);
  });

  it("the fee comes from the chain, rounds down, and is unknown until the api answers", () => {
    // 0.03 SOL to the crowd at 100 bps = 0.0003 SOL, and the gross is the sum.
    const solana = run({ type: "chain", key: "solana" }, { type: "text", value: SOLANA_LIST });
    const at1pct = viewOf(solana, pills, 100);
    expect(at1pct.feeBps).toBe(100);
    expect(at1pct.feeWei).toBe(300_000n);
    expect(at1pct.grossWei).toBe(30_300_000n);

    // Integer division, never rounded up: 1 lamport at 100 bps is 0 fee, like the program.
    const tiny = run(
      { type: "chain", key: "solana" },
      { type: "text", value: `${SOL_P} 0.000000001` },
    );
    expect(viewOf(tiny, pills, 100).feeWei).toBe(0n);

    // At zero the fee line is zero, not missing.
    expect(viewOf(solana, pills, 0).feeWei).toBe(0n);

    // Before the api has answered, nothing is invented.
    const unknown = viewOf(solana, pills, null);
    expect(unknown.feeBps).toBeNull();
    expect(unknown.feeWei).toBeNull();
    expect(unknown.grossWei).toBeNull();
  });

  it("the fee is max(minFee, total * bps / 10_000), never both", () => {
    // 0.03 SOL at 100 bps is 0.0003 SOL; a 0.0025 SOL minimum is bigger, so the minimum is the fee.
    const solana = run({ type: "chain", key: "solana" }, { type: "text", value: SOLANA_LIST });
    const minWins = viewOf(solana, pills, 100, 2_500_000n);
    expect(minWins.feeWei).toBe(2_500_000n);
    expect(minWins.grossWei).toBe(30_000_000n + 2_500_000n);

    // 0.03 SOL at 100 bps against a 1 lamport minimum: the percent is bigger and is the fee alone.
    expect(viewOf(solana, pills, 100, 1n).feeWei).toBe(300_000n);

    // Zero bps still pays the minimum, like the contract.
    expect(viewOf(solana, pills, 0, 2_500_000n).feeWei).toBe(2_500_000n);

    // A minimum the api could not read means the fee is not known, never a guess.
    const unknown = viewOf(solana, pills, 100, null);
    expect(unknown.feeWei).toBeNull();
    expect(unknown.grossWei).toBeNull();
  });

  it("the fee label says the percent, or says the minimum when the minimum is the fee", () => {
    // 0.03 SOL at 100 bps is 0.0003 SOL, above a 1 lamport minimum: the 1% is the fee.
    const normal = viewOf(
      run({ type: "chain", key: "solana" }, { type: "text", value: SOLANA_LIST }),
      pills,
      100,
      1n,
    );
    expect(normal.feeFromMin).toBe(false);
    expect(normal.feeLabel).toBe("fee 1%");

    // A tiny drop: 0.000000001 SOL at 100 bps is 0, the 0.0025 SOL minimum is the fee.
    const tiny = viewOf(
      run({ type: "chain", key: "solana" }, { type: "text", value: `${SOL_P} 0.000000001` }),
      pills,
      100,
      2_500_000n,
    );
    expect(tiny.feeWei).toBe(2_500_000n);
    expect(tiny.feeFromMin).toBe(true);
    expect(tiny.feeLabel).toBe("minimum fee");

    // Half a percent reads as such; an unknown bps is just "fee".
    expect(viewOf(run({ type: "text", value: SOLANA_LIST }), pills, 50, 0n).feeLabel).toBe(
      "fee 0.5%",
    );
    expect(viewOf(multisend(), pills, null).feeLabel).toBe("fee");
  });

  it("back does nothing on step 1, next does nothing on step 2", () => {
    const start = multisend();
    expect(reduceForm(start, { type: "back" })).toBe(start);
    const step2 = reduceForm(start, { type: "next" });
    expect(reduceForm(step2, { type: "next" })).toBe(step2);
  });
});
