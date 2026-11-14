/**
 * Where the web's server side reaches `apps/api`: `127.0.0.1`, never `localhost`, which can
 * resolve to `::1` first, where the api does not listen.
 * `next.config.ts` keeps the same default as a literal; `test/api-origin.test.ts` holds the two
 * together.
 */
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:4000";

export function apiOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env["API_ORIGIN"] ?? DEFAULT_API_ORIGIN;
}
