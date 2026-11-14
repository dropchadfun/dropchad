/**
 * The web's server side calls reach the api on `127.0.0.1`, never `localhost`, which can resolve
 * to `::1` first, where the api does not listen. One default,
 * used by the `/api` rewrite and by `apiUrl`, so the two can never differ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_API_ORIGIN, apiOrigin } from "@/lib/api-origin";

describe("api origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to http://127.0.0.1:4000", () => {
    expect(DEFAULT_API_ORIGIN).toBe("http://127.0.0.1:4000");
    expect(apiOrigin({})).toBe("http://127.0.0.1:4000");
  });

  it("takes API_ORIGIN when it is set", () => {
    expect(apiOrigin({ API_ORIGIN: "http://10.0.0.5:4000" })).toBe("http://10.0.0.5:4000");
  });

  it("rewrites /api to 127.0.0.1 when API_ORIGIN is not set", async () => {
    vi.stubEnv("API_ORIGIN", undefined);
    const config = (await import("../next.config")).default;
    const rewrites = await config.rewrites?.();
    expect(rewrites).toEqual([
      { source: "/api/:path*", destination: "http://127.0.0.1:4000/api/:path*" },
    ]);
  });

  it("names no localhost:4000 in the rewrite or in apiUrl", () => {
    for (const file of ["../next.config.ts", "../src/lib/api.ts"]) {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(source, file).not.toContain("localhost:4000");
    }
  });
});
