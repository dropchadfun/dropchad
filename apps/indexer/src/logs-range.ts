/**
 * The eth_getLogs block range per registry chain, Ponder's `ethGetLogsBlockRange`. In Ponder
 * 0.17.10 each request covers at most this many blocks, and a refused range is not retried
 * smaller.
 *
 * The rule: a fixed range is at most half of the smallest block limit its
 * chain can apply.
 *
 * - `robinhood-testnet`: the public testnet RPC refuses more than 100,000 blocks per request.
 *   Ponder's own guess sent 100,001, the RPC refused it, and the indexer crashed about every 20
 *   minutes on the server. 50,000 is half the limit.
 * - `robinhood`: the public mainnet RPC allows 10,000,000 blocks with an address filter, but only
 *   30,000 without one, and at most 10,000 logs per answer. Ponder 0.17.10 asks the child drops of
 *   a factory by the event topics alone, with no address, once the factory has 1,000 children,
 *   so the 30,000 limit rules. 15,000 is half of it.
 *
 * With a fixed range Ponder does not retry a refused call and the indexer stops. The log then
 * shows the RPC's own text; the fix is a smaller value here, its own change. A chain not listed
 * here gets `undefined`, and Ponder finds the range from the RPC's errors, as before.
 */
const RANGES: Readonly<Record<string, number>> = {
  "robinhood-testnet": 50_000,
  robinhood: 15_000,
};

export function ethGetLogsBlockRangeFor(chainKey: string): number | undefined {
  return RANGES[chainKey];
}
