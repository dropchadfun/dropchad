/**
 * The wait line on `/create` while the drop is being made: nothing
 * for the first 20 seconds, then one calm line under the create button.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CREATE_WAIT_MS, createWaitLine } from "@/components/create/wait-line";

describe("the create wait line", () => {
  it("is nothing for the first 20 seconds", () => {
    expect(CREATE_WAIT_MS).toBe(20_000);
    expect(createWaitLine(0)).toBeNull();
    expect(createWaitLine(19_999)).toBeNull();
  });

  it("then says solana is busy and nothing left the wallet", () => {
    expect(createWaitLine(20_000)).toBe(
      "solana is busy. we are trying again. nothing left your wallet.",
    );
    expect(createWaitLine(90_000)).toBe(
      "solana is busy. we are trying again. nothing left your wallet.",
    );
  });

  it("the create page shows it while it makes the drop", () => {
    const page = readFileSync(
      join(__dirname, "..", "src", "components", "create", "CreateDrop.tsx"),
      "utf8",
    );
    expect(page).toContain("createWaitLine(");
  });
});
