/**
 * The wait line on `/create` while the drop is being made. The api
 * may send the create again after an expiry, so a slow answer is not an error.
 */

/** How long the create may take before the page says the network is busy. */
export const CREATE_WAIT_MS = 20_000;

const WAIT_LINE = "solana is busy. we are trying again. nothing left your wallet.";

/** The line to show after `waitedMs` of waiting, or `null` while it is still short. */
export function createWaitLine(waitedMs: number): string | null {
  return waitedMs >= CREATE_WAIT_MS ? WAIT_LINE : null;
}
