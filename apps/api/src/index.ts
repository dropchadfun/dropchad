/**
 * The server entry point. Loads the config, opens and migrates the database, starts Hono.
 *
 * In dev this listens on **4000**. `apps/web` owns 3000, because the X app's registered callback
 * is `http://localhost:3000/api/auth/x/callback` and X matches the redirect URI exactly, and it
 * rewrites `/api/*` to this process. Both live behind one origin either way.
 */
import { serve } from "@hono/node-server";

import { findChain, isDeployed } from "@dropchad/chains";
import { getAddress } from "viem";

import { createApp } from "./app.js";
import { createXClient } from "./auth/x-client.js";
import { getProgramChain } from "./chain/svm/write-side.js";
import { createSvmReader } from "./chain/svm/reader.js";
import { createSvmRpc } from "./chain/svm/rpc.js";
import { createTokenChecker } from "./chain/svm/token-check.js";
import { createReadClient } from "./chain/client.js";
import { createEvmTokenChecker, createViemErc20Reads } from "./chain/evm/token-check.js";
import { createLogoFetcher, createLogoStore } from "./chain/svm/token-logo.js";
import { evmTokenCheckFactory } from "./chain/write-side.js";
import { buildWriteSides } from "./chain/write-sides.js";
import { loadConfig, redactedConfig } from "./config.js";
import { openAndMigrate } from "./db/client.js";
import { createIndexerClient } from "./indexer/client.js";
import { loadDotEnv } from "./load-env.js";
import { createSafeFetch } from "./net/safe-fetch.js";
import { createDropEventBus } from "./worker/events.js";
import { createPriceService } from "./prices/service.js";
import { buildBinders } from "./binder/binders.js";
import { handleModeStatus } from "./binder/handle-mode.js";
import { createWorker } from "./worker/worker.js";

// Before anything reads the environment. `tsx` does not load a .env file by itself, which is why
// `npm run dev` used to fail with "invalid environment" on a correctly filled in .env.
// A missing file is fine, and anything already set in the real environment wins.
const dotenv = loadDotEnv();
if (dotenv.found) {
  // Names only. A value from that file is a secret until proven otherwise.
  console.log(`loaded ${String(dotenv.applied.length)} values from .env`);
}

const config = loadConfig();
const handle = await openAndMigrate(config.DATABASE_URL);

/**
 * The write sides are built only where a relayer key is present: the EVM one from
 * `RELAYER_PRIVATE_KEY`, the Solana one from `SOLANA_RELAYER_SECRET`. With neither the api still
 * starts and every read route works; the write routes answer `503 relayer_not_configured`.
 */
const write = await buildWriteSides(config, handle.db);
for (const line of write.lines) console.log(line);
if (write.adapters === undefined) console.log("no relayer key at all, the api is read only");

/**
 * The Solana read side needs an RPC url and nothing else, so a read only api has it too. Without
 * the url Solana drops are simply not readable here, and the list says so under `sources`.
 */
const solanaRpc =
  config.solanaRpcUrl === null ? undefined : createSvmRpc({ url: config.solanaRpcUrl });
const solanaReader =
  solanaRpc === undefined
    ? undefined
    : (() => {
        const chain = getProgramChain(config.SOLANA_CHAIN_KEY);
        return createSvmReader({
          rpc: solanaRpc,
          chainKey: chain.key,
          chainId: chain.chainId,
        });
      })();
/** The token check: the same RPC url, read only. */
// The token logo: fetched with the limits of `src/net/safe-fetch.ts`, kept in memory.
const tokenChecker =
  solanaRpc === undefined
    ? undefined
    : createTokenChecker({
        rpc: solanaRpc,
        logos: {
          fetcher: createLogoFetcher({ fetch: createSafeFetch() }),
          store: createLogoStore(),
        },
      });
/**
 * The Robinhood token check: read only, over the EVM read client. Built only once
 * `DropFactoryV3` is recorded in `packages/chains`; until then Robinhood token drops stay off and
 * `?chain=robinhood` is `400 chain_not_supported`. It reads `allowedToken` on the factory new
 * drops are created on: V3, or V4 once recorded.
 */
