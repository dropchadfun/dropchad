/**
 * The usd price of a native coin, from Coingecko's free tier.
 *
 * One call fetches all three coins and is cached for `ttlMs`, so a burst of activations costs
 * one request. Every failure, a bad status, a thrown fetch, a timeout, a body that is not a
 * number, a coin we do not price, answers `null` and is logged once per failure: the worker
 * stores nothing and the drop counts zero. Nothing here ever throws into activation.
 *
 * Testnet ETH and devnet SOL are priced as the mainnet coin. That is a display number for a
 * board, not money, and it is said.
 */

export const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
};

export interface PriceService {
  /** Usd per whole coin, or `null` when it cannot be known right now. Never throws. */
  usdPrice(symbol: string): Promise<number | null>;
}

export interface PriceServiceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now: () => number;
  readonly ttlMs: number;
  readonly baseUrl?: string;
  readonly apiKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

export function createPriceService(options: PriceServiceOptions): PriceService {
  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.coingecko.com/api/v3").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 5_000;
  const log = options.log ?? ((line: string) => console.warn(line));
  const ids = Object.values(COINGECKO_IDS);

  let cache: { at: number; prices: ReadonlyMap<string, number> } | null = null;

  async function load(): Promise<ReadonlyMap<string, number> | null> {
    const now = options.now();
    if (cache !== null && now - cache.at < options.ttlMs) return cache.prices;

    const url = `${baseUrl}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.apiKey !== undefined && options.apiKey !== "") {
      headers["x-cg-demo-api-key"] = options.apiKey;
    }
    try {
      const response = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        log(`prices: coingecko answered ${String(response.status)}`);
        return null;
      }
      const body = (await response.json()) as Record<string, { usd?: unknown } | undefined>;
      const prices = new Map<string, number>();
      for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
        const usd = body[id]?.usd;
        if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) prices.set(symbol, usd);
      }
      if (prices.size === 0) {
        log("prices: coingecko body had no usable number");
        return null;
      }
      cache = { at: now, prices };
      return prices;
    } catch (error) {
      log(
        `prices: coingecko unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  return {
    async usdPrice(symbol) {
      if (!(symbol in COINGECKO_IDS)) return null;
      const prices = await load();
      return prices?.get(symbol) ?? null;
    },
  };
}
