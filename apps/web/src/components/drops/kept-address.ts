import { pasteError } from "@/components/drops/claim";
import type { ChainFamily } from "@/lib/chains";

/**
 * The claim wallet kept in this browser only: one for EVM, one for Solana,
 * in `localStorage`, never sent to the server and never stored anywhere else.
 */
export const CLAIM_WALLET_KEY: Readonly<Record<ChainFamily, string>> = {
  evm: "dropchad.claimWallet.evm",
  svm: "dropchad.claimWallet.svm",
};

/** An address of that family, trimmed, or `null`. */
function walletOf(family: ChainFamily, text: string | null): string | null {
  const trimmed = (text ?? "").trim();
  return trimmed !== "" && pasteError(family, trimmed) === null ? trimmed : null;
}

/** The kept wallet of that family; `""` when none, not an address, or storage cannot be read. */
export function readClaimWallet(family: ChainFamily): string {
  if (typeof window === "undefined") return "";
  try {
    return walletOf(family, window.localStorage.getItem(CLAIM_WALLET_KEY[family])) ?? "";
  } catch {
    return "";
  }
}

/** Keeps the last wallet of that family. Anything not an address, or a storage failure: nothing. */
export function saveClaimWallet(family: ChainFamily, address: string): void {
  const wallet = walletOf(family, address);
  if (wallet === null || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAIM_WALLET_KEY[family], wallet);
  } catch {
    // Private mode or blocked storage: the field simply starts empty next time.
  }
}
