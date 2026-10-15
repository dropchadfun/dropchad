/**
 * The welcome popup. The text
 * exactly. Shown on the first visit while the site is testnet only, and remembered in this
 * browser once it is closed, by either button, Escape or an outside click, never when it shows:
 * a reload before closing shows it again.
 */
export const WELCOME_TITLE = "welcome chad 🤌";

export const WELCOME_LINES = [
  "dropchad is in testnet mode right now, on solana devnet and robinhood chain testnet.",
  "everything here is test money, free to get and worth nothing, so play, drop and claim with zero risk.",
  "just keep your real coins safe in your main wallet for now.",
] as const;

/** The `try it on testnet` section of `/how`, `id="testnet"`. */
export const WELCOME_SETUP_HREF = "/how#testnet";

export const WELCOME_KEY = "dc-welcome-closed";

/** What `localStorage` needs to offer here. Every call can throw, like a blocked private window. */
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Show it when the site is testnet only and this browser never closed it. No storage: never. */
export function shouldShowWelcome(storage: Store, testnetOnly: boolean): boolean {
  if (!testnetOnly) return false;
  try {
    return storage.getItem(WELCOME_KEY) !== "1";
  } catch {
    return false;
  }
}

/** Closed: remember it. A storage that throws still closes it, for this page only. */
export function rememberWelcome(storage: Store): void {
  try {
    storage.setItem(WELCOME_KEY, "1");
  } catch {
    // Blocked storage: nothing else to do.
  }
}
