/**
 * `GET /api/chains`. The chains this api can make drops on, and the fee each one charges right
 * now. No auth, no rate limit, no database.
 *
 * The fee is read from the chain, never assumed: `defaultFeeBps` on the factory, `config.default_fee_bps`
 * on Solana. Next to it the flat minimum, `minFeeAmount` on `DropFactoryV2` and
 * `config.min_fee_lamports` on Solana, zero where it does not exist yet; the fee of a native drop
 * is `max(minFee, total * bps / 10_000)`. Also `minFeePerReceiver`
 * and `maxFee`, zero where the chain has none yet (`DropFactoryV3`, a Solana `Config`
 * before the upgrade): the four come from one `feeConfig()` read, the same one the create path
 * gives `nativeDropFee`. The create page uses them on step 2 to show the fee before the drop
 * exists; step 3 shows the drop's own snapshot, which is the one that counts.
 *
 * Only chains with a write side are listed. A chain with no relayer here cannot make drops, so
 * the create page has nothing to show for it. A chain whose read fails is still listed, with
 * that field `null`, so the page can say "not sure" instead of a wrong number.
 *
 * `tokenFeeTiers`: the usd tiers of a token drop's
 * fee from config, on a chain that takes token drops (Solana); `null` elsewhere. No price and no
 * chain read: the create page shows `fee $15, paid in SOL`, the exact SOL only comes at create.
 * Each tier also carries `lamports`, the SOL estimate at the price of the moment,
 * rounded up like at create, `null` with no price; the page shows `≈ 0.02 SOL` and `$3`.
 *
 * One read per chain per field per 30 seconds. The fee changes by an admin call a few times a
 * year, and the page is opened far more often than that.
 */
import { Hono } from "hono";

import type { AppEnv } from "../app.js";
import { handleModeStatus } from "../binder/handle-mode.js";
import { parseTokenFeeTiers, tokenFeeRule, type TokenFeeTier } from "../drops/token-fee.js";

export interface ChainInfo {
  readonly key: string;
  readonly chainId: number;
  readonly family: "evm" | "svm";
  readonly nativeSymbol: string;
  readonly decimals: number;
  readonly defaultFeeBps: number | null;
  /** Base units as a decimal string, a `bigint` does not fit JSON. */
  readonly minFee: string | null;
  /** base units as a decimal string; zero is off. */
  readonly minFeePerReceiver: string | null;
  /** base units as a decimal string; zero is no cap. */
  readonly maxFee: string | null;
  /**
   * Whether a handle drop can be made here now. The create page greys
   * `drop` out and the claim screen says claims are paused when this is false. A chain that
   * cannot be read says false.
   */
  readonly handleMode: boolean;
  /**
   * The token drop fee tiers in usd, each with `lamports`, the SOL estimate at the
   * price of the moment, `null` with no price; `null` on a chain without token drops.
   */
  readonly tokenFeeTiers:
    | readonly (TokenFeeTier & {
        readonly lamports?: string | null;
        readonly wei?: string | null;
      })[]
    | null;
}

const FEE_TTL_MS = 30_000;

export function createChainRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const cache = new Map<string, { readonly value: unknown; readonly readAt: number }>();

  async function cached<T>(key: string, nowMs: number, read: () => Promise<T>): Promise<T | null> {
    const hit = cache.get(key);
    if (hit !== undefined && nowMs - hit.readAt < FEE_TTL_MS) return hit.value as T;
    try {
      const value = await read();
      cache.set(key, { value, readAt: nowMs });
      return value;
    } catch {
      return null;
    }
  }

  routes.get("/", async (c) => {
    const { writeSides, now, binders, config, prices } = c.var.deps;
    // Token drops where the adapter has them: Solana, and Robinhood once `DropFactoryV3` is
    // recorded; the same rule as `POST /api/drops`.
    const tiers = parseTokenFeeTiers(config.TOKEN_FEE_TIERS_USD);
    const adapters = writeSides?.all() ?? [];
    const nowMs = now().getTime();
    const chains: ChainInfo[] = await Promise.all(
      adapters.map(async (adapter) => {
        const tokens = adapter.tokenVault !== undefined;
        const [fee, handle, price] = await Promise.all([
          cached(`${adapter.chainKey}:fee`, nowMs, () => adapter.feeConfig()),
          cached(`${adapter.chainKey}:handle`, nowMs, () => handleModeStatus(adapter, binders)),
          // The price feed has its own cache; a failure is no estimate, never an error.
          tokens
            ? (prices?.usdPrice(adapter.nativeSymbol) ?? Promise.resolve(null)).catch(() => null)
            : Promise.resolve(null),
        ]);
        return {
          key: adapter.chainKey,
          chainId: adapter.chainId,
          family: adapter.family,
          nativeSymbol: adapter.nativeSymbol,
          decimals: adapter.decimals,
          defaultFeeBps: fee?.bps ?? null,
          minFee: fee === null ? null : fee.minFee.toString(),
          minFeePerReceiver: fee === null ? null : fee.minFeePerReceiver.toString(),
          maxFee: fee === null ? null : fee.maxFee.toString(),
          handleMode: handle?.on ?? false,
          tokenFeeTiers: tokens
            ? tiers.map((tier) => {
                const estimate =
                  price === null || price <= 0
                    ? null
                    : tokenFeeRule(adapter.family).toBaseUnits(tier.usd, price).toString();
                // `wei` on Robinhood, `lamports` on Solana.
                return adapter.family === "evm"
                  ? { ...tier, wei: estimate }
                  : { ...tier, lamports: estimate };
              })
            : null,
        };
      }),
    );
    return c.json({ chains });
  });

  return routes;
}
