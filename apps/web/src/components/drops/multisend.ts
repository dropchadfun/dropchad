/**
 * The logic of the multisend page `/m/<address>`.
 * No React here, `MultisendView.tsx` renders it.
 */
import type { Metadata } from "next";

import { chipForOwnState, type Chip } from "@/components/drops/drop-card-data";
import type { DropDetail, MyMultisend } from "@/lib/api";
import { chainIdForKey, decimalsOf, nativeSymbol, shortChainName } from "@/lib/chains";
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
 * The receivers the api sent with the drop, option B: every row for the sender, the
 * paid rows for everyone else. By index. `null` when it sent none: an older api, no row of ours.
 */
export function receiversOf(detail: DropDetail): Receiver[] | null {
  const list = detail.ours.data?.receivers;
  if (list === undefined || list === null) return null;
  return list
    .map(({ index, recipient, amount }) => ({ index, recipient, amount }))
    .sort((a, b) => a.index - b.index);
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

/**
 * A `claim_paid` from the live stream: that one row paid, every other row the same object. A row
 * the list did not have, a stranger's view, is added in index order from the event.
 */
export function applyClaimPaid(
  rows: readonly ReceiverRow[],
  paid: {
    readonly index: number;
    readonly txHash: string;
    readonly recipient: string;
    readonly amount: string;
  },
): ReceiverRow[] {
  if (!rows.some((row) => row.index === paid.index)) {
    const added: ReceiverRow = {
      index: paid.index,
      recipient: paid.recipient,
      amount: paid.amount,
      state: "paid",
      txHash: paid.txHash,
    };
    return [...rows, added].sort((a, b) => a.index - b.index);
  }
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
 * One row of `your multisends`, `/multisends`: a link to its `/m/` page, the title
 * or `multisend`, and the grey line, chip and progress of that page.
 */
export function myMultisendRow(
  row: MyMultisend,
  now = Date.now(),
): { href: string; title: string; line: string; chip: Chip; progress: string } {
  return {
    href: `/m/${row.address}`,
    title: row.title ?? "multisend",
    line: summaryLine(
      {
        amountWei: row.totalEntitlements,
        chainId: chainIdForKey(row.chainKey) ?? 0,
        receivers: row.leafCount,
        createdAt: Math.floor(Date.parse(row.createdAt) / 1000),
      },
      now,
    ),
    chip: chipForOwnState(row.state),
    progress: progressLine(row.paidCount, row.leafCount),
  };
}

/**
 * The api's word, `yours`, from the session cookie. Never a profile comparison:
 * the api sends no `creator` for a multisend. Only a browser read can be true, the server's
 * own read carries no cookie.
 */
export function isSender(detail: DropDetail): boolean {
  return detail.ours.data?.yours === true;
}

/**
 * `noindex`: a list of wallets does not belong in a search engine. While it waits for money the
 * tab has no address: the server cannot tell the sender.
 */
export function multisendMetadata(address: string, waiting: boolean): Metadata & { title: string } {
  return {
    title: waiting ? "multisend" : `multisend ${shortAddress(address)}`,
    robots: { index: false, follow: false },
  };
}
