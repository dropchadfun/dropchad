import type { ReactNode } from "react";

import { tickerCut } from "@/lib/token";
import { cn } from "@/lib/utils";

/** The token logo in a list amount, px: one size in every list. */
export const ROW_LOGO = 20;

/** Up to this many characters a ticker never needs a hover text. */
const PLAIN_MAX = 6;

/**
 * A ticker next to an amount: up to 16 characters in full, over 16 the first 15
 * and `…`. With `edge` it also ends in `…` at its box's edge, for rows and cards. A longer
 * ticker keeps its full text in `title` and `aria-label`.
 */
export function Ticker({
  symbol,
  edge = false,
  className,
}: {
  symbol: string;
  edge?: boolean;
  className?: string;
}) {
  const long = symbol.length > PLAIN_MAX;
  return (
    <span
      className={cn(edge && "min-w-0 truncate", className) || undefined}
      title={long ? symbol : undefined}
      aria-label={long ? symbol : undefined}
    >
      {tickerCut(symbol)}
    </span>
  );
}

/**
 * A row's amount: the logo and the number whole, the ticker after it cut at the
 * row's edge, at most about 8 characters wide. One size, never shrinks.
 */
export function RowAmount({
  amount,
  symbol,
  logo = null,
  className,
  tickerClassName = "text-chad-text-dim",
}: {
  amount: ReactNode;
  symbol: string;
  logo?: ReactNode;
  className?: string;
  tickerClassName?: string;
}) {
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center", className)}>
      {logo === null ? null : <span className="mr-1.5 flex shrink-0">{logo}</span>}
      <span className="shrink-0">{amount}</span>
      <Ticker symbol={symbol} edge className={cn("ml-1 max-w-[8ch]", tickerClassName)} />
    </span>
  );
}
