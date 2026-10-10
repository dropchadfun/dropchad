/**
 * The client `apps/api` uses to reach the indexer.
 *
 * **Why this forwarder exists.** Local dev runs PGlite, and PGlite is single process: the indexer
 * owns its database directory and a second process cannot open it. So the queries live where the
 * data is, and `apps/api` serves the public routes by asking the indexer.
 *
 * **When it goes away.** On the server both processes talk to one Postgres, and `apps/api` queries
 * it directly. The route shapes are already the public shapes, so that swap does not change any
 * response.
 *
 * The indexer is trusted infrastructure on a private address, not a user. Its replies are still
 * passed through unchanged rather than re-parsed field by field: this is a forwarder, and adding a
 * second schema here would be a second place to update every time a column is added.
 */
export interface IndexerClient {
  listDrops(limit: number): Promise<unknown>;
  /** `null` means the indexer knows of no such drop. That is an answer, not a failure. */
  getDrop(address: string): Promise<unknown>;
  getStats(): Promise<unknown>;
  /**
   * Final, verified drops with their final claim totals and distinct recipients. The raw
   * material for `GET /api/boards`, grouped in the api because only the api knows which X id is
   * behind a commitment. `since` is unix seconds, `null` for all time.
   */
  listBoardDrops(since: number | null): Promise<BoardDropsResponse>;
  isHealthy(): Promise<boolean>;
}

/** One row of `GET /board-drops` on the indexer. Amounts are wei as decimal strings. */
export interface BoardDrop {
  readonly address: string;
  /** Absent on an indexer row, which is always the EVM chain the indexer follows. */
  readonly chainKey?: string;
  readonly creatorCommitment: string;
  /** Unix seconds, as a string like every other chain number. */
  readonly createdAt: string;
  readonly claimedFinalWei: string;
  readonly claimedCountFinal: number;
  readonly recipients: readonly string[];
  /**
   * The merkle indexes of the final claims. A handle drop counts only through these, read
   * through `drop_handle_leaves` to the X ids behind them. The EVM indexer
   * sends them; until then an EVM handle drop counts zero. The Solana reader fills
   * them from the bitmap.
   */
  readonly claimedIndexes?: readonly number[];
}

export interface BoardDropsResponse {
  readonly drops: readonly BoardDrop[];
  readonly finality: "final";
}

export class IndexerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("indexer unavailable", cause === undefined ? undefined : { cause });
    this.name = "IndexerUnavailableError";
  }
}

export interface IndexerClientOptions {
  /** The indexer's origin, for example `http://localhost:42069`. */
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  /** A slow indexer must not hold an api request open forever. */
  readonly timeoutMs?: number;
}

export function createIndexerClient(options: IndexerClientOptions): IndexerClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const base = options.baseUrl.replace(/\/$/, "");

  async function get(path: string): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch (error) {
      throw new IndexerUnavailableError(error);
    }
  }

  return {
    async listDrops(limit) {
      const response = await get(`/drops?limit=${String(limit)}`);
      if (!response.ok) throw new IndexerUnavailableError();
      return response.json();
    },

    async getDrop(address) {
      const response = await get(`/drops/${address}`);
      // A drop that does not exist is a normal answer, not an outage.
      if (response.status === 404) return null;
      if (!response.ok) throw new IndexerUnavailableError();
      return response.json();
    },

    async getStats() {
      const response = await get(`/stats`);
      if (!response.ok) throw new IndexerUnavailableError();
      return response.json();
    },

    async listBoardDrops(since) {
      const query = since === null ? "" : `?since=${String(since)}`;
      const response = await get(`/board-drops${query}`);
      if (!response.ok) throw new IndexerUnavailableError();
      // The indexer is ours and on a private address. Its shape is trusted like the others.
      return response.json() as Promise<BoardDropsResponse>;
    },

    async isHealthy() {
      try {
        return (await get("/health")).ok;
      } catch {
        return false;
      }
    },
  };
}
