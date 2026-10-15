import { Avatar } from "@/components/site/Avatar";
import { Empty } from "@/components/site/Empty";
import { TickingNumber } from "@/components/site/TickingNumber";
import { TokenLogo } from "@/components/site/TokenLogo";
import type { TokenInfo } from "@/lib/api";
import { txUrl } from "@/lib/chains";
import { formatAmount, formatCount } from "@/lib/format";
import { dropUnit, tickerShow } from "@/lib/token";
import { cn } from "@/lib/utils";

/** One paid leaf on the drop page. */
export interface PaidEntry {
  readonly index: number;
  /** Where the money landed. Never shown on the drop page; `null` on a Solana claim. */
  readonly recipient: string | null;
  /** The receiver's X account. `null` when the api knows none. */
  readonly handle: string | null;
  readonly profileImageUrl: string | null;
  readonly amountWei: string;
  /** `null` when the chain reports the payment but not the transaction, Solana bitmap reads. */
  readonly txHash: string | null;
  /** Arrived over the stream while this page was open, so its row flashes once. */
  readonly fresh: boolean;
}

/** `@handle`, or the leaf's place `#1` when no X account is known. Never an address. */
export function paidLabel(entry: Pick<PaidEntry, "index" | "handle">): string {
  return entry.handle === null ? `#${String(entry.index + 1)}` : `@${entry.handle}`;
}

/**
 * The big `people fed 1 of 2`, the amount, and the bar. Live, the counter is a number going up,
 * `--chad-up`; settled, it is white. The bar is the accent.
 */
export function FedProgress({
  paidCount,
  leafCount,
  amountWei,
  chainId,
  token = null,
  live,
}: {
  paidCount: number;
  leafCount: number;
  amountWei: string;
  chainId: number;
  /** A token drop's token: the amount is in it, with its logo. */
  token?: TokenInfo | null;
  live: boolean;
}) {
  const unit = dropUnit(chainId, token);
  // The plain ticker here, never `$TEST`; long ones one size smaller, cut over 10.
  const shown = token?.symbol ? tickerShow(token.symbol) : { text: unit.symbol, small: false };
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="type-label">people fed</p>
          <p className={cn("type-display", live && "text-chad-up")}>
            <TickingNumber value={paidCount} format={formatCount} />
            <span className="type-body ml-2 font-medium text-chad-text-dim">
              of {formatCount(leafCount)}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="type-label">{live ? "dropping" : "dropped"}</p>
          <p className="type-stat">
            {token ? <TokenLogo token={token} size={20} className="-mt-1 mr-2" /> : null}
            {formatAmount(amountWei, unit.decimals)}{" "}
            <span
              className={
                shown.small
                  ? "type-label font-medium normal-case text-chad-text-dim"
                  : "type-small font-medium text-chad-text-dim"
              }
            >
              {shown.text}
            </span>
          </p>
        </div>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-chad-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={leafCount}
        aria-valuenow={paidCount}
      >
        <div
          className="h-full rounded-full bg-chad-accent transition-[width] duration-[400ms] ease-(--ease-enter)"
          style={{
            width: `${String(Math.min(100, (paidCount / Math.max(1, leafCount)) * 100))}%`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * `who got fed`: each paid receiver by X picture and `@handle`, the amount, the transaction when
 * the chain has one. Never the address the money landed on. A row that arrived live
 * flashes mint once, `.fed-flash` in `globals.css`, off with reduced motion.
 */
export function FedList({
  entries,
  chainId,
  token = null,
  live,
  empty,
}: {
  entries: readonly PaidEntry[];
  chainId: number;
  /** A token drop's token: each payout is in it. */
  token?: TokenInfo | null;
  live: boolean;
  empty: string;
}) {
  const { symbol, decimals } = dropUnit(chainId, token);
  return (
    <section className="mt-8">
      <p className="type-label mb-2">who got fed</p>
      {entries.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="type-table max-h-[520px] overflow-y-auto">
          {entries.map((entry) => {
            const link = entry.txHash === null ? null : txUrl(chainId, entry.txHash);
            return (
              <li
                key={entry.index}
                className={cn("row flex items-center gap-3 px-2 py-2", entry.fresh && "fed-flash")}
              >
                {entry.handle === null ? (
                  <span
                    aria-hidden="true"
                    className="size-8 shrink-0 rounded-full bg-chad-surface-2"
                  />
                ) : (
                  <Avatar src={entry.profileImageUrl} name={entry.handle} size={32} />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{paidLabel(entry)}</span>
                <span className={cn("num font-medium", live && "text-chad-up")}>
                  {live ? "+" : ""}
                  {formatAmount(entry.amountWei, decimals)} {symbol}
                </span>
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="type-small text-chad-text-dim hover:text-chad-text"
                  >
                    tx ↗
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
