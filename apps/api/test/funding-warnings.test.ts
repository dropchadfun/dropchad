/**
 * Create and fund, item 3: one wording for the
 * amount. The drop starts once it holds at least the amount, and anything above goes back at the
 * end, but the words never say `at least`: send this amount, less does not start it, more comes
 * back. The refund line is unchanged.
 *
 * And the small extra after item 6: a multisend is never called a
 * drop, so the route passes the mode and a multisend's line says `the multisend does not start`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fundingWarnings } from "../src/drops/payment.js";

const REFUND = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";

const linesFor = (mode: "address" | "handle") =>
  fundingWarnings({
    refundRecipient: REFUND,
    amountDisplay: "0.0123",
    symbol: "SOL",
    chainName: "Solana Devnet",
    mode,
  });

const lines = linesFor("handle");

describe("item 3: the funding warnings", () => {
  it("the first line: send this amount, less does not start it", () => {
    expect(lines[0]).toBe(
      "Send 0.0123 SOL on Solana Devnet to the address above. Less than this and the drop does " +
        "not start. A plain transfer is enough. There is nothing to sign and no wallet to connect.",
    );
  });

  it("the second line: more comes back to the refund address", () => {
    expect(lines[1]).toBe(
      "Check the address character by character before you send. If you send more, the extra " +
        "goes back to your refund address at the end.",
    );
  });

  it("never at least, anywhere", () => {
    expect(lines.join(" ").toLowerCase()).not.toContain("at least");
  });

  it("the refund line stays, with the exchange warning marked", () => {
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain(`Your refund address is ${REFUND}.`);
    expect(lines[2]).toContain("**Never use an exchange deposit address");
  });
});

describe("the multisend wording", () => {
  const multi = linesFor("address");

  it("a multisend: the multisend does not start", () => {
    expect(multi[0]).toBe(
      "Send 0.0123 SOL on Solana Devnet to the address above. Less than this and the multisend " +
        "does not start. A plain transfer is enough. There is nothing to sign and no wallet to " +
        "connect.",
    );
  });

  it("a multisend's lines never say drop", () => {
    expect(multi.join(" ").toLowerCase()).not.toMatch(/\bdrop\b/);
  });

  it("the other two lines are the same for both", () => {
    expect(multi.slice(1)).toEqual(lines.slice(1));
  });

  it("the create route passes the drop's mode", () => {
    const route = readFileSync(
      join(import.meta.dirname, "..", "src", "routes", "drops.ts"),
      "utf8",
    );
    expect(route).toMatch(/fundingWarnings\(\{[\s\S]{0,300}mode: created\.mode/);
  });
});
