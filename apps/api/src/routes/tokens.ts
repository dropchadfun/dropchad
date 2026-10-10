/**
 * `GET /api/tokens/:mint?chain=solana`, the token check -1.
 * Since `?chain=robinhood` too, once `DropFactoryV3` is recorded: a 20 byte `0x` address,
 * `src/chain/evm/token-check.ts`, `503 robinhood_unavailable`, and the logo route always
 * `404 no_logo` (an ERC20 has no logo). Off until then: `400 chain_not_supported`, as before.
 * No sign in, no database. The rules live in `src/chain/svm/token-check.ts`.
 *
 * - `chain` is required. Solana only for now; `robinhood` is `400 chain_not_supported` until the
 *   Robinhood token drops exist, anything else `400 bad_chain`.
 * - A mint that is not a 32 byte base58 key is `400 bad_mint`, before any read.
 * - No Solana RPC, or a read that fails: `503 solana_unavailable`.
 * - 30 checks a minute per ip, the in memory limiter, `src/middleware/rate-limit.ts`.
 *
 * `GET /api/tokens/:mint/logo?chain=solana` -2: the kept logo bytes, from our own
 * origin, with the type we read from the bytes and headers that stop a browser from guessing
 * or running anything. Never a redirect to the stranger's link. Not kept: fetched again under
 * the same rules. No logo: `404 no_logo`. Its own limit, 120 a minute per ip.
 */
import { Hono, type Context } from "hono";
import { isAddress } from "viem";

import type { AppEnv } from "../app.js";
import { pubkeyFromBase58 } from "../chain/svm/pubkey.js";
import { withQuickToken } from "../drops/token-info.js";
import { rateLimit } from "../middleware/rate-limit.js";

/** The chain and the mint, the same for both routes; a `Response` when they are bad. */
function badRequest(c: Context<AppEnv>, mint: string): Response | null {
  const chain = c.req.query("chain");
  if (chain === "robinhood") {
    // Off until `DropFactoryV3` is recorded, then a 20 byte 0x address.
    if (c.get("deps").evmTokenChecker === undefined) {
      return c.json({ error: "chain_not_supported" }, 400);
    }
    if (!isAddress(mint, { strict: false })) return c.json({ error: "bad_mint" }, 400);
    return null;
  }
  if (chain !== "solana") return c.json({ error: "bad_chain" }, 400);
  try {
    pubkeyFromBase58(mint);
  } catch {
    return c.json({ error: "bad_mint" }, 400);
  }
  return null;
}

export function createTokenRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/:mint", rateLimit({ limit: 30, windowSeconds: 60 }), async (c) => {
    const mint = c.req.param("mint");
    const bad = badRequest(c, mint);
    if (bad !== null) return bad;

    const evm = c.req.query("chain") === "robinhood";
    const down = evm ? "robinhood_unavailable" : "solana_unavailable";
    const checker = evm ? c.get("deps").evmTokenChecker : c.get("deps").tokenChecker;
    if (checker === undefined) return c.json({ error: down }, 503);
    // a quick token of this api's chain, by exact address, gets our ticker, name and
    // logo; any other mint is answered exactly as the chain read it.
    const { config } = c.get("deps");
    const chainKey = evm ? config.CHAIN_KEY : config.SOLANA_CHAIN_KEY;
    try {
      return c.json(withQuickToken(chainKey, mint, await checker.check(mint)));
    } catch (error) {
      console.error(`token check for ${mint} failed`, error);
      return c.json({ error: down }, 503);
    }
  });

  routes.get("/:mint/logo", rateLimit({ limit: 120, windowSeconds: 60 }), async (c) => {
    const mint = c.req.param("mint");
    const bad = badRequest(c, mint);
    if (bad !== null) return bad;

    // An ERC20 carries no logo: the web shows the letter.
    if (c.req.query("chain") === "robinhood") return c.json({ error: "no_logo" }, 404);
    const checker = c.get("deps").tokenChecker;
    if (checker === undefined) return c.json({ error: "solana_unavailable" }, 503);
    let logo;
    try {
      logo = await checker.logo(mint);
    } catch (error) {
      console.error(`token logo for ${mint} failed`, error);
      return c.json({ error: "solana_unavailable" }, 503);
    }
    if (logo === null) return c.json({ error: "no_logo" }, 404);
    return c.body(logo.bytes, 200, {
      "content-type": logo.contentType,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "public, max-age=86400",
    });
  });

  return routes;
}
