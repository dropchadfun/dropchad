import type { MetadataRoute } from "next";

const SITE = "https://dropchad.com";

/** The site's own pages. No drop, multisend or profile page. */
const PATHS = [
  "/",
  "/how",
  "/boards",
  "/create",
  "/claim",
  "/about",
  "/terms",
  "/privacy",
  "/contact",
] as const;

/** `/sitemap.xml`. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: path === "/" ? SITE : `${SITE}${path}` }));
}
