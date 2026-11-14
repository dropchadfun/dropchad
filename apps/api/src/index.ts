/**
 * The server entry point. Loads the config, opens and migrates the database, starts Hono.
 *
 * In dev this listens on **4000**. `apps/web` owns 3000, because the X app's registered callback
 * is `http://localhost:3000/api/auth/x/callback` and X matches the redirect URI exactly, and it
 * rewrites `/api/*` to this process. Both live behind one origin either way.
 */
import { serve } from "@hono/node-server";

import { findChain } from "@dropchad/chains";
import { getAddress } from "viem";

import { startAddons } from "./addons.js";
import { createApp } from "./app.js";
import { cleanupExpired, startCleanup } from "./auth/cleanup.js";
import { createXClient } from "./auth/x-client.js";
import { getProgramChain } from "./chain/svm/write-side.js";
import { configPda } from "./chain/svm/pda.js";
import { createSvmReader } from "./chain/svm/reader.js";
import { pubkeyFromBase58 } from "./chain/svm/pubkey.js";
import { createSvmRpc } from "./chain/svm/rpc.js";
import { createTokenChecker } from "./chain/svm/token-check.js";
import { createReadClient, isServedEvmChain } from "./chain/client.js";
import { createEvmTokenChecker, createViemErc20Reads } from "./chain/evm/token-check.js";
import { createLogoFetcher, createLogoStore } from "./chain/svm/token-logo.js";
import { evmTokenCheckFactory } from "./chain/write-side.js";
import { createAwsKmsClient } from "./chain/kms-aws.js";
import { resolveSigners } from "./chain/signers.js";
import { buildWriteSides } from "./chain/write-sides.js";
import { kmsSettings, loadConfig, redactedConfig } from "./config.js";
import { openAndMigrate } from "./db/client.js";
import { createIndexerClient, IndexerUnavailableError } from "./indexer/client.js";
import { listenOptions } from "./listen.js";
import { loadDotEnv } from "./load-env.js";
import { createSafeFetch } from "./net/safe-fetch.js";
import { createDropEventBus } from "./worker/events.js";
import { readTrending } from "./boards/trending-read.js";
import { chainFilter, isMainnetSite } from "./chain/filter.js";
import { SolanaUnavailableError } from "./drops/read.js";
import { createPriceService } from "./prices/service.js";
import { handleModeStatus } from "./binder/handle-mode.js";
import { createTelegramSender, type TelegramSender } from "./telegram/sender.js";
import {
  createRelayerAlert,
  relayerAlertSettings,
  watchedRelayers,
  type AlertRelayer,
  type RelayerAlert,
} from "./telegram/relayer-alert.js";
import {
  createOwnerAlerts,
  evmAdminFields,
  evmAdminTargets,
  ownerAlertSettings,
  solanaAdminFields,
  type AdminWatch,
  type FastWatch,
  type OwnerAlerts,
} from "./telegram/owner-alerts.js";
import { sendPrivateAlert } from "./telegram/alert-send.js";
import { telegramSettings, telegramTrendingSettings } from "./telegram/settings.js";
import {
  createTrendingPoster,
  trendingNetwork,
  type TrendingPoster,
} from "./telegram/trending-sender.js";
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
 * The four signers: each role from its KMS key id or, on a testnet, its raw
 * key. A wrong key or a binder that is the relayer stops the start here; a KMS that cannot be
 * read turns only that role off. Only public addresses and env names are printed.
 */
const kmsConfig = kmsSettings(config);
const signers = await resolveSigners(
  config,
  kmsConfig === null ? null : createAwsKmsClient(kmsConfig),
);
if (kmsConfig !== null) console.log(`kms on, region ${kmsConfig.region}`);
for (const note of signers.notes) console.log(note);

/**
 * The write sides are built only where a relayer is present. With neither the api still starts
 * and every read route works; the write routes answer `503 relayer_not_configured`.
 */
const write = await buildWriteSides(config, handle.db, signers);
for (const line of write.lines) console.log(line);
if (write.adapters === undefined) console.log("no relayer key at all, the api is read only");

/**
 * The Solana read side needs an RPC url and nothing else, so a read only api has it too. Without
 * the url Solana drops are simply not readable here, and the list says so under `sources`.
 */
const solanaRpc =
  config.solanaRpcUrls === null ? undefined : createSvmRpc({ url: config.solanaRpcUrls });
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
  foundEvmChain !== undefined && isServedEvmChain(foundEvmChain) ? foundEvmChain : undefined;
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
 * The binder keys, from `resolveSigners` above. Only the public
 * addresses are printed.
 */
const binders = signers.binders;
console.log(
  `binder: evm ${binders.evm?.address ?? "off"}, solana ${binders.svm?.publicKey ?? "off"}`,
);

/**
 * Handle mode per chain: on only with our binder key and that key as the binder on
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

/** built below with the relayer alert. Alert 5 counts through it from the first request. */
let ownerAlerts: OwnerAlerts | null = null;

const indexer = createIndexerClient({ baseUrl: config.INDEXER_URL });

