/**
 * `shadcn` is a command line tool for adding components, never code the site runs. It belongs in
 * `devDependencies`, pinned exact. Its own packages,
 * among them `proxy-addr`, the one critical audit alert, are then dev only and leave
 * `npm audit --omit=dev`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(WEB, "..", "..");

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const web = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as Manifest;
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
  packages: Record<string, Manifest & { version?: string; dev?: boolean }>;
};

describe("shadcn is a dev dependency", () => {
  it("is in devDependencies, exactly 4.21.0, and not in dependencies", () => {
    expect(web.dependencies?.["shadcn"]).toBeUndefined();
    expect(web.devDependencies?.["shadcn"]).toBe("4.21.0");
  });

  it("is a dev package in the lockfile, at the same version", () => {
    expect(lock.packages["apps/web"]?.devDependencies?.["shadcn"]).toBe("4.21.0");
    expect(lock.packages["apps/web"]?.dependencies?.["shadcn"]).toBeUndefined();
    expect(lock.packages["node_modules/shadcn"]?.version).toBe("4.21.0");
    expect(lock.packages["node_modules/shadcn"]?.dev).toBe(true);
  });

  it("takes proxy-addr, the critical audit alert, out of the production packages", () => {
    expect(lock.packages["node_modules/proxy-addr"]?.dev).toBe(true);
  });
});
