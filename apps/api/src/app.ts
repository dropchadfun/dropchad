/**
 * The Hono app.
 *
 * Everything the routes need is passed in as `deps`, never imported as a module singleton. That
 * is what lets a test build a whole api over an in-memory database and a stubbed X endpoint, and
 * run the real route code rather than a copy of it.
 *
 * Every route lives under `/api`, because in dev `apps/web` owns port 3000 and rewrites `/api`
 * to this process on 4000, and in production both sit behind one origin. One origin is not a style choice: the PKCE
 * cookie and the session cookie are host scoped, and a split origin breaks the login.
 */
import { Hono } from "hono";

import type { XClient } from "./auth/x-client.js";
import type { ChainAdapters } from "./chain/adapter.js";
import type { SvmReader } from "./chain/svm/reader.js";
import type { TokenChecker } from "./chain/svm/token-check.js";
import type { Config } from "./config.js";
import type { Database } from "./db/client.js";
import type { IndexerClient } from "./indexer/client.js";
import type { DropEventBus } from "./worker/events.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createBoardRoutes } from "./routes/boards.js";
import { createClaimRoutes } from "./routes/claims.js";
import { createChainRoutes } from "./routes/chains.js";
import { createDevRoutes } from "./routes/dev.js";
import { createDropRoutes, createStatsRoutes } from "./routes/drops.js";
import { createHandleRoutes } from "./routes/handles.js";
import { createHealthRoutes } from "./routes/health.js";
import { createMeRoutes } from "./routes/me.js";
import { createTokenRoutes } from "./routes/tokens.js";
import { createUserRoutes } from "./routes/users.js";
import type { PriceService } from "./prices/service.js";
import type { Binders } from "./binder/binders.js";
import { createBindRoutes } from "./routes/bind.js";

/**
 * Why Solana drops cannot be created right now, when they cannot. Shown by the write routes and
 * `/api/health` so the reason is one `curl` away.
 */
export interface SolanaStatus {
  readonly kind: "off" | "config_missing" | "on";
  readonly chainKey: string;
  readonly detail: string;
}

export interface AppDeps {
  readonly config: Config;
  readonly db: Database;
  readonly xClient: XClient;
  /** The read side. Forwards to the indexer while both run on their own PGlite. */
  readonly indexer: IndexerClient;
  /** Injectable clock. Tests move time forward to expire a session without waiting thirty days. */
  readonly now: () => Date;
  /**
   * The live bus the worker emits on and the SSE route listens to. Always present, even with no
   * relayer: a read only api still serves the stream, it just never has anything to say.
   */
  readonly events: DropEventBus;
  /**
   * The write side: one chain adapter per configured relayer, each able to send only its own
   * short list of calls. **Optional on purpose.** Without any relayer key the api still starts
   * and every read route works; only the write routes answer `503 relayer_not_configured`. That
   * is what lets the test suite and a read only deployment run with no key anywhere near them.
   */
  readonly writeSides?: ChainAdapters | undefined;
  /** What the Solana write side is doing, for the routes that have to say so. */
  readonly solana?: SolanaStatus | undefined;
  /**
   * The Solana read side: our rows read back from the cluster. Needs only an RPC url, never a
   * key, so it is present on a read only api too. Absent when `SOLANA_DEVNET_RPC_URL` is unset.
   */
  readonly solanaReader?: SvmReader | undefined;
  /**
   * The token check of, over the same RPC url as the read side, never a key. Absent when
   * `SOLANA_DEVNET_RPC_URL` is unset; the route then answers `503 solana_unavailable`.
   */
  readonly tokenChecker?: TokenChecker | undefined;
  /**
   * The Robinhood token check, over the EVM read client. Absent until
   * `DropFactoryV3` is recorded in `packages/chains`: `?chain=robinhood` stays
   * `400 chain_not_supported` and Robinhood token drops stay off.
   */
  readonly evmTokenChecker?: TokenChecker | undefined;
  /** The `fetch` the X handle lookup uses. Absent means the global one; the tests stub it. */
  readonly xFetch?: typeof fetch | undefined;
  /**
   * The usd feed, the one the worker freezes prices with. The create guard of the design reads it;
   * absent means no price, and `POST /api/drops` answers `503 price_unavailable`.
   */
  readonly prices?: PriceService | undefined;
  /** The binder keys, `src/binder`. A chain without one answers `503 binder_not_configured`. */
  readonly binders?: Binders | undefined;
  /**
   * The commitment blind of a new drop. Absent means 32 fresh random bytes, which is
   * what runs; a test fixes it only when it must know a commitment before the drop exists.
   */
  readonly randomBlind?: (() => `0x${string}`) | undefined;
}

export interface AppEnv {
  Variables: {
    deps: AppDeps;
  };
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  const api = new Hono<AppEnv>();
  api.route("/health", createHealthRoutes());
  api.route("/chains", createChainRoutes());
  api.route("/auth", createAuthRoutes());
  api.route("/me", createMeRoutes());
  api.route("/drops", createDropRoutes());
  api.route("/drops", createBindRoutes());
  api.route("/stats", createStatsRoutes());
  api.route("/boards", createBoardRoutes());
  api.route("/users", createUserRoutes());
  api.route("/handles", createHandleRoutes());
  api.route("/claims", createClaimRoutes());
  api.route("/tokens", createTokenRoutes());
  // Answers 404 unless NODE_ENV is development and the host is localhost. See the file.
  api.route("/dev", createDevRoutes());

  app.route("/api", api);

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((error, c) => {
    // The message is never sent to the client: it can carry a code, a token or a query. The
    // server log gets the real thing, the caller gets a shape it can branch on.
    console.error("unhandled error", error);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
