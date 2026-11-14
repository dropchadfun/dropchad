/**
 * The optional parts of the api. At start, each folder of `src/` that holds an `addon.ts` is
 * loaded, in name order, and its `start` is called with the context below. The `stop` each one
 * gives back runs on shutdown, the last started first, before the database closes. No folder
 * with an `addon.ts`: nothing loads and nothing is mounted. A `start` that fails stops the start
 * of the api.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PGlite } from "@electric-sql/pglite";
import type { Hono } from "hono";
import type { Address } from "viem";

import type { AppEnv } from "./app.js";
import type { KmsClient } from "./chain/kms.js";
import type { Config } from "./config.js";
import type { Database } from "./db/client.js";

export interface AddonContext {
  /** Routes go on here before the server listens. */
  readonly app: Hono<AppEnv>;
  readonly config: Config;
  readonly db: Database;
  readonly client: PGlite;
  readonly kms: KmsClient | null;
  /** The raw env: an optional part reads its own names, which `config.ts` does not know. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The drop key addresses, so an optional part can keep its own keys apart from them. */
  readonly keys: { readonly relayer?: Address | undefined; readonly binder?: Address | undefined };
}

export interface AddonHandle {
  stop(): void;
}

export interface StartedAddons {
  /** The folders that were loaded, in start order. */
  readonly names: readonly string[];
  stop(): void;
}

type StartFn = (ctx: AddonContext) => Promise<AddonHandle>;

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * The file each folder is looked at for, with this loader's own ending: `addon.ts` when the api
 * runs from source, `addon.js` when it runs from built files. So a source file never loads next
 * to a built one.
 */
export function addonFileName(loaderUrl: string = import.meta.url): string {
  const ending = /\.[a-z]+$/.exec(new URL(loaderUrl).pathname)?.[0] ?? ".js";
  return `addon${ending}`;
}

export async function startAddons(
  ctx: AddonContext,
  root: string = SRC,
  fileName: string = addonFileName(),
): Promise<StartedAddons> {
  const names = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, fileName)))
        .map((entry) => entry.name)
        .sort()
    : [];

  const handles: AddonHandle[] = [];
  for (const name of names) {
    const loaded = (await import(pathToFileURL(join(root, name, fileName)).href)) as {
      start?: unknown;
    };
    if (typeof loaded.start !== "function") {
      throw new Error(`${name}/${fileName} has no start function`);
    }
    handles.push(await (loaded.start as StartFn)(ctx));
  }

  return {
    names,
    stop() {
      for (const handle of [...handles].reverse()) handle.stop();
    },
  };
}
