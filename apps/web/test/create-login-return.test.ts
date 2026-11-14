/**
 * The X login from `/create` comes back to `/create`, in multisend mode when the
 * page was in it. The api keeps exactly these two paths.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLoginHref } from "@/components/create/form";

const SRC = join(import.meta.dirname, "..", "src");

describe("the sign in link on /create", () => {
  it("drop mode comes back to /create", () => {
    expect(createLoginHref("drop")).toBe("/api/auth/x/start?next=%2Fcreate");
  });

  it("multisend mode comes back to /create?mode=multisend", () => {
    expect(createLoginHref("multisend")).toBe(
      "/api/auth/x/start?next=%2Fcreate%3Fmode%3Dmultisend",
    );
  });

  it("the signed out screen uses it with the page mode", () => {
    const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
    expect(page).toContain("href={createLoginHref(mode)}");
    expect(page).not.toContain('href="/api/auth/x/start"');
  });
});
