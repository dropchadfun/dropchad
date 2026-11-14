/**
 * `npm run db:migrate` — apply the SQL migrations to the database in `DATABASE_URL`.
 *
 * The server does this on start too, so this script is only for running migrations on their own,
 * for example against a fresh data directory before the first boot.
 */
import { loadConfig } from "../config.js";
import { loadDotEnv } from "../load-env.js";
import { migrate, openDatabase } from "./client.js";

// Same reason as in src/index.ts: this runs under tsx, which does not read .env by itself.
loadDotEnv();

const config = loadConfig();
const handle = await openDatabase(config.DATABASE_URL);

try {
  const ran = await migrate(handle.client);
  console.log(ran.length === 0 ? "database already up to date" : `applied: ${ran.join(", ")}`);
} finally {
  await handle.close();
}
