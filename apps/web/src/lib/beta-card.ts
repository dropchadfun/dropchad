/**
 * The beta card. Mainnet only, on the first visit,
 * remembered in this browser once it is closed, never when it shows: a reload before closing
 * shows it again. The cap lines between the head and the tail come from `betaCardCaps`.
 */
export const BETA_CARD_TITLE = "dropchad beta 🤌";

export const BETA_CARD_HEAD = "max per drop";

export const BETA_CARD_TAIL = [
  "memecoins, no limit",
  "we start small on purpose",
  "limits go up step by step",
] as const;

export const BETA_CARD_KEY = "dc-beta-closed";

/** What `localStorage` needs to offer here. Every call can throw, like a blocked private window. */
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Show it on mainnet when this browser never closed it. No storage: never. */
export function shouldShowBetaCard(storage: Store, testnetOnly: boolean): boolean {
  if (testnetOnly) return false;
  try {
    return storage.getItem(BETA_CARD_KEY) !== "1";
  } catch {
    return false;
  }
}

/** Closed: remember it. A storage that throws still closes it, for this page only. */
export function rememberBetaCard(storage: Store): void {
  try {
    storage.setItem(BETA_CARD_KEY, "1");
  } catch {
    // Blocked storage: nothing else to do.
  }
}
