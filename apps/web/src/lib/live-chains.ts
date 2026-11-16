/**
 * The live view of the api switch: which chains on
 * `API_LISTED_CHAINS` the api lists, read on the web server from `GET /api/chains`. No-store,
 * 1.5 s at most, kept 30 s in memory, and the last good answer is kept while the api is slow or
 * down. No good answer since the server started is `NO_API_VIEW`: those chains stay hidden.
 */
import { apiOrigin } from "@/lib/api-origin";
import { API_LISTED_CHAINS, NO_API_VIEW, type LiveView } from "@/lib/chains";

/** How long one answer is used before the next read. */
export const LIVE_TTL_MS = 30_000;
/** A read slower than this keeps what the server had. */
export const LIVE_READ_TIMEOUT_MS = 1_500;

interface ChainsRow {
  readonly key?: unknown;
  readonly createsOn?: unknown;
}

/** The view from the rows of one answer: listed keys on the list, and those with new drops off. */
export function viewFromRows(rows: readonly ChainsRow[]): LiveView {
  const listed = new Set<string>();
  const paused = new Set<string>();
  for (const row of rows) {
    if (typeof row.key !== "string" || !API_LISTED_CHAINS.includes(row.key)) continue;
    listed.add(row.key);
    if (row.createsOn === false) paused.add(row.key);
  }
  return { listed, paused };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** One reader per server process. `fetch` and `now` are for the tests. */
export function createLiveChainsReader(
  options: { readonly fetch?: FetchFn; readonly now?: () => number } = {},
): () => Promise<LiveView> {
  const fetchFn: FetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  let good: LiveView | null = null;
  let readAt: number | null = null;

  async function readOnce(): Promise<LiveView | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LIVE_READ_TIMEOUT_MS);
    });
    const answer = (async () => {
      try {
        const response = await fetchFn(`${apiOrigin()}/api/chains`, { cache: "no-store" });
        if (!response.ok) return null;
        const body = (await response.json()) as { chains?: unknown };
        return Array.isArray(body.chains) ? viewFromRows(body.chains as ChainsRow[]) : null;
      } catch {
        return null;
      }
    })();
    try {
      return await Promise.race([answer, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return async () => {
    const at = now();
    if (readAt !== null && at - readAt < LIVE_TTL_MS) return good ?? NO_API_VIEW;
    readAt = at;
    const fresh = await readOnce();
    if (fresh !== null) good = fresh;
    return good ?? NO_API_VIEW;
  };
}

/** The web server's reader. */
export const readLiveChains: () => Promise<LiveView> = createLiveChainsReader();
