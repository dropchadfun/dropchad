import type { MetadataRoute } from "next";

/** `/robots.txt`: every agent allowed, and the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://dropchad.com/sitemap.xml",
  };
}
