/**
 * the parts of a funding answer (,
 * ). A SOL or ETH drop is one part, the whole amount. A token drop is two,
 * both to the drop address: the tokens first, then the SOL, the fee and the receivers' token
 * accounts. Each part has its own payment link, so each gets its own QR. No React here.
 */
import type { DropDetail, Funding } from "@/lib/api";
import { formatDayMonth } from "@/lib/format";
import { NO_TICKER } from "@/lib/token";

export interface FundingPart {
  readonly kind: "token" | "native";
  /** Base units, a decimal string: the exact amount to send. */
  readonly amountBaseUnits: string;
  readonly decimals: number;
  /** The ticker, the word `tokens` for a token with none. */
  readonly symbol: string;
  /** Solana Pay, with `spl-token` on the token part; EIP 681 on an EVM chain. */
  readonly paymentUri: string;
}

export function fundingParts(funding: Funding): FundingPart[] {
  const native: FundingPart = {
    kind: "native",
    amountBaseUnits: funding.amountBaseUnits,
    decimals: funding.decimals,
    symbol: funding.symbol,
    paymentUri: funding.paymentUri,
  };
  const token = funding.token;
  if (token === undefined) return [native];
  return [
    {
      kind: "token",
      amountBaseUnits: token.amountBaseUnits,
      decimals: token.decimals,
      symbol: token.symbol ?? NO_TICKER,
      paymentUri: token.paymentUri,
    },
    native,
  ];
}

/**
 * The server's read for the drop page. It has no cookie, so it is never the
 * creator's: the funding answer stays out of the HTML and `yours` is false. The browser reads
 * the drop again with the cookie, and only the creator gets the funding card from that read.
 */
export function withoutFunding(detail: DropDetail): DropDetail {
  const ours = detail.ours.data;
  if (!ours) return detail;
  const { funding: _funding, ...rest } = ours;
  return { ...detail, ours: { ...detail.ours, data: { ...rest, yours: false } } };
}

/**
 * The funding limit on every funding card: after the deadline
 * the worker cancels and sends what arrived to the refund address, on both chains. `deadline` is
 * the api's unix seconds. The day, month, hour and minute in UTC, never the length: an older
 * drop has 7 days, a new one 24 hours. No number, no line.
 */
export function fundingLimitLine(deadline: string, kind: "drop" | "multisend"): string | null {
  if (!/^[1-9]\d*$/.test(deadline)) return null;
  const date = new Date(Number(deadline) * 1000);
  const day = formatDayMonth(date.toISOString());
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}\u00a0UTC`;
  return (
    `fund it by ${day}, ${time}. if not, the ${kind} is called off and anything you sent goes ` +
    `back to your refund address.`
  );
}

const pad2 = (value: number) => String(value).padStart(2, "0");
