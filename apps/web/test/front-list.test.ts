/**
 * `live now` and latest drops show handle drops only. The api
 * already lists nothing else; the front page checks again, so an old api or a cached answer can
 * never put a multisend back on it. `isListed` in `drop-card-data.ts`.
 */
import { describe, expect, it } from "vitest";

import { isListed } from "@/components/drops/drop-card-data";
import type { DropListEntry } from "@/lib/api";

const entry = (dropchad: { mode: "address" | "handle" } | null) =>
  ({
    address: "0x1111111111111111111111111111111111111111",
    dropchad,
  }) as unknown as DropListEntry;

describe("isListed", () => {
  it("a handle drop is listed", () => {
    expect(isListed(entry({ mode: "handle" }))).toBe(true);
  });

  it("a multisend is not", () => {
    expect(isListed(entry({ mode: "address" }))).toBe(false);
  });

  it("a drop we did not create is not: its mode is not known", () => {
    expect(isListed(entry(null))).toBe(false);
  });
});
