/**
 * The fee of a native coin drop . The one
 * place the api works it out: the gas check, `GET /api/chains` and the read back after
 * `createDrop` all call this.
 *
 * The same math, step for step, as `sol_drop_fee` in the Solana program and `createDrop` in
 * `DropFactoryV4`: 1 percent rounded down, at least the flat minimum, at least the minimum per
 * receiver times the leaves, at most the cap. Zero turns a part off; a zero cap is no cap. With
 * the two fields zero it is the older fee, `max(minFee, total * bps / 10_000)`, so
 * a chain without them (`DropFactoryV3`, a `Config` before the upgrade) answers zero for both
 * and charges what it always did. Token drops are not part of it.
 */

/** What the chain says new drops pay, read in one go. Base units: wei or lamports. */
export interface NativeFeeConfig {
  readonly bps: number;
  /** The flat minimum, `minFeeAmount` / `min_fee_lamports`. */
  readonly minFee: bigint;
  /** `minFeePerReceiver` / `min_fee_per_receiver_lamports`, zero is off. */
  readonly minFeePerReceiver: bigint;
  /** `maxFeeAmount` / `max_fee_lamports`, zero is no cap. */
  readonly maxFee: bigint;
}

export function nativeDropFee(
  config: NativeFeeConfig,
  totalEntitlements: bigint,
  leafCount: number,
): bigint {
  let fee = (totalEntitlements * BigInt(config.bps)) / 10_000n;
  if (fee < config.minFee) fee = config.minFee;
  const perReceiver = config.minFeePerReceiver * BigInt(leafCount);
  if (fee < perReceiver) fee = perReceiver;
  if (config.maxFee !== 0n && fee > config.maxFee) fee = config.maxFee;
  return fee;
}
