/**
 * The link preview. Without `metadataBase` Next wrote every `og:image` and
 * `twitter:image` as `http://localhost:3000/opengraph-image.png?…` on dropchad.fun, so Discord and
 * X could not fetch the picture and showed an empty card. Now the base is `https://dropchad.com`,
 * the main domain.
 * The og image is picked by the root layout by build
 * `public/brand/og-testnet.png` on a testnet build, `og-beta.png` on a mainnet build, each with
 * its alt text. No file based og image: in Next it overrides the `metadata` object. The drop,
 * multisend and profile pages have no picture of their own and use the same one.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "font-inter" }),
  Space_Grotesk: () => ({ variable: "font-grotesk" }),
}));

const { metadata } = await import("@/app/layout");
const { ogImage } = await import("@/lib/og");
const { TESTNET_ONLY } = await import("@/lib/chains");

const APP = join(__dirname, "..", "src", "app");
const BRAND = join(__dirname, "..", "public", "brand");
const TAGLINE = "dropchad. drop crypto, prove you did. every drop is proved on chain.";

describe("link preview", () => {
  it("sets metadataBase to https://dropchad.com", () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(String(metadata.metadataBase)).toBe("https://dropchad.com/");
  });

  it("a testnet build: the testnet image and alt text", () => {
    expect(ogImage(true)).toEqual({
      url: "/brand/og-testnet.png",
      width: 1200,
      height: 630,
      alt: `${TAGLINE} testnet.`,
    });
  });

  it("a mainnet build: the beta image and alt text", () => {
    expect(ogImage(false)).toEqual({
      url: "/brand/og-beta.png",
      width: 1200,
      height: 630,
      alt: `${TAGLINE} beta.`,
    });
  });

  it("the layout sets the image of this build", () => {
    expect(metadata.openGraph?.images).toEqual([ogImage(TESTNET_ONLY)]);
  });

  it("makes the og image a full dropchad.com url, never localhost", () => {
    const image = new URL(ogImage(TESTNET_ONLY).url, metadata.metadataBase ?? undefined).href;
    expect(image).toMatch(/^https:\/\/dropchad\.com\/brand\/og-(testnet|beta)\.png$/);
    expect(image).not.toContain("localhost");
  });

  it("keeps both images 1200 by 630 pngs in public/brand", () => {
    for (const name of ["og-testnet.png", "og-beta.png"]) {
      const png = readFileSync(join(BRAND, name));
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      // IHDR: width and height, big endian, right after the 8 byte signature and the chunk head.
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
    }
  });

  it("no file based og or twitter image anywhere in the app", () => {
    expect(existsSync(join(APP, "opengraph-image.png"))).toBe(false);
    expect(existsSync(join(APP, "opengraph-image.alt.txt"))).toBe(false);
    expect(existsSync(join(APP, "twitter-image.png"))).toBe(false);
  });

  it("gives drop, multisend and profile pages no picture of their own", () => {
    for (const dir of ["d/[address]", "m/[address]", "u/[handle]"]) {
      const files = readdirSync(join(APP, dir));
      expect(files.filter((f) => /^(opengraph|twitter)-image/.test(f))).toEqual([]);
      const page = readFileSync(join(APP, dir, "page.tsx"), "utf8");
      expect(page).not.toMatch(/openGraph|twitter|metadataBase/);
    }
  });
});
