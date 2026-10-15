/**
 * The pasted handle list on `/create` in drop mode. One X handle and one
 * amount per line. Everything here is checked on the phone, before the one paid lookup on
 * `next`: a wrong shape, a missing amount, the sender's own handle, and the
 * 500 people cap.
 */
import { describe, expect, it } from "vitest";

import { parseHandles } from "@/components/create/handles";

const SOL = { decimals: 9, symbol: "SOL" };

describe("parseHandles", () => {
  it("reads @handle amount, and handle, amount from a sheet", () => {
    const parsed = parseHandles("@alice 0.01\nbob_2, 0.02\n\n  Carol=0.5  ", SOL);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toEqual([
      { handle: "alice", amountWei: 10_000_000n },
      { handle: "bob_2", amountWei: 20_000_000n },
      { handle: "Carol", amountWei: 500_000_000n },
    ]);
    expect(parsed.totalWei).toBe(530_000_000n);
    expect(parsed.people).toBe(3);
    expect(parsed.tooMany).toBe(false);
  });

  it("names the line of every mistake, and spends nothing on it", () => {
    const parsed = parseHandles(
      [
        "@this_handle_is_too_long 1",
        "@alice",
        "@bob 1 2",
        "@carol 0",
        "@dave -1",
        "@e.ve 1",
        "0x1111111111111111111111111111111111110001 1",
      ].join("\n"),
      SOL,
    );
    expect(parsed.errors).toEqual([
      { line: 1, message: "not an X handle" },
      { line: 2, message: "missing amount" },
      { line: 3, message: "too many values on the line" },
      { line: 4, message: "amount must be a number above zero, in SOL" },
      { line: 5, message: "amount must be a number above zero, in SOL" },
      { line: 6, message: "not an X handle" },
      { line: 7, message: "not an X handle" },
    ]);
    expect(parsed.lines).toEqual([]);
  });

  it("counts a handle twice as one person, whatever the case, and says so", () => {
    const parsed = parseHandles("@alice 0.01\n@ALICE 0.02", SOL);
    expect(parsed.errors).toEqual([]);
    expect(parsed.people).toBe(1);
    expect(parsed.duplicates).toBe(1);
    // The api merges the amounts per X id; the total is the sum either way.
    expect(parsed.totalWei).toBe(30_000_000n);
  });

  it("refuses the sender's own handle, whatever the case", () => {
    const parsed = parseHandles("@alice 0.01\n@DropChadFun 0.01", {
      ...SOL,
      ownHandle: "dropchadfun",
    });
    expect(parsed.errors).toEqual([
      { line: 2, message: "that is you. a drop cannot pay yourself." },
    ]);
  });

  it("refuses more than 500 people before any lookup", () => {
    const lines = Array.from({ length: 501 }, (_, i) => `@user${String(i)} 0.01`).join("\n");
    const parsed = parseHandles(lines, SOL);
    expect(parsed.people).toBe(501);
    expect(parsed.tooMany).toBe(true);
    const five = parseHandles(
      Array.from({ length: 500 }, (_, i) => `@user${String(i)} 0.01`).join("\n"),
      SOL,
    );
    expect(five.tooMany).toBe(false);
  });
});