const foundEvmChain = findChain(config.CHAIN_KEY);
const evmChain =
  foundEvmChain !== undefined && isDeployed(foundEvmChain) ? foundEvmChain : undefined;
const tokenCheckFactory = evmChain === undefined ? null : evmTokenCheckFactory(evmChain);
const evmTokenChecker =
  evmChain !== undefined && tokenCheckFactory !== null && config.chainRpcUrls !== null
    ? createEvmTokenChecker({
        reads: createViemErc20Reads({
          client: createReadClient(evmChain, config.chainRpcUrls),
          factory: tokenCheckFactory,
          launchpads: evmChain.launchpadFactories.flatMap((l) =>
            l.adapter === null
              ? []
              : [{ factory: getAddress(l.address), adapter: getAddress(l.adapter) }],
          ),
        }),
      })
    : undefined;
console.log(
  solanaReader === undefined
    ? `no ${String(getProgramChain(config.SOLANA_CHAIN_KEY).rpcEnv)}, Solana drops are not readable from this api`
    : `solana read side on ${solanaReader.chainKey}`,
);

/**
 * The binder keys. A key that does not match its address, or that is a
 * relayer key, stops the start here. Only the public addresses are printed.
 */
const binders = buildBinders(config);
console.log(
  `binder: evm ${binders.evm?.address ?? "off"}, solana ${binders.svm?.publicKey ?? "off"}`,
);

/**
 * Handle mode per chain.: on only with our binder key and that key as the binder on
 * chain. The reason goes to this log, never to the public. Read in the background: a slow RPC
 * must not hold the start.
 */
void Promise.all(
  (write.adapters?.all() ?? []).map(async (chain) => {
    try {
      const status = await handleModeStatus(chain, binders);
      console.log(`handle mode ${chain.chainKey}: ${status.on ? "on" : `off (${status.reason})`}`);
    } catch (error) {
      console.error(`handle mode ${chain.chainKey}: not readable`, error);
    }
  }),
);

/** One bus for the whole process. The worker emits, the SSE route listens. */
const events = createDropEventBus();

/** One usd feed for the whole process: the worker freezes prices, the create guard checks. */
const prices = createPriceService({
  now: () => Date.now(),
  ttlMs: config.PRICE_TTL_MS,
  baseUrl: config.COINGECKO_URL,
  apiKey: config.COINGECKO_API_KEY,
});

const app = createApp({
  config,
  db: handle.db,
  xClient: createXClient({
    clientId: config.X_CLIENT_ID,
    clientSecret: config.X_CLIENT_SECRET,
    redirectUri: config.xCallbackUrl,
  }),
  indexer: createIndexerClient({ baseUrl: config.INDEXER_URL }),
  now: () => new Date(),
  events,
  writeSides: write.adapters,
  solanaReader,
  tokenChecker,
  evmTokenChecker,
  prices,
  binders,
  solana: {
    kind: write.solana.kind,
    chainKey: config.SOLANA_CHAIN_KEY,
    detail:
      write.solana.kind === "off"
        ? write.solana.reason
        : write.solana.kind === "config_missing"
          ? write.solana.hint
          : `relayer ${write.solana.relayerAddress}, config ${write.solana.configCheck.configAddress}`,
  },
});

/**
 * The worker only runs when there is a relayer, because every step it takes ends in a transaction.
 * Without a key the api is read only and there is nothing for it to do.
 */
const worker =
  write.adapters === undefined
    ? null
    : createWorker({
        db: handle.db,
        chains: write.adapters,
        events,
        now: () => new Date(),
        pollMs: config.WATCHER_POLL_MS,
        prices,
      });
if (worker !== null) {
  await worker.start();
  console.log(`worker polling every ${String(config.WATCHER_POLL_MS)}ms`);
}

// Secrets are replaced, never shortened.
console.log("dropchad api starting", redactedConfig(config));

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}, shutting down`);
  worker?.stop();
  server.close();
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
