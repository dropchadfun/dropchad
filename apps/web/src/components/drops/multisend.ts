/**
 * The logic of the multisend page `/m/<address>`.
 * No React here, `MultisendView.tsx` renders it.
 */
import type { Metadata } from "next";

import type { DropDetail } from "@/lib/api";
import { decimalsOf, nativeSymbol, shortChainName } from "@/lib/chains";
import { formatAmount, formatCount, shortAddress, timeAgo } from "@/lib/format";

/** Rows shown at first, and added by each `show more`. */
export const MULTISEND_PAGE = 100;

/** One receiver as the manifest has it, without the proof. */
export interface Receiver {
  readonly index: number;
  readonly recipient: string;
  /** Base units, a decimal string. */
  readonly amount: string;
}

export type ReceiverState = "paid" | "waiting" | "failed";

export interface ReceiverRow extends Receiver {
  readonly state: ReceiverState;
  /** `null` while not paid, and on Solana, where the bitmap says paid but not which transaction. */
  readonly txHash: string | null;
}

/**
 * Every receiver of an address manifest, version 1, by index. `null` for anything else: a
 * handle manifest, version 2, names X ids and never belongs on this page; junk is not a list.
 * Takes the manifest as text or already parsed.
 */
export function receiversFromManifest(input: unknown): Receiver[] | null {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof doc !== "object" || doc === null) return null;
  const { version, mode, entries } = doc as {
    version?: unknown;
    mode?: unknown;
    entries?: unknown;
  };
  if (version !== 1 || mode !== undefined || !Array.isArray(entries)) return null;
  const out: Receiver[] = [];
  for (const entry of entries as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const { index, recipient, amount } = entry as Record<string, unknown>;
    if (typeof index !== "number" || typeof recipient !== "string" || typeof amount !== "string")
      return null;
    out.push({ index, recipient, amount });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Each receiver with its state. A claim on chain is paid, whatever an older failure said. */
export function receiverRows(
  receivers: readonly Receiver[],
  claims: readonly { readonly index: number; readonly transactionHash: string | null }[],
  failedIndexes: readonly number[],
): ReceiverRow[] {
  const paid = new Map(claims.map((claim) => [claim.index, claim.transactionHash] as const));
  const failed = new Set(failedIndexes);
  return receivers.map((receiver) =>
    paid.has(receiver.index)
      ? { ...receiver, state: "paid", txHash: paid.get(receiver.index) ?? null }
      : { ...receiver, state: failed.has(receiver.index) ? "failed" : "waiting", txHash: null },
  );
}

/** A `claim_paid` from the live stream: that one row paid, every other row the same object. */
export function applyClaimPaid(
  rows: readonly ReceiverRow[],
  paid: { readonly index: number; readonly txHash: string },
): ReceiverRow[] {
  return rows.map((row) =>
    row.index === paid.index ? { ...row, state: "paid", txHash: paid.txHash } : row,
  );
}

/** `show 100 more`, or fewer when fewer are left. `null` when every row is shown. */
export function moreLabel(total: number, shown: number): string | null {
  const left = total - shown;
  return left > 0 ? `show ${formatCount(Math.min(MULTISEND_PAGE, left))} more` : null;
}

export function progressLine(paid: number, total: number): string {
  return `${formatCount(paid)} of ${formatCount(total)} paid`;
}

/** The grey line under the title: `0.05 ETH to 12 wallets · Robinhood test · 3m ago`. */
export function summaryLine(
  drop: {
    readonly amountWei: string;
    readonly chainId: number;
    readonly receivers: number;
    /** Unix seconds. */
    readonly createdAt: number;
  },
  now = Date.now(),
): string {
  const amount = `${formatAmount(drop.amountWei, decimalsOf(drop.chainId))} ${nativeSymbol(drop.chainId)}`;
  const wallets = `${formatCount(drop.receivers)} ${drop.receivers === 1 ? "wallet" : "wallets"}`;
  return `${amount} to ${wallets} · ${shortChainName(drop.chainId)} · ${timeAgo(drop.createdAt, now)}`;
}

/**
 * The api's word, `yours`, from the session cookie. Never a profile comparison:
 * the api sends no `creator` for a multisend. Only a browser read can be true, the server's
 * own read carries no cookie.
 */
export function isSender(detail: DropDetail): boolean {
  return detail.ours.data?.yours === true;
}

/** `noindex`: a list of wallets does not belong in a search engine. */
export function multisendMetadata(address: string): Metadata & { title: string } {
  return {
    title: `multisend ${shortAddress(address)}`,
    robots: { index: false, follow: false },
  };
}
