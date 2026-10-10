/**
 * The token drop fee. A usd tier by
 * the number of people, paid in SOL at the price of that moment, at most 1 SOL. The tiers are api
 * config; the end of the last tier is the most people a token drop takes.
 *
 * Pure: no price feed, no chain. `create.ts` calls it.
 */

/** the program's `MAX_SOL_FEE_LAMPORTS`. The api refuses above it first. */
export const MAX_SOL_FEE_LAMPORTS = 1_000_000_000n;

const LAMPORTS_PER_SOL = 1_000_000_000n;
const MICRO = 1_000_000n;
const USD = /^[0-9]+(\.[0-9]{1,6})?$/;

export interface TokenFeeTier {
  /** The last number of people in this tier. */
  readonly upTo: number;
  /** A decimal usd string, as written in config. */
  readonly usd: string;
}

/** `5:15,20:25,...`, people up to and usd. Every `upTo` goes up; throws on anything else. */
export function parseTokenFeeTiers(text: string): TokenFeeTier[] {
  const tiers = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [upTo = "", usd = ""] = part.split(":").map((s) => s.trim());
      if (!/^[1-9][0-9]*$/.test(upTo) || !USD.test(usd)) {
        throw new Error(`token fee tier "${part}" must be people:usd, like 5:15`);
      }
      return { upTo: Number(upTo), usd };
    });
  if (tiers.length === 0) throw new Error("token fee tiers are empty");
  tiers.forEach((tier, i) => {
    const before = tiers[i - 1];
    if (before !== undefined && tier.upTo <= before.upTo) {
      throw new Error("token fee tiers must go up in people");
    }
  });
  return tiers;
}

/** The most people a token drop takes: the end of the last tier. */
export function tokenMaxPeople(tiers: readonly TokenFeeTier[]): number {
  const last = tiers[tiers.length - 1];
  if (last === undefined) throw new Error("token fee tiers are empty");
  return last.upTo;
}

/** The usd tier for this many people, after the merge. Throws for 0 or above the last tier. */
export function tokenFeeTierUsd(people: number, tiers: readonly TokenFeeTier[]): string {
  if (people < 1) throw new RangeError("a token drop needs at least one person");
  const tier = tiers.find((t) => people <= t.upTo);
  if (tier === undefined) throw new RangeError(`no fee tier for ${String(people)} people`);
  return tier.usd;
}

function usdToMicro(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".");
  return BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

/** `usd` in lamports at `solPriceUsd`, rounded **up**, the price taken to a millionth of a usd. */
export function usdToLamports(usd: string, solPriceUsd: number): bigint {
  const priceMicro = BigInt(Math.round(solPriceUsd * 1_000_000));
  if (priceMicro <= 0n) throw new RangeError("the SOL price must be above zero");
  return (usdToMicro(usd) * LAMPORTS_PER_SOL + priceMicro - 1n) / priceMicro;
}

/** the contract's `MAX_NATIVE_FEE`: a Robinhood token drop's ETH fee is at most 0.05 ETH. */
export const MAX_ETH_FEE_WEI = 50_000_000_000_000_000n;

const WEI_PER_ETH = 1_000_000_000_000_000_000n;
/** the ETH fee is rounded up to a whole 0.00001 ETH. */
const ETH_FEE_STEP_WEI = 10_000_000_000_000n;

/**
 * `usd` in wei at `ethPriceUsd`, rounded **up** to a whole 0.00001 ETH, so the funding card shows
 * at most 5 decimals and the fee on chain is that same number. The price to a millionth of a usd.
 */
export function usdToWei(usd: string, ethPriceUsd: number): bigint {
  const priceMicro = BigInt(Math.round(ethPriceUsd * 1_000_000));
  if (priceMicro <= 0n) throw new RangeError("the ETH price must be above zero");
  const exact = (usdToMicro(usd) * WEI_PER_ETH + priceMicro - 1n) / priceMicro;
  return ((exact + ETH_FEE_STEP_WEI - 1n) / ETH_FEE_STEP_WEI) * ETH_FEE_STEP_WEI;
}

/** How a chain family turns the usd tier into its native coin, and the cap. */
export interface TokenFeeRule {
  readonly toBaseUnits: (usd: string, priceUsd: number) => bigint;
  /** The contract's or the program's ceiling, refused by the api first: `fee_too_high`. */
  readonly cap: bigint;
}

export function tokenFeeRule(family: "evm" | "svm"): TokenFeeRule {
  return family === "svm"
    ? { toBaseUnits: usdToLamports, cap: MAX_SOL_FEE_LAMPORTS }
    : { toBaseUnits: usdToWei, cap: MAX_ETH_FEE_WEI };
}
