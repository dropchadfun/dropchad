/**
 * The `.env` loader, and the data directory.
 *
 * Both exist because of real failures: `npm run dev` did not read `apps/api/.env`,
 * because tsx does not, and PGlite did not create `./.data/api` on first start.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseHandle } from "../src/db/client.js";
import { loadDotEnv, parseEnvFile } from "../src/load-env.js";

const temporary: string[] = [];
let handle: DatabaseHandle | undefined;

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dropchad-test-"));
  temporary.push(dir);
  return dir;
}

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  for (const dir of temporary.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseEnvFile", () => {
  it("reads plain KEY=value lines", () => {
    expect(parseEnvFile("A=1\nB=two\n")).toEqual({ A: "1", B: "two" });
  });

  it("ignores blank lines and comments", () => {
    expect(parseEnvFile("\n# a comment\n\nA=1\n   # indented comment\n")).toEqual({ A: "1" });
  });

  it("accepts an export prefix", () => {
    expect(parseEnvFile("export A=1")).toEqual({ A: "1" });
  });

  it("keeps everything after the first = , so a value may contain =", () => {
    expect(parseEnvFile("URL=postgres://u:p@h/db?x=1")).toEqual({
      URL: "postgres://u:p@h/db?x=1",
    });
  });

  it("strips matching quotes and keeps the inner whitespace", () => {
    expect(parseEnvFile(`A="  spaced  "\nB='single'\n`)).toEqual({ A: "  spaced  ", B: "single" });
  });

  it("does not interpolate, so a value with a dollar sign survives intact", () => {
    // A real secret can contain $, {, }. Expanding it would silently corrupt it.
    expect(parseEnvFile("SECRET=ab$c${OTHER}de")).toEqual({ SECRET: "ab$c${OTHER}de" });
  });

  it("skips a line with no = and a key that is not a valid name", () => {
    expect(parseEnvFile("junk\n=nokey\n1BAD=x\nA-B=x\nGOOD=y")).toEqual({ GOOD: "y" });
  });

  it("keeps an empty value, which is what .env.example is full of", () => {
    expect(parseEnvFile("EMPTY=")).toEqual({ EMPTY: "" });
  });
});

describe("loadDotEnv", () => {
  it("sets values from the file", () => {
    const dir = scratchDir();
    const path = join(dir, ".env");
    writeFileSync(path, "X_CLIENT_ID=from-file\n");

    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv(path, env);

    expect(result.found).toBe(true);
    expect(result.applied).toEqual(["X_CLIENT_ID"]);
    expect(env["X_CLIENT_ID"]).toBe("from-file");
  });

  it("never overwrites the real environment", () => {
    // On a server the platform supplies the values. A stray .env in the image must not win.
    const dir = scratchDir();
    const path = join(dir, ".env");
    writeFileSync(path, "X_CLIENT_ID=from-file\nOTHER=from-file\n");

    const env: NodeJS.ProcessEnv = { X_CLIENT_ID: "from-the-real-environment" };
    const result = loadDotEnv(path, env);

    expect(env["X_CLIENT_ID"]).toBe("from-the-real-environment");
    expect(env["OTHER"]).toBe("from-file");
    expect(result.skipped).toEqual(["X_CLIENT_ID"]);
    expect(result.applied).toEqual(["OTHER"]);
  });

  it("treats a missing file as normal, not an error", () => {
    const result = loadDotEnv(join(scratchDir(), "does-not-exist"), {});
    expect(result.found).toBe(false);
    expect(result.applied).toEqual([]);
  });

  it("returns names only, never values, so a caller cannot log a secret", () => {
    const dir = scratchDir();
    const path = join(dir, ".env");
    writeFileSync(path, "X_CLIENT_SECRET=super-secret-value\n");

    const result = loadDotEnv(path, {});
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    expect(result.applied).toEqual(["X_CLIENT_SECRET"]);
  });
});

describe("the data directory", () => {
  it("is created on first start, so a fresh clone works", async () => {
    const target = join(scratchDir(), "nested", "api");
    expect(existsSync(target)).toBe(false);

    handle = await openDatabase(target);
    expect(existsSync(target)).toBe(true);
  });

  it("opening an existing directory again is a no-op", async () => {
    const target = join(scratchDir(), "api");
    handle = await openDatabase(target);
    await handle.close();

    handle = await openDatabase(target);
    expect(existsSync(target)).toBe(true);
  });

  it("memory:// creates no directory at all", async () => {
    handle = await openDatabase("memory://");
    expect(existsSync("memory://")).toBe(false);
  });
});
