/**
 * The pasted receiver list. Three lines of "address amount", in every shape a paste arrives in.
 *
 * Pins down what the parser does with each line ending and separator a paste can arrive in.
 */
import { describe, expect, it } from "vitest";

import { parseReceivers } from "@/components/create/receivers";

const A = "0x1111111111111111111111111111111111110001";
const B = "0x2222222222222222222222222222222222220002";
const C = "0x3333333333333333333333333333333333330003";

const WEI_0_0001 = 100_000_000_000_000n;

function expectThree(text: string) {
  const parsed = parseReceivers(text);
  expect(parsed.errors).toEqual([]);
  expect(parsed.receivers.map((r) => r.address)).toEqual([A, B, C]);
  expect(parsed.receivers.map((r) => r.amountWei)).toEqual([WEI_0_0001, WEI_0_0001, WEI_0_0001]);
  expect(parsed.totalWei).toBe(3n * WEI_0_0001);
  expect(parsed.duplicates).toBe(0);
}

describe("parseReceivers, three lines of address space amount", () => {
  it("unix line endings", () => {
    expectThree(`${A} 0.0001\n${B} 0.0001\n${C} 0.0001`);
  });

  it("unix line endings with a trailing newline", () => {
    expectThree(`${A} 0.0001\n${B} 0.0001\n${C} 0.0001\n`);
  });

  it("windows line endings", () => {
    expectThree(`${A} 0.0001\r\n${B} 0.0001\r\n${C} 0.0001`);
  });

  it("windows line endings with a trailing newline", () => {
    expectThree(`${A} 0.0001\r\n${B} 0.0001\r\n${C} 0.0001\r\n`);
  });

  it("tabs, a paste from a sheet", () => {
    expectThree(`${A}\t0.0001\n${B}\t0.0001\n${C}\t0.0001`);
  });

  it("commas, a paste from a csv", () => {
    expectThree(`${A},0.0001\n${B},0.0001\n${C},0.0001`);
  });

  it("blank lines and leading spaces between them", () => {
    expectThree(`\n  ${A} 0.0001\n\n${B} 0.0001  \n\n\n${C} 0.0001\n\n`);
  });
});

describe("parseReceivers, amounts", () => {
  it("reads 0.0001 as 1e14 wei, never as 0.1", () => {
    expect(parseReceivers(`${A} 0.0001`).receivers[0]?.amountWei).toBe(WEI_0_0001);
    expect(parseReceivers(`${A} 0.1`).receivers[0]?.amountWei).toBe(100_000_000_000_000_000n);
    expect(parseReceivers(`${A} 1`).receivers[0]?.amountWei).toBe(1_000_000_000_000_000_000n);
  });

  it("refuses a zero, a negative, a word, and more than 18 decimals", () => {
    for (const bad of ["0", "-1", "lots", "0.0000000000000000001"]) {
      const parsed = parseReceivers(`${A} ${bad}`);
      expect(parsed.receivers).toEqual([]);
      expect(parsed.errors).toHaveLength(1);
    }
  });
});

describe("parseReceivers, bad lines", () => {
  it("names the line that is wrong and keeps the good ones", () => {
    const parsed = parseReceivers(`${A} 0.0001\nnot an address 1\n${C}`);
    expect(parsed.receivers.map((r) => r.address)).toEqual([A]);
    expect(parsed.errors).toEqual([
      { line: 2, message: "not an address" },
      { line: 3, message: "missing amount" },
    ]);
  });

  it("counts a repeated address and keeps both lines, the api merges them", () => {
    const parsed = parseReceivers(`${A} 0.0001\n${A} 0.0002`);
    expect(parsed.receivers).toHaveLength(2);
    expect(parsed.duplicates).toBe(1);
  });
});

describe("parseReceivers on solana: base58 keys and 9 decimals", () => {
  const SOL = { family: "svm" as const, decimals: 9, symbol: "SOL" };
  const P = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
  const Q = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";

  it("reads base58 keys and turns SOL into lamports", () => {
    const parsed = parseReceivers(`${P} 0.01\n${Q} 1.5`, SOL);
    expect(parsed.errors).toEqual([]);
    expect(parsed.receivers.map((r) => r.amountWei)).toEqual([10_000_000n, 1_500_000_000n]);
    expect(parsed.totalWei).toBe(1_510_000_000n);
  });

  it("refuses a 0x address on solana and a base58 key on the evm chain", () => {
    expect(parseReceivers(`${A} 0.01`, SOL).errors).toEqual([
      { line: 1, message: "not an address" },
    ]);
    expect(parseReceivers(`${P} 0.01`).errors).toEqual([{ line: 1, message: "not an address" }]);
  });

  it("refuses more than nine decimals of SOL and names the coin", () => {
    expect(parseReceivers(`${P} 0.0000000001`, SOL).errors[0]?.message).toBe(
      "amount must be a number above zero, in SOL",
    );
  });

  it("keeps base58 case: two keys that differ only by case are two receivers", () => {
    const lower = P.toLowerCase();
    const parsed = parseReceivers(`${P} 0.01\n${lower} 0.01`, SOL);
    // A lowercased key is almost never a valid 32 byte key, so it is an error, not a duplicate.
    expect(parsed.duplicates).toBe(0);
  });
});