const app = createApp({
  config,
  db: handle.db,
  onUnhandledError: () => ownerAlerts?.countApiError(),
  xClient: createXClient({
    clientId: config.X_CLIENT_ID,
    clientSecret: config.X_CLIENT_SECRET,
    redirectUri: config.xCallbackUrl,
  }),
  indexer,
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

/** The optional parts, `src/addons.ts`: each folder of `src/` with an `addon.ts`. */
const addons = await startAddons({
  app,
  config,
  db: handle.db,
  client: handle.client,
  kms: kmsConfig === null ? null : createAwsKmsClient(kmsConfig),
  env: process.env,
  keys: {
    relayer:
      signers.evmRelayer?.address ??
      (config.RELAYER_ADDRESS === undefined ? undefined : getAddress(config.RELAYER_ADDRESS)),
    binder: binders.evm?.address,
  },
});

/**
 * Telegram channel posts: off unless switched on with a token and a channel.
 * The reason never holds a value; the token is never printed.
 */
const telegram = telegramSettings(config);
let telegramSender: TelegramSender | null = null;
if (telegram.on) {
  telegramSender = createTelegramSender({
    db: handle.db,
    fetch: globalThis.fetch,
    now: () => new Date(),
    token: telegram.token,
    channelId: telegram.channelId,
    siteUrl: config.SHARE_BASE_URL,
    log: (line) => console.log(line),
  });
  await telegramSender.start();
  console.log("telegram posts on");
} else {
  console.log(`telegram posts off: ${telegram.reason}`);
}

/**
 * The relayer low balance alert: a private message to the owner, never the
 * channel. Off unless switched on with the token and a private chat id. Read only: one balance read
 * per relayer, every 10 minutes. The reason never holds a value.
 */
const relayerAlertSwitch = relayerAlertSettings(config);
let relayerAlert: RelayerAlert | null = null;
if (relayerAlertSwitch.on) {
  const { watched, notWatched } = watchedRelayers(config);
  const relayers: AlertRelayer[] = [];
  for (const relayer of watched) {
    const family = findChain(relayer.chainKey)?.family;
    if (family === "svm" && solanaRpc !== undefined) {
      const pubkey = pubkeyFromBase58(relayer.address);
      relayers.push({ ...relayer, readBalance: () => solanaRpc.getBalance(pubkey, "confirmed") });
    } else if (family === "evm" && evmChain !== undefined && config.chainRpcUrls !== null) {
      const client = createReadClient(evmChain, config.chainRpcUrls);
      const address = getAddress(relayer.address);
      relayers.push({ ...relayer, readBalance: () => client.getBalance({ address }) });
    } else {
      notWatched.push({ chainKey: relayer.chainKey, reason: "no rpc url" });
    }
  }
  for (const r of relayers) {
    console.log(`relayer alert ${r.chainKey}: watched, limit ${r.limit.toString()} base units`);
  }
  for (const n of notWatched) console.log(`relayer alert ${n.chainKey}: not watched, ${n.reason}`);

  /**
   * The owner alerts: the same bot, chat and switch. Alert 1 needs a
   * relayer the alert above reads; alert 3 reads the Solana `Config` and the Robinhood factories
   * and `BinderRegistry`. Reads only.
   */
  const settings = ownerAlertSettings(config);
  const fast: FastWatch[] = [];
  for (const w of settings.fast.watched) {
    const relayer = relayers.find((r) => r.chainKey === w.chainKey);
    if (relayer === undefined) {
      settings.fast.notWatched.push({ chainKey: w.chainKey, reason: "no relayer read" });
    } else {
      fast.push({
        ...w,
        address: relayer.address,
        symbol: relayer.symbol,
        decimals: relayer.decimals,
      });
    }
  }
  const admin: AdminWatch[] = [];
  if (solanaRpc !== undefined) {
    const configAddress = configPda().address;
    admin.push({
      chainKey: config.SOLANA_CHAIN_KEY,
      read: async () => {
        const info = await solanaRpc.getAccountInfo(configAddress, "confirmed");
        if (info === null) throw new Error("no config account");
        return solanaAdminFields(info.data);
      },
    });
  }
  if (
    evmChain !== undefined &&
    config.chainRpcUrls !== null &&
    config.RELAYER_ADDRESS !== undefined
  ) {
    // V6 live with its guardian, V5 old, both registries while recorded.
    const targets = evmAdminTargets(evmChain, config.RELAYER_ADDRESS);
    const client = createReadClient(evmChain, config.chainRpcUrls);
    admin.push({
      chainKey: evmChain.key,
      read: () => evmAdminFields({ readContract: (call) => client.readContract(call) }, targets),
    });
  }
  ownerAlerts = createOwnerAlerts({
    db: handle.db,
    fetch: globalThis.fetch,
    now: () => new Date(),
    token: relayerAlertSwitch.token,
    chatId: relayerAlertSwitch.chatId,
    log: (line) => console.log(line),
    repeatMinutes: settings.repeatMinutes,
    adminMinutes: settings.adminMinutes,
    fast,
    claims: settings.claims.watched,
    admin,
    apiErrors: "notWatched" in settings.apiErrors ? null : settings.apiErrors,
    // Alert 6: the indexer follows the one EVM chain of this api.
    ethWaiting:
      evmChain === undefined
        ? null
        : {
            chainKey: evmChain.key,
            read: async () => (await indexer.listNativeWaiting()).rows,
          },
  });
  for (const w of fast) {
    console.log(
      `owner alert relayer_fast ${w.chainKey}: watched, ${w.drop.toString()} in ${String(w.minutes)} min`,
    );
  }
  for (const n of settings.fast.notWatched) {
    console.log(`owner alert relayer_fast ${n.chainKey}: not watched, ${n.reason}`);
  }
  for (const w of settings.claims.watched) {
    console.log(
      `owner alert claims ${w.chainKey}: watched, ${String(w.count)} in ${String(w.minutes)} min`,
    );
  }
  for (const n of settings.claims.notWatched) {
    console.log(`owner alert claims ${n.chainKey}: not watched, ${n.reason}`);
  }
  for (const w of admin) {
    console.log(
      `owner alert admin ${w.chainKey}: watched, every ${String(settings.adminMinutes)} min`,
    );
  }
  console.log(
    "notWatched" in settings.apiErrors
      ? `owner alert api_errors: not watched, ${settings.apiErrors.notWatched}`
      : `owner alert api_errors: watched, ${String(settings.apiErrors.count)} in ${String(settings.apiErrors.minutes)} min`,
  );
  const owner = ownerAlerts;
  void owner.start();
  console.log(`owner alerts on, repeat ${String(settings.repeatMinutes)} min`);

  relayerAlert = createRelayerAlert({
    db: handle.db,
    fetch: globalThis.fetch,
    now: () => new Date(),
    token: relayerAlertSwitch.token,
    chatId: relayerAlertSwitch.chatId,
    relayers,
    log: (line) => console.log(line),
    onBalance: async (chainKey, balance) => {
      await owner.recordBalance(chainKey, balance);
      await owner.checkFast();
    },
  });
  // In the background: a slow RPC or Telegram must not hold the start.
  void relayerAlert.start();
  console.log("relayer alert on");
} else {
  console.log(`relayer alert off: ${relayerAlertSwitch.reason}`);
  console.log("owner alerts off: they need the relayer alert on");
}

/**
 * The pinned trending post: its own switch, the posts channel. Read only:
 * the cards of `GET /api/trending?chain=all` every 5 minutes. The pin alert goes to the private
 * alert chat when that is on.
 */
const trending = telegramTrendingSettings(config);
let trendingPoster: TrendingPoster | null = null;
const allChains = chainFilter("all", { mainnetSite: isMainnetSite(config) });
if (trending.on && allChains !== undefined) {
  const source = {
    db: handle.db,
    indexer,
    now: () => new Date(),
    indexerChainKey: config.CHAIN_KEY,
    solana: solanaReader,
    config,
  };
  trendingPoster = createTrendingPoster({
    db: handle.db,
    fetch: globalThis.fetch,
    now: () => new Date(),
    token: trending.token,
    channelId: trending.channelId,
    siteUrl: config.SHARE_BASE_URL,
    network: trendingNetwork(config),
    read: async () => {
      try {
        return await readTrending(source, allChains);
      } catch (error) {
        if (error instanceof IndexerUnavailableError || error instanceof SolanaUnavailableError) {
          return null;
        }
        throw error;
      }
    },
    alert: relayerAlertSwitch.on
      ? (text) =>
          sendPrivateAlert(
            {
              fetch: globalThis.fetch,
              token: relayerAlertSwitch.token,
              chatId: relayerAlertSwitch.chatId,
            },
            text,
          )
      : null,
    log: (line) => console.log(line),
  });
  // In the background: a slow read or Telegram must not hold the start.
  trendingPoster.start();
  console.log("telegram trending on");
} else {
  console.log(`telegram trending off: ${trending.on ? "no chain filter" : trending.reason}`);
}

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
        telegramPosts: telegram.on,
        // Binding v2 drops are signed at each send.
        binders,
      });
if (worker !== null) {
  await worker.start();
  console.log(`worker polling every ${String(config.WATCHER_POLL_MS)}ms`);
}

// Secrets are replaced, never shortened.
console.log("dropchad api starting", redactedConfig(config));

const server = serve(listenOptions(config, app.fetch), (info) => {
  console.log(`listening on http://${config.HOST}:${String(info.port)}`);
});

// Expired login states and sessions, once at start and then every hour.
const cleanup = startCleanup({
  run: async () => {
    const deleted = await cleanupExpired(handle.db, new Date());
    if (deleted.sessions > 0 || deleted.oauthStates > 0) {
      console.log(
        `cleanup: ${String(deleted.sessions)} sessions, ${String(deleted.oauthStates)} login states`,
      );
    }
  },
  onError: (error) => console.error("cleanup failed", error),
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}, shutting down`);
  cleanup.stop();
  worker?.stop();
  addons.stop();
  telegramSender?.stop();
  trendingPoster?.stop();
  relayerAlert?.stop();
  ownerAlerts?.stop();
  server.close();
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
