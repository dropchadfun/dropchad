/**
 * the dependency upgrade. `next` 16.3.8 closes the audit alerts of
 * 16.3.5: GHSA-vcvr (next/og), GHSA-cjq9 (image optimization), GHSA-4jqv and GHSA-mcj8 (SSG and
 * ISR cache poisoning), GHSA-3w37 and GHSA-h694 (`use cache`), GHSA-f87g (metadata image routes),
 * GHSA-39w2 (dev server). `eslint-config-next` moves with it. Both pinned exact, no `^`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const ROOT = join(WEB, "..", "..");

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const declared = {
  ...(json(join(WEB, "package.json")).dependencies as Record<string, string>),
  ...(json(join(WEB, "package.json")).devDependencies as Record<string, string>),
};

function installed(name: string): string {
  return json(join(ROOT, "node_modules", name, "package.json")).version as string;
}

describe("the web dependencies", () => {
  it("declares next and eslint-config-next exactly 16.3.8", () => {
    expect(declared.next).toBe("16.3.8");
    expect(declared["eslint-config-next"]).toBe("16.3.8");
  });

  it("has next and eslint-config-next 16.3.8 installed", () => {
    expect(installed("next")).toBe("16.3.8");
    expect(installed("eslint-config-next")).toBe("16.3.8");
  });
});
