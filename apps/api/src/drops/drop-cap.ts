/**
 * The cap per drop. Api env per chain: the
 * native coin in base units, each quick token in whole
 * tokens. Any other token has no value cap; the people cap is the guard. `totalEntitlements` is
 * counted, never the fee. Mainnet chains only, by the registry's `kind` like `minReceiverUsd`
 * a testnet has no cap at all.
 */
import { findQuickToken, getChain } from "@dropchad/chains";

import type { ChainAdapter } from "../chain/adapter.js";
import type { Config } from "../config.js";

export type DropCapConfig = Pick<
  Config,
  "SOLANA_MAX_DROP_LAMPORTS" | "EVM_MAX_DROP_WEI" | "SOLANA_MAX_DROP_STABLE" | "EVM_MAX_DROP_STABLE"
>;

export interface DropCap {
  /** Base units. */
  readonly max: bigint;
  readonly symbol: string;
  readonly decimals: number;
}

export class DropTooBigError extends Error {
  constructor(readonly cap: DropCap) {
    super(`a drop holds at most ${cap.max.toString()} base units of ${cap.symbol}`);
    this.name = "DropTooBigError";
  }
}

/**
 * The cap for this drop's asset on this chain, or `null`: a testnet, or a token with no value
 * cap.
 */
export function dropCapFor(
  config: DropCapConfig,
  chain: Pick<ChainAdapter, "family" | "chainKey" | "nativeSymbol" | "decimals">,
  token: { readonly mint: string; readonly decimals: number } | null,
): DropCap | null {
  if (getChain(chain.chainKey).kind !== "mainnet") return null;
  const svm = chain.family === "svm";
  if (token === null) {
    return {
      max: BigInt(svm ? config.SOLANA_MAX_DROP_LAMPORTS : config.EVM_MAX_DROP_WEI),
      symbol: chain.nativeSymbol,
      decimals: chain.decimals,
    };
  }
  // only quick tokens carry the stable cap, there is no other list.
  const symbol = findQuickToken(chain.chainKey, token.mint)?.symbol;
  if (symbol === undefined) return null;
  const whole = BigInt(svm ? config.SOLANA_MAX_DROP_STABLE : config.EVM_MAX_DROP_STABLE);
  return {
    max: whole * 10n ** BigInt(token.decimals),
    symbol,
    decimals: token.decimals,
  };
}

/** Throws `DropTooBigError` one base unit over the cap; at the cap is allowed. */
export function checkDropCap(cap: DropCap | null, totalEntitlements: bigint): void {
  if (cap !== null && totalEntitlements > cap.max) throw new DropTooBigError(cap);
}
