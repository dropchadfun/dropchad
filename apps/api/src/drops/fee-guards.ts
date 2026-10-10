/**
 * The two fee guards on `POST /api/drops`.
 *
 * 1. **A minimum per receiver in usd.** 5 usd on a mainnet, 0.01 usd on a testnet, api config,
 *    Checked on every leaf after merging, in both modes. No price means no drop: the rule
 *    cannot be checked on a guess.
 * 2. **The fee covers the relayer.** The fee, `nativeDropFee` over what the chain says
 *    now (`max(minFee, total * bps / 10_000)` while the fields are zero), against the
 *    estimated cost of `createDrop`, `activate` and every claim at the current gas
 *    price. The adapter owns the estimate, the chains price a transaction differently.
 *
 * Both run before anything is sent, so a refused drop costs the relayer nothing.
 */
import type { Chain } from "@dropchad/chains";

import type { ChainAdapter } from "../chain/adapter.js";
import type { Config } from "../config.js";
import type { PriceService } from "../prices/service.js";
import { nativeDropFee } from "./native-fee.js";

/** No usd price for the coin right now. `503 price_unavailable`. */
export class PriceUnavailableError extends Error {
  constructor(
    readonly symbol: string,
    message = `no usd price for ${symbol} right now, try again in a minute`,
  ) {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

/** A leaf under the usd minimum. `400 below_min_usd`. */
export class BelowMinUsdError extends Error {
  constructor(
    readonly minimum: bigint,
    readonly minUsd: string,
    readonly priceUsd: number,
    readonly symbol: string,
  ) {
    super(
      `every receiver needs at least ${minUsd} usd, ${minimum.toString()} base units of ${symbol} ` +
        `at ${String(priceUsd)} usd`,
    );
    this.name = "BelowMinUsdError";
  }
}

/** The fee does not cover the relayer's estimated cost. `400 fee_below_gas`. */
export class FeeBelowGasError extends Error {
  constructor(
    readonly fee: bigint,
    readonly estimate: bigint,
    readonly unitPrice: bigint,
  ) {
    super(
      `the fee ${fee.toString()} does not cover the estimated relayer cost ${estimate.toString()} ` +
        `at ${unitPrice.toString()} a unit`,
    );
    this.name = "FeeBelowGasError";
  }
}

/** the usd minimum for this chain, as the decimal string in config. */
export function minReceiverUsd(config: Config, chain: Chain): string {
  return chain.kind === "mainnet"
    ? config.MIN_RECEIVER_USD_MAINNET
    : config.MIN_RECEIVER_USD_TESTNET;
}

const MICRO = 1_000_000n;

/** A decimal usd string, `"0.01"`, as millionths. Config has already checked the shape. */
function usdToMicro(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".");
  return BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

/**
 * The minimum in base units: `minUsd / priceUsd` coins, rounded **up** so a leaf at the minimum
 * is always worth at least `minUsd`. The price is taken to a millionth of a usd.
 */
export function minBaseUnits(minUsd: string, priceUsd: number, decimals: number): bigint {
  const priceMicro = BigInt(Math.round(priceUsd * 1_000_000));
  if (priceMicro <= 0n) throw new PriceUnavailableError("the coin");
  const scaled = usdToMicro(minUsd) * 10n ** BigInt(decimals);
  return (scaled + priceMicro - 1n) / priceMicro;
}

export interface FeeGuardInput {
  readonly chain: ChainAdapter;
  readonly prices: PriceService | undefined;
  readonly minUsd: string;
  /** Every leaf amount after merging, in base units. */
  readonly amounts: readonly bigint[];
  readonly totalEntitlements: bigint;
  readonly addressLeaves: number;
  readonly handleLeaves: number;
}

/**
 * for a token drop: the tier fee in SOL must cover the relayer's estimate, one
 * `claim_handle` a person. No usd minimum per receiver; the receivers' token accounts are
 * the account budget, not part of the estimate.
 */
export async function checkTokenFeeCoversRelayer(input: {
  readonly chain: ChainAdapter;
  readonly fee: bigint;
  readonly handleLeaves: number;
}): Promise<void> {
  const estimate = await input.chain.estimateRelayerCost({
    addressLeaves: 0,
    handleLeaves: input.handleLeaves,
    leafCount: input.handleLeaves,
    token: true,
  });
  if (input.fee < estimate.cost) {
    throw new FeeBelowGasError(input.fee, estimate.cost, estimate.unitPrice);
  }
}

/**
 * Both guards of a native drop. Returns the fee the api worked out, so the read back can
 * check the chain charged exactly that.
 */
export async function checkFeeGuards(input: FeeGuardInput): Promise<bigint> {
  const { chain } = input;

  // ---, the usd minimum per receiver ---------------------------------------------------
  const priceUsd = (await input.prices?.usdPrice(chain.nativeSymbol)) ?? null;
  if (priceUsd === null || !(priceUsd > 0)) throw new PriceUnavailableError(chain.nativeSymbol);
  const minimum = minBaseUnits(input.minUsd, priceUsd, chain.decimals);
  if (input.amounts.some((amount) => amount < minimum)) {
    throw new BelowMinUsdError(minimum, input.minUsd, priceUsd, chain.nativeSymbol);
  }

  // ---, the fee covers createDrop, activate and every claim ---------------------------
  const [feeConfig, estimate] = await Promise.all([
    chain.feeConfig(),
    chain.estimateRelayerCost({
      addressLeaves: input.addressLeaves,
      handleLeaves: input.handleLeaves,
      leafCount: input.addressLeaves + input.handleLeaves,
    }),
  ]);
  const fee = nativeDropFee(
    feeConfig,
    input.totalEntitlements,
    input.addressLeaves + input.handleLeaves,
  );
  if (fee < estimate.cost) throw new FeeBelowGasError(fee, estimate.cost, estimate.unitPrice);
  return fee;
}
