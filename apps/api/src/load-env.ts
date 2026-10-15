/**
 * Load `apps/api/.env` into `process.env`, if the file is there.
 *
 * **Why this exists.** `npm run dev` runs `tsx`, and tsx does not read a `.env` file. Only
 * `node --env-file=...` does. So the api refused to start with "invalid environment" even when
 * `.env` was filled in correctly and node had to be started by hand. Found.
 *
 * Two rules, and both matter:
 *
 * - **The real environment always wins.** A variable already set in `process.env` is never
 *   overwritten. On a server the values come from the platform, and a stray `.env` left in an
 *   image must not be able to replace them.
 * - **A missing file is not an error.** On a server there is no `.env` at all, and that is the
 *   normal case, not a failure.
 *
 * Deliberately not a dependency. This is a parser for `KEY=value` lines, roughly twenty of them.
 * It does no variable interpolation on purpose: `${OTHER}` inside a value stays literal, so a
 * secret that happens to contain a dollar sign cannot be mangled or partly expanded.
 *
 * Nothing here is ever logged. A parsed value is a secret until proven otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/api/.env`, resolved from this file, so the working directory does not matter. */
export const DEFAULT_ENV_PATH = resolve(
  join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
);

/**
 * Parse the contents of a `.env` file.
 *
 * Handles: blank lines, `#` comments, an `export ` prefix, and values wrapped in single or double
 * quotes. A quoted value keeps its inner whitespace; an unquoted one is trimmed. Anything after
 * the first `=` is the value, so a value may contain `=`.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export interface LoadDotEnvResult {
  readonly path: string;
  /** False when the file is not there, which is the normal case on a server. */
  readonly found: boolean;
  /** The names that were applied. Names only — a value is never returned or logged. */
  readonly applied: readonly string[];
  /** Names present in the file but already set in the environment, so left alone. */
  readonly skipped: readonly string[];
}

/**
 * Read the file and set any variable that is not already in `process.env`.
 *
 * Returns names only, never values, so a caller cannot accidentally log a secret.
 */
export function loadDotEnv(
  path: string = DEFAULT_ENV_PATH,
  env: NodeJS.ProcessEnv = process.env,
): LoadDotEnvResult {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return { path, found: false, applied: [], skipped: [] };
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(parseEnvFile(contents))) {
    if (env[key] !== undefined) {
      skipped.push(key);
      continue;
    }
    env[key] = value;
    applied.push(key);
  }

  return { path, found: true, applied, skipped };
}
