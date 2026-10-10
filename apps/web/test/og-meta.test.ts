/**
 * The link preview. Without `metadataBase` Next wrote every `og:image` and
 * `twitter:image` as `http://localhost:3000/opengraph-image.png?…` on dropchad.fun, so Discord and
 * X could not fetch the picture and showed an empty card. Now the base is `https://dropchad.com`,
 * the main domain.
 * The og image is the root `opengraph-image.png`, the flat hand; the drop, multisend
 * and profile pages have no picture of their own and use the same one.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "font-inter" }),
  Space_Grotesk: () => ({ variable: "font-grotesk" }),
}));

const { metadata } = await import("@/app/layout");

const APP = join(__dirname, "..", "src", "app");

describe("link preview", () => {
  it("sets metadataBase to https://dropchad.com", () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(String(metadata.metadataBase)).toBe("https://dropchad.com/");
  });

  it("makes the og image a full dropchad.com url, never localhost", () => {
    const image = new URL("/opengraph-image.png", metadata.metadataBase ?? undefined).href;
    expect(image).toBe("https://dropchad.com/opengraph-image.png");
    expect(image).not.toContain("localhost");
  });

  it("keeps the og image a 1200 by 630 png next to the layout", () => {
    const png = readFileSync(join(APP, "opengraph-image.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    // IHDR: width and height, big endian, right after the 8 byte signature and the chunk head.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(readFileSync(join(APP, "opengraph-image.alt.txt"), "utf8").trim()).not.toBe("");
  });

  it("gives drop, multisend and profile pages no picture of their own", () => {
    for (const dir of ["d/[address]", "m/[address]", "u/[handle]"]) {
      const files = readdirSync(join(APP, dir));
      expect(files.filter((f) => /^(opengraph|twitter)-image/.test(f))).toEqual([]);
      const page = readFileSync(join(APP, dir, "page.tsx"), "utf8");
      expect(page).not.toMatch(/openGraph|twitter|metadataBase/);
    }
    expect(existsSync(join(APP, "twitter-image.png"))).toBe(false);
  });
});
