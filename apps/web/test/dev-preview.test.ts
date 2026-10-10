/**
 * The dev only switch `/create?handleMode=on` with. It
 * lets a developer see drop mode on a laptop where handle mode is off: `drop` can be picked, and
 * the lookup on `next` answers with sample names from this file instead of calling the api.
 *
 * It must never work outside local development: not in a production build, not on another host,
 * not without the parameter. And nothing sample may reach the api: in preview a drop cannot be
 * sent at all.
 */
import { describe, expect, it } from "vitest";

import { devPreviewEnabled, samplePreview, submitAllowed } from "@/components/create/dev-preview";

const LOCAL = { nodeEnv: "development", hostname: "localhost" };

describe("devPreviewEnabled", () => {
  it("is on only in development, on localhost, with ?handleMode=on", () => {
    expect(devPreviewEnabled("?handleMode=on", LOCAL)).toBe(true);
    expect(devPreviewEnabled("?handleMode=on", { ...LOCAL, hostname: "127.0.0.1" })).toBe(true);
  });

  it("is off in a production build, whatever the url says", () => {
    expect(devPreviewEnabled("?handleMode=on", { ...LOCAL, nodeEnv: "production" })).toBe(false);
    expect(devPreviewEnabled("?handleMode=on", { ...LOCAL, nodeEnv: "test" })).toBe(false);
    expect(devPreviewEnabled("?handleMode=on", { ...LOCAL, nodeEnv: undefined })).toBe(false);
  });

  it("is off on any other host, the live site included", () => {
    expect(devPreviewEnabled("?handleMode=on", { ...LOCAL, hostname: "dropchad.com" })).toBe(false);
    expect(devPreviewEnabled("?handleMode=on", { ...LOCAL, hostname: "192.168.1.20" })).toBe(false);
  });

  it("is off without the exact parameter", () => {
    expect(devPreviewEnabled("", LOCAL)).toBe(false);
    expect(devPreviewEnabled("?handleMode=off", LOCAL)).toBe(false);
    expect(devPreviewEnabled("?handleMode=ON", LOCAL)).toBe(false);
  });
});

describe("samplePreview", () => {
  it("finds every handle with a sample name and a letter avatar, no picture from anywhere", () => {
    const preview = samplePreview(["alice", "Bob_2"], "@alice 1\n@Bob_2 1");
    expect(preview.forText).toBe("@alice 1\n@Bob_2 1");
    expect(preview.missing).toEqual([]);
    expect(preview.found.map((f) => [f.handle, f.displayName, f.profileImageUrl])).toEqual([
      ["alice", "sample alice", null],
      ["Bob_2", "sample Bob_2", null],
    ]);
  });

  it("misses every handle that starts with ghost, so the miss line can be seen too", () => {
    const preview = samplePreview(["alice", "ghost1"], "x");
    expect(preview.missing).toEqual(["ghost1"]);
    expect(preview.found.map((f) => f.handle)).toEqual(["alice"]);
  });
});

describe("submitAllowed", () => {
  it("never sends a drop from the preview; everything else as normal", () => {
    expect(submitAllowed({ devPreview: true, mode: "drop" })).toBe(false);
    expect(submitAllowed({ devPreview: false, mode: "drop" })).toBe(true);
    expect(submitAllowed({ devPreview: false, mode: "multisend" })).toBe(true);
    // A multisend is real addresses, nothing sample, so the preview does not touch it.
    expect(submitAllowed({ devPreview: true, mode: "multisend" })).toBe(true);
  });
});
