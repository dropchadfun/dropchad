import { TESTNET_ONLY } from "@/lib/chains";

/** The words after a dollar total on testnet. */
export const TEST_COINS = "in test coins";

/**
 * The small grey line under a dollar tile on testnet
 * test coins are counted at real prices, so a total alone looks like real money. Nothing on
 * mainnet; the same flag as the `testnet` mark, never copied into a component.
 */
export function TestCoinsLine({ testnetOnly = TESTNET_ONLY }: { testnetOnly?: boolean }) {
  if (!testnetOnly) return null;
  return <span className="type-small mt-1 block truncate text-chad-text-dim">{TEST_COINS}</span>;
}
