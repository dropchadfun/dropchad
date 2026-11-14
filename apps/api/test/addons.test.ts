/**
 * The optional parts, `src/addons.ts`: at start the api loads `<folder>/addon.ts` from each
 * folder that has one and calls its `start`; the `stop` each gives back runs on shutdown. No
 * folder with an `addon.ts`: nothing loads, nothing is mounted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { addonFileName, startAddons } from "../src/addons.js";
import { createHarness, type Harness } from "./harness.js";

let harness: Harness | undefined;
let root: string | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** An addon that mounts one route and counts its starts and stops on `globalThis`. */
const ADDON = (name: string) => `
export async function start(ctx) {
  const seen = (globalThis.__addonTest ??= []);
  seen.push("start ${name} " + (ctx.env.ADDON_TEST ?? "-") + " " + typeof ctx.db.select);
  ctx.app.get("/api/${name}/ping", (c) => c.json({ name: "${name}", db: typeof c.var.deps.db }));
  return { stop() { seen.push("stop ${name}"); } };
}
`;

function folders(spec: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), "addons-test-"));
  root = dir;
  for (const [name, body] of Object.entries(spec)) {
    mkdirSync(join(dir, name));
    if (body !== null) writeFileSync(join(dir, name, "addon.ts"), body);
  }
  writeFileSync(join(dir, "addon.ts"), "throw new Error('a root file is not an addon');");
  return dir;
}

async function context() {
  const h = await createHarness();
  harness = h;
  return {
    app: h.app,
    config: h.config,
    db: h.handle.db,
    client: h.handle.client,
    kms: null,
    env: { ADDON_TEST: "seen" },
    keys: {},
  };
}

const seen = () => ((globalThis as { __addonTest?: string[] }).__addonTest ??= []);

describe("startAddons", () => {
  it("no folder with an addon.ts: nothing loads, the route is not there", async () => {
    const ctx = await context();
    const loaded = await startAddons(ctx, folders({ empty: null }));
    expect(loaded.names).toEqual([]);
    loaded.stop();
    expect((await ctx.app.request("/api/empty/ping")).status).toBe(404);
  });

  it("a folder that is not there at all: nothing loads", async () => {
    const ctx = await context();
    const loaded = await startAddons(ctx, join(tmpdir(), "addons-test-not-there-0"));
    expect(loaded.names).toEqual([]);
  });

  it("loads each folder's addon.ts in name order, with the context, and mounts its route", async () => {
    seen().length = 0;
    const ctx = await context();
    const loaded = await startAddons(ctx, folders({ beta: ADDON("beta"), alpha: ADDON("alpha") }));
    expect(loaded.names).toEqual(["alpha", "beta"]);
    expect(seen()).toEqual(["start alpha seen function", "start beta seen function"]);
    const answer = await ctx.app.request("/api/alpha/ping");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ name: "alpha", db: "object" });
  });

  it("a route an addon mounts still gets the 404 answer for anything else", async () => {
    const ctx = await context();
    await startAddons(ctx, folders({ alpha: ADDON("alpha") }));
    const answer = await ctx.app.request("/api/alpha/nothing");
    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: "not_found" });
  });

  it("stop calls each addon's stop, in reverse order", async () => {
    seen().length = 0;
    const ctx = await context();
    const loaded = await startAddons(ctx, folders({ alpha: ADDON("alpha"), beta: ADDON("beta") }));
    loaded.stop();
    expect(seen().slice(2)).toEqual(["stop beta", "stop alpha"]);
  });

  it("an addon whose start fails stops the start", async () => {
    const ctx = await context();
    await expect(
      startAddons(
        ctx,
        folders({ broken: "export async function start() { throw new Error('no'); }" }),
      ),
    ).rejects.toThrow("no");
  });

  it("an addon.ts without a start stops the start", async () => {
    const ctx = await context();
    await expect(startAddons(ctx, folders({ odd: "export const nothing = 1;" }))).rejects.toThrow(
      /odd.*start/,
    );
  });
});

describe("built files", () => {
  it("run from source, the loader takes addon.ts", () => {
    expect(addonFileName()).toBe("addon.ts");
  });

  it("run from built files, it takes addon.js and leaves addon.ts alone", async () => {
    seen().length = 0;
    const ctx = await context();
    const dir = folders({ gamma: null, delta: ADDON("delta") });
    writeFileSync(join(dir, "gamma", "addon.js"), ADDON("gamma"));
    const loaded = await startAddons(ctx, dir, "addon.js");
    expect(loaded.names).toEqual(["gamma"]);
    expect(seen()).toEqual(["start gamma seen function"]);
    expect((await ctx.app.request("/api/gamma/ping")).status).toBe(200);
    expect((await ctx.app.request("/api/delta/ping")).status).toBe(404);
  });

  it.each([
    ["file:///srv/api/src/addons.ts", "addon.ts"],
    ["file:///srv/api/dist/addons.js", "addon.js"],
    ["file:///srv/api/dist/addons.mjs", "addon.mjs"],
  ])("the loader at %s takes %s", (url, name) => {
    expect(addonFileName(url)).toBe(name);
  });
});
