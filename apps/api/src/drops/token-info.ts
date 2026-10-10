/**
 * every api answer names the token.
 *
 * A token drop's row carries what the token check read at create, migration `0018`: the token
 * program, the decimals, the name and the ticker. This turns them into the one `token` object
 * the drop rows, the drop page, the share card and the claim list all send, and gives the plain
 * `symbol` and `decimals` those answers already had the token's values. A SOL or ETH drop has no
 * token: `null`, and the chain's coin as before.
 */
import { findChain, findQuickToken } from "@dropchad/chains";

import type { ChainAdapter, FundingInstructions } from "../chain/adapter.js";
import type { DropRow } from "../db/schema.js";

export interface TokenInfo {
  readonly mint: string;
  /** The ticker, `null` when the token has none, like devnet USDC. */
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number;
  readonly tokenProgram: string;
  /**
   * Always the link: the route answers `404 no_logo` when there is none,
   * and the web falls back to the ticker's first letter. The logo is never stored on the row.
   */
  readonly logoUrl: string;
  /** Where it launched, kept at create; `null` when unknown or older than `0019`. */
  readonly launchpad: "pump.fun" | null;
}

type TokenColumns = Pick<
  DropRow,
  "asset" | "tokenProgram" | "tokenDecimals" | "tokenName" | "tokenSymbol" | "tokenLaunchpad"
> & {
  /** Picks the logo route's chain. Absent means Solana, as before Robinhood tokens. */
  readonly chainKey?: string;
};

/**
 * for a quick token, by its chain and exact address, the ticker,
 * the name and the logo are ours, never the chain's and never `tokens`. Any other address, or
 * no chain, keeps exactly what it has. The token check, create and every answer use this.
 */
export function withQuickToken<
  T extends {
    readonly name: string | null;
    readonly symbol: string | null;
    readonly logoUrl: string | null;
  },
>(chainKey: string | undefined, mint: string, value: T): T {
  const quick = chainKey === undefined ? undefined : findQuickToken(chainKey, mint);
  if (quick === undefined) return value;
  return { ...value, name: quick.name, symbol: quick.symbol, logoUrl: quick.logo ?? value.logoUrl };
}

/** The token of a token drop, `null` on a SOL or ETH drop. */
export function tokenInfoOf(row: TokenColumns): TokenInfo | null {
  if (row.tokenProgram === null || row.tokenDecimals === null) return null;
  return withQuickToken<TokenInfo>(row.chainKey, row.asset, {
    mint: row.asset,
    symbol: row.tokenSymbol,
    name: row.tokenName,
    decimals: row.tokenDecimals,
    tokenProgram: row.tokenProgram,
    // The logo route of the drop's chain; on Robinhood it answers `404 no_logo`.
    logoUrl: `/api/tokens/${row.asset}/logo?chain=${row.chainKey !== undefined && findChain(row.chainKey)?.family === "evm" ? "robinhood" : "solana"}`,
    // Only the on chain sign is ever passed on.
    launchpad: row.tokenLaunchpad === "pump.fun" ? "pump.fun" : null,
  });
}

/** What the plain `symbol` fields say when a token has no ticker (was the short mint). */
export const NO_TICKER = "tokens";

/** The unit an amount of this drop is in: the token's, or the chain's coin. */
export function unitOfDrop(
  row: TokenColumns,
  coin: { readonly symbol: string; readonly decimals: number },
): { symbol: string; decimals: number } {
  const token = tokenInfoOf(row);
  if (token === null) return { symbol: coin.symbol, decimals: coin.decimals };
  return { symbol: token.symbol ?? NO_TICKER, decimals: token.decimals };
}

/**
 * The funding answer for a drop still waiting for money, the same object `POST /api/drops`
 * sent: the SOL part (the whole amount on a SOL drop; the fee and the account budget on a
 * token drop) and the token part. A reload of the drop page reads it from here, never from the
 * token total.
 */
export function fundingOf(row: DropRow, chain: ChainAdapter): FundingInstructions {
  const token = tokenInfoOf(row);
  if (token === null || row.vault === null) {
    return chain.fundingInstructions({
      drop: row.address,
      amount: BigInt(row.grossRequired),
      fundingDeadline: row.fundingDeadline,
    });
  }
  return chain.fundingInstructions({
    drop: row.address,
    amount: BigInt(row.solFeeLamports ?? "0") + BigInt(row.accountBudgetLamports ?? "0"),
    fundingDeadline: row.fundingDeadline,
    token: {
      mint: token.mint,
      vault: row.vault,
      tokenProgram: token.tokenProgram,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      amount: BigInt(row.totalEntitlements),
    },
  });
}
