/**
 * The eth_getLogs block range per registry chain, Ponder's `ethGetLogsBlockRange`. In Ponder
 * 0.17.10 each request covers at most this many blocks, and a refused range is not retried
 * smaller.
 *
 * The public Robinhood testnet RPC refuses more than 100,000 blocks per request. Ponder's own
 * guess sent 100,001, the RPC refused it, and the indexer crashed about every 20 minutes on the
 * server. 50,000 is half the limit. A chain not listed here gets `undefined`, and
 * Ponder finds the range from the RPC's errors, as before.
 */
const RANGES: Readonly<Record<string, number>> = {
  "robinhood-testnet": 50_000,
};

export function ethGetLogsBlockRangeFor(chainKey: string): number | undefined {
  return RANGES[chainKey];
}
