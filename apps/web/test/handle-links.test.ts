/**
 * A pasted X profile link counts as the name in drop mode: a
 * tester pasted `x.com/username` and the page refused it. `https://`, `www.`, `mobile.`, an
 * `@` and anything after the name are dropped; the usual handle check still runs. The link is
 * cut before the line is split, since `?s=20` holds an `=`, one of the separators.
 */
import { describe, expect, it } from "vitest";

import { parseHandles } from "@/components/create/handles";

const options = { decimals: 9, symbol: "SOL" };
const parse = (text: string) => parseHandles(text, options);

describe("a pasted X link", () => {
  it.each([
    "https://x.com/alice 1",
    "http://x.com/alice 1",
    "x.com/alice 1",
    "https://twitter.com/alice 1",
    "twitter.com/alice 1",
    "https://www.x.com/alice 1",
    "https://mobile.twitter.com/alice 1",
    "https://x.com/@alice 1",
    "https://x.com/alice/ 1",
    "https://x.com/alice?s=20 1",
    "https://x.com/alice?s=20&t=abc 1",
    "https://x.com/alice/status/1234567890 1",
    "https://x.com/alice#top 1",
    "https://X.com/alice 1",
    "https://x.com/alice, 1",
    "https://x.com/alice=1",
  ])("%s is alice", (line) => {
    const result = parse(line);
    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([{ handle: "alice", amountWei: 1_000_000_000n }]);
  });

  it("works next to plain handles, and counts a repeat", () => {
    const result = parse("@alice 1\nhttps://x.com/Alice?s=20 2\nbob 3");
    expect(result.errors).toEqual([]);
    expect(result.lines.map((l) => l.handle)).toEqual(["alice", "Alice", "bob"]);
    expect(result.duplicates).toBe(1);
    expect(result.people).toBe(2);
  });

  it("a link with no name, or a bad name, is still not an X handle", () => {
    for (const line of [
      "https://x.com/ 1",
      "https://x.com 1",
      "https://x.com/abcdefghijklmnop 1",
      "https://x.com/al-ice 1",
      "https://example.com/alice 1",
      "https://notx.com/alice 1",
    ]) {
      expect(parse(line).errors).toEqual([{ line: 1, message: "not an X handle" }]);
    }
  });

  it("the own handle as a link is still refused", () => {
    const result = parseHandles("https://x.com/me 1", { ...options, ownHandle: "me" });
    expect(result.errors).toEqual([
      { line: 1, message: "that is you. a drop cannot pay yourself." },
    ]);
  });
});
