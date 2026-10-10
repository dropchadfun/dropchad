/**
 * The database connection, and the migration runner.
 *
 * Local dev runs **PGlite**: Postgres compiled to WebAssembly, no native build, no Docker, no
 * service to start. It is the same Postgres dialect as the server, so `migrations/*.sql` runs
 * unchanged in both places and moving to a real Postgres later is a driver swap in this one file.
 *
 * PGlite is **single process**. Two node processes cannot open the same directory, which is why
 * `apps/api` and the indexer each own their own database and the api talks to the indexer over
 * HTTP instead of reading its files.
 */
import { mkdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly client: PGlite;
  close(): Promise<void>;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Open the database named by `DATABASE_URL`.
 *
 * - `memory://`      an in-memory PGlite. Every test file gets its own.
 * - anything else    a PGlite data directory, for example `./.data/api`.
 * - `postgres://...` **not wired yet**. It fails loudly rather than silently doing something else.
 */
export async function openDatabase(databaseUrl: string): Promise<DatabaseHandle> {
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    throw new Error(
      "DATABASE_URL points at a Postgres server, which is not wired up yet. Local dev uses " +
        "PGlite: set DATABASE_URL to a directory path such as ./.data/api, or memory:// for a " +
        "throwaway database. Switching to Postgres is a driver change in src/db/client.ts.",
    );
  }

  let client: PGlite;
  if (databaseUrl === "memory://") {
    client = new PGlite();
  } else {
    // PGlite does not create its own data directory, so a fresh clone with the default
    // `./.data/api` failed on first start. Found. `recursive` makes this a no-op on
    // every start after the first.
    mkdirSync(databaseUrl, { recursive: true });
    client = new PGlite(databaseUrl);
  }
  await client.waitReady;
  const db = drizzle(client, { schema });

  let closed = false;
  return {
    db,
    client,
    // Idempotent on purpose. Shutdown can be reached twice, from SIGINT and from a finally block,
    // and closing an already closed PGlite throws.
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}

/**
 * Apply every `.sql` file in `migrations/`, in file name order, each one inside a transaction.
 *
 * Applied files are recorded in `_migrations`, so running this twice is a no-op. Plain SQL files
 * are used instead of a generator so that what runs against Postgres is exactly what is in the
 * repo and reviewed.
 *
 * This talks to PGlite directly rather than through drizzle, because a migration file holds
 * several statements and drizzle's `execute` goes through the extended query protocol, which
 * takes one statement at a time. `exec` is the multi statement door.
 */
export async function migrate(client: PGlite): Promise<string[]> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await client.query<{ name: string }>(`SELECT name FROM _migrations`);
  const done = new Set(applied.rows.map((row) => row.name));

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  const ran: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const statements = await readFile(join(migrationsDir, file), "utf8");

    await client.exec("BEGIN");
    try {
      await client.exec(statements);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      await client.exec("COMMIT");
    } catch (error) {
      await client.exec("ROLLBACK");
      throw new Error(`migration ${file} failed`, { cause: error });
    }
    ran.push(file);
  }
  return ran;
}

/** Open the database and bring it up to date. This is what the server and the tests both call. */
export async function openAndMigrate(databaseUrl: string): Promise<DatabaseHandle> {
  const handle = await openDatabase(databaseUrl);
  await migrate(handle.client);
  return handle;
}
