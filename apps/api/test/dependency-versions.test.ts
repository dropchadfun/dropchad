/**
 * the dependency upgrade. The api's own `drizzle-orm` and
 * `@hono/node-server` move to 0.45.4 and 2.1.4, pinned exact, no `^`. The audit alerts on these
 * two names are on Ponder's own nested copies, not on ours; those stay as Ponder pins them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(API, "..", "..");

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const declared = json(join(API, "package.json")).dependencies as Record<string, string>;

function installed(...path: string[]): string {
  return json(join(ROOT, "node_modules", ...path, "package.json")).version as string;
}

describe("the api dependencies", () => {
  it("declares drizzle-orm 0.45.4 and @hono/node-server 2.1.4 exactly", () => {
    expect(declared["drizzle-orm"]).toBe("0.45.4");
    expect(declared["@hono/node-server"]).toBe("2.1.4");
  });

  it("has drizzle-orm 0.45.4 and @hono/node-server 2.1.4 installed", () => {
    expect(installed("drizzle-orm")).toBe("0.45.4");
    expect(installed("@hono", "node-server")).toBe("2.1.4");
  });

  it("leaves Ponder's own pinned copies as they are", () => {
    expect(installed("ponder", "node_modules", "drizzle-orm")).toBe("0.41.0");
    expect(installed("ponder", "node_modules", "@hono", "node-server")).toBe("1.19.5");
  });
});
