/**
 * The step 1 amount check, `POST /api/drops/check`.
 *
 * The create checks on the amounts alone, in the create order, stopping at the first refusal.
 * It throws the same errors as `createDrop`, so the route answers with the same codes and bodies:
 * - native: the cap per drop, then the usd minimum and the fee against the gas,
 *   `checkFeeGuards`
 * - token: the token check, then the people cap of the last tier, the coin price
 *   and the 1 SOL or 0.05 ETH cap on the tier fee, then the cap per drop, then the tier fee
 *   against the gas
 * - handle mode: the resolver's people cap first, as at create
 *
 * It makes nothing: no tree, no salt, no chain write, no row, no X call. Create checks again.
 */
import { MAX_LEAVES } from "@dropchad/shared";

import type { ChainAdapter } from "../chain/adapter.js";
import type { TokenCheck } from "../chain/svm/token-check.js";
import type { PriceService } from "../prices/service.js";
import { HandleResolveError } from "../x/resolver.js";
import {
  CreateInputError,
  FeeTooHighError,
  TokenCheckUnavailableError,
  TokenRefusedError,
  TokenTooManyError,
  noPrice,
} from "./create.js";
import { checkDropCap, dropCapFor, type DropCapConfig } from "./drop-cap.js";
import { checkFeeGuards, checkTokenFeeCoversRelayer, PriceUnavailableError } from "./fee-guards.js";
import { tokenFeeRule, tokenFeeTierUsd, tokenMaxPeople, type TokenFeeTier } from "./token-fee.js";

export interface AmountCheckDeps {
  readonly chain: ChainAdapter;
  readonly prices: PriceService | undefined;
  readonly minReceiverUsd: string;
  /** `HANDLE_MAX_RECEIVERS`, the resolver's cap. */
  readonly maxHandles: number;
  readonly tokenFeeTiers?: readonly TokenFeeTier[] | undefined;
  readonly dropCaps: DropCapConfig;
  /** The chain's token check. Absent: token drops cannot be checked here. */
  readonly checkToken?: ((mint: string) => Promise<TokenCheck>) | undefined;
}

export interface AmountCheckInput {
  readonly mode: "address" | "handle";
  /** `"native"` or the token address or mint. The route has checked it fits the chain. */
  readonly asset: string;
  /** One amount a person after merging, in base units, each above zero. */
  readonly amounts: readonly bigint[];
}

/** Throws the create error of the first refusal; returns when every check passes. */
export async function checkDropAmounts(
  deps: AmountCheckDeps,
  input: AmountCheckInput,
): Promise<void> {
  const { chain } = deps;
  const people = input.amounts.length;
  const total = input.amounts.reduce((sum, amount) => sum + amount, 0n);

  // --- the token, as at create: the check, then the resolver's cap, then the tier ------------
  let token: { readonly mint: string; readonly decimals: number } | null = null;
  let tierFee: bigint | null = null;
  if (input.asset !== "native") {
    if (deps.checkToken === undefined) throw new TokenCheckUnavailableError(chain.family);
    let checked: TokenCheck;
    try {
      checked = await deps.checkToken(input.asset);
    } catch {
      throw new TokenCheckUnavailableError(chain.family);
    }
    if (!checked.ok || checked.tokenProgram === null || checked.decimals === null) {
      throw new TokenRefusedError(checked.reason ?? "not a token");
    }
    token = { mint: input.asset, decimals: checked.decimals };
  }

  if (input.mode === "handle" && people > deps.maxHandles) {
    throw new HandleResolveError(
      "too_many",
      `a handle drop takes at most ${String(deps.maxHandles)} receivers, got ${String(people)}`,
    );
  }
  if (input.mode === "address" && people > MAX_LEAVES) {
    throw new CreateInputError(
      `${String(people)} receivers after merging duplicates, the limit is ${String(MAX_LEAVES)}`,
    );
  }

  if (token !== null) {
    const tiers = deps.tokenFeeTiers;
    if (tiers === undefined) throw new TokenCheckUnavailableError(chain.family);
    const max = tokenMaxPeople(tiers);
    if (people > max) throw new TokenTooManyError(people, max);
    const tierUsd = tokenFeeTierUsd(people, tiers);
    const priceUsd = (await deps.prices?.usdPrice(chain.nativeSymbol)) ?? null;
    if (priceUsd === null || !(priceUsd > 0)) {
      throw new PriceUnavailableError(chain.nativeSymbol, noPrice(chain.nativeSymbol));
    }
    const rule = tokenFeeRule(chain.family);
    tierFee = rule.toBaseUnits(tierUsd, priceUsd);
    if (tierFee > rule.cap) throw new FeeTooHighError(tierFee);
  }

  // --- the cap per drop, then the fee guards, as at create ----------------------------
  checkDropCap(dropCapFor(deps.dropCaps, chain, token), total);

  if (tierFee !== null) {
    await checkTokenFeeCoversRelayer({ chain, fee: tierFee, handleLeaves: people });
    return;
  }
  await checkFeeGuards({
    chain,
    prices: deps.prices,
    minUsd: deps.minReceiverUsd,
    amounts: input.amounts,
    totalEntitlements: total,
    addressLeaves: input.mode === "handle" ? 0 : people,
    handleLeaves: input.mode === "handle" ? people : 0,
  });
}
