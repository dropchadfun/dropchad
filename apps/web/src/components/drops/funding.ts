/**
 * The parts of a funding answer. A SOL or ETH drop is one part, the whole amount. A token drop is two,
 * both to the drop address: the tokens first, then the SOL, the fee and the receivers' token
 * accounts. Each part has its own payment link, so each gets its own QR. No React here.
 */
import type { DropDetail, Funding } from "@/lib/api";
import type { ChainFamily } from "@/lib/chains";
import { exactAmount, formatDayMonth } from "@/lib/format";
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
 * the drop again, and everyone gets the funding card from that read.
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

/**
 * `pay with wallet` shows on a phone only: a computer's wallet seldom opens a `solana:` or `ethereum:` link, so there the QR
 * and the copy buttons are the way. A phone is the browser's `(pointer: coarse)`.
 */
export function payButtonShows(env: { readonly coarsePointer: boolean }): boolean {
  return env.coarsePointer;
}

/**
 * The grey line under the pay button: which app opens, and the
 * way out, since the site cannot tell if a wallet opened.
 */
export function noWalletLine(family: ChainFamily): string {
  const opens = family === "evm" ? "opens MetaMask." : "opens your default wallet app.";
  return `${opens} no wallet opened? scan the QR or copy the address.`;
}

/**
 * The words on the pay button: what its link pays and where,
 * `pay 1.01 SOL to …pY3o`, so the sender can match them in the wallet. The exact amount, the same
 * number as the link and `copy amount`: every decimal, no comma. The last 4 of the address, as
 * written.
 */
export function payLabel(part: {
  readonly amountBaseUnits: string;
  readonly decimals: number;
  readonly symbol: string;
  readonly address: string;
}): string {
  const amount = exactAmount(part.amountBaseUnits, part.decimals);
  return `pay ${amount} ${part.symbol} to …${part.address.slice(-4)}`;
}

/**
 * MetaMask's send link: the part's own EIP
 * 681 link with `ethereum:` swapped for `https://link.metamask.io/send/`, so MetaMask opens the
 * payment at once with the amount and address filled in. ETH `<to>@<chainId>?value=<wei>`, a
 * token `<token>@<chainId>/transfer?address=<to>&uint256=<amount>`.
 */
export function metamaskSendLink(paymentUri: string): string {
  return paymentUri.replace(/^ethereum:/, "https://link.metamask.io/send/");
}

/**
 * The pay button's link: a tap opens
 * the wallet at once with everything filled in. On Solana the same link as the QR; on Robinhood
 * MetaMask's send link. The QR keeps the plain link, so another wallet can scan it.
 */
export function payLink(family: ChainFamily, paymentUri: string): string {
  return family === "evm" ? metamaskSendLink(paymentUri) : paymentUri;
}
