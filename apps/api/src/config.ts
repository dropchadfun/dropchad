/**
 * Environment, parsed once and validated with zod.
 *
 * Nothing else in the api reads `process.env`. If a value is missing or malformed the process
 * refuses to start and says exactly which variable is wrong, instead of failing later with an
 * `undefined` in a header.
 *
 * **No value in here is ever logged.** `X_CLIENT_SECRET` and `SESSION_SECRET` are secrets, and
 * `redactedConfig()` is what goes into a log line.
 */
import {
  ChainRegistryError,
  getChain,
  getDeployedChain,
  rpcUrlFor,
  rpcUrlsFor,
} from "@dropchad/chains";
import { z } from "zod";

import { parseTokenFeeTiers } from "./drops/token-fee.js";

/**
 * Thirty days. Absolute from login, no sliding
 * renewal, rotated on login. Was twelve hours; every sign in costs one X user
 * read, so a short session was a daily bill.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** How long a half finished login may sit before its state row expires. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/**
 * `users.read` and `tweet.read` are what `GET /2/users/me` needs, confirmed on
 * https://docs.x.com/x-api/users/user-lookup-me.
 *
 * `offline.access` is **deliberately not requested**. We use the access token once, to read the
 * numeric user id, and then throw it away. A refresh token would be a stored credential we have
 * no use for.
 */
export const X_SCOPES = ["users.read", "tweet.read"] as const;

/**
 * The two drop periods.: the production default is 24 hours of
 * funding and a 7 day claim period. A drop made
 * before keeps what it was created with: both are written into the drop at creation. v1 does
 * not let a user change them, so they are constants here and not request fields. Both sit well
 * inside the factory and program bounds of section 6.12.
 */
export const FUNDING_PERIOD_SECONDS = 24 * 60 * 60;
export const CLAIM_PERIOD_SECONDS = 7 * 24 * 60 * 60;

/** Creates allowed per X id per rolling hour. Counted in the database, so a restart cannot reset it. */
export const CREATE_RATE_LIMIT = 5;
export const CREATE_RATE_WINDOW_SECONDS = 60 * 60;

/**
 * An `http:` or `https:` URL.
 *
 * `z.url()` on its own is not enough: the URL parser reads `localhost:3000` as a URL whose
 * protocol is `localhost:`, so a missing scheme sails through and only fails later, when a
 * redirect goes somewhere strange.
 */
function httpUrl() {
  return z.url().refine(
    (value) => {
      const protocol = URL.parse(value)?.protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: "must be an http:// or https:// url" },
  );
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * The port the api listens on. **4000** in dev. `apps/web` owns 3000, because the X app's
   * registered callback is `http://localhost:3000/api/auth/x/callback` and X matches the redirect
   * URI exactly; the web app rewrites `/api/*` to this port. `APP_URL` and `API_URL` therefore
   * stay on the 3000 origin: the browser only ever talks to 3000, so the cookies are shared.
   */
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /** The X app's client id. Public, but it still lives in `.env`, never in the repo. */
  X_CLIENT_ID: z.string().min(1),
  /** Confidential client secret. Sent only in a Basic auth header to X. Never logged. */
  X_CLIENT_SECRET: z.string().min(1),

  /**
   * The X app's **app-only** bearer token, for `GET /2/users/by`. From the
   * X developer console. Optional: without it no handle is looked up, a cached one still works.
   * Never logged, never in an error message, never returned by a route.
   */
  X_BEARER_TOKEN: z.string().min(1).optional(),
  /** At most this many receivers in a handle drop. Api config, never a contract constant. */
  HANDLE_MAX_RECEIVERS: z.coerce.number().int().min(1).max(10_000).default(500),
  /**
   * Paid X lookups a UTC day, charged before the call. 1,000 on testnet, where the X credits are
   * 25 usd, one cent a lookup. Cached handles never count.
   */
  HANDLE_LOOKUPS_DAILY_MAX: z.coerce.number().int().min(0).default(1_000),

  /**
   * The least a receiver may get, in usd, checked on every
   * leaf at the current price. Picked by the chain's kind; 1 usd on both
   * so a testnet behaves like mainnet (was 5 and 0.01). Decimal strings, never floats.
   */
  MIN_RECEIVER_USD_MAINNET: z
    .string()
    .regex(/^[0-9]+(\.[0-9]{1,6})?$/, "must be a usd amount like 5 or 0.01, at most six decimals")
    .default("1"),
  MIN_RECEIVER_USD_TESTNET: z
    .string()
    .regex(/^[0-9]+(\.[0-9]{1,6})?$/, "must be a usd amount like 5 or 0.01, at most six decimals")
    .default("1"),
  /**
   * The token drop fee in usd by the number of people, paid in
   * SOL: `people:usd` pairs, going up. The end of the last tier is the most people a token drop
   * takes, whatever `HANDLE_MAX_RECEIVERS` says. The tiers
   * $1, $3, $6, $10, $20 (were $3, $8, $15, $25, $40).
   */
  TOKEN_FEE_TIERS_USD: z
    .string()
    .default("5:1,20:3,50:6,100:10,500:20")
    .superRefine((value, ctx) => {
      try {
        parseTokenFeeTiers(value);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "bad" });
      }
    }),

  /**
   * the EVM gas numbers behind the fee check, from. `createDrop` and
   * `activate` measured 327,808 to 353,841 and 74,443 to 85,179, rounded up. A `claimBatch` costs
   * about 86,000 plus about 47,440 a fresh receiver, estimates, rounded up. A `claimHandle` is one
   * transaction per leaf: 110,984 measured for a single `claim`, plus about 11,000 for the binder
   * check (local, not measured on chain), rounded up. Estimates, so the check errs high.
   */
  EVM_GAS_CREATE_DROP: z.coerce.number().int().positive().default(360_000),
  EVM_GAS_ACTIVATE: z.coerce.number().int().positive().default(90_000),
  EVM_GAS_CLAIM_BATCH_BASE: z.coerce.number().int().positive().default(86_000),
  EVM_GAS_PER_ADDRESS_CLAIM: z.coerce.number().int().positive().default(50_000),
  EVM_GAS_PER_HANDLE_CLAIM: z.coerce.number().int().positive().default(130_000),
  /**
   * a Robinhood token drop on `DropV3`. The local V3 gas report of the design says
   * `createDrop` 342,067, `activate` 90,412, a token `claimHandle` 110,730, execution only; plus
   * the 21,000 of a transaction and calldata, rounded up. Estimates until the live test.
   */
  EVM_GAS_TOKEN_CREATE_DROP: z.coerce.number().int().positive().default(400_000),
  EVM_GAS_TOKEN_ACTIVATE: z.coerce.number().int().positive().default(130_000),
  EVM_GAS_PER_TOKEN_HANDLE_CLAIM: z.coerce.number().int().positive().default(160_000),

  /** HMAC key for session id hashing. At least 32 characters. */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  /** Where the browser goes after a successful login. The frontend origin. */
  APP_URL: httpUrl(),
  /** This api's own public origin. The X callback URL is derived from it. */
  API_URL: httpUrl(),

  /**
   * Local dev: a PGlite directory path, or `memory://` for a throwaway database.
   * Production: a `postgres://` URL. The driver swap is one file, `src/db/client.ts`.
   */
  DATABASE_URL: z.string().min(1),

  /** The EVM chain RPC. Optional: without it the api runs read only, `chainRpcUrls`. */
  ROBINHOOD_TESTNET_RPC_URL: z.string().optional(),
  /** Used only when the primary fails, `rpcUrlsFor` in `packages/chains`. A keyed url is fine here. */
  ROBINHOOD_TESTNET_RPC_URL_FALLBACK: z.string().optional(),

  /**
   * Where the indexer serves its read endpoints. `apps/api` forwards /api/drops and /api/stats
   * there, because PGlite is single process and the indexer owns its database.
   * Ponder's default port is 42069.
   */
  INDEXER_URL: httpUrl().default("http://localhost:42069"),
  /** The usd price feed, `src/prices`. Coingecko free tier; the key is optional and never logged. */
  COINGECKO_URL: httpUrl().default("https://api.coingecko.com/api/v3"),
  COINGECKO_API_KEY: z.string().optional(),
  PRICE_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),

  /**
   * Which chain the write side works on. A key from `packages/chains`, and it must be a chain
   * with a deployed factory.
   */
  CHAIN_KEY: z.string().min(1).default("robinhood-testnet"),

  /**
   * The relayer private key. **Local dev only**. On mainnet it moves
   * to a KMS. .
   *
   * **Optional on purpose.** Without it the api still starts and the whole read side works; only
   * the write routes answer `503 relayer_not_configured`. That is what lets the test suite and a
   * read only deployment run with no key anywhere near them.
   *
   * It is never logged, never returned by a route, and never written to a file by this code.
   */
  RELAYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x prefixed 32 byte hex key")
    .optional(),

  /**
   * The address the key above is expected to derive to. When it is set and the derived address
   * does not match, the api refuses to start. That is the cheap guard against pasting the wrong
   * wallet's key and sending drops from an address the factory does not allow.
   */
  RELAYER_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
    .optional(),

  /**
   * The Solana chain the write side works on. A key from `packages/chains` with `family: "svm"`
   * and a deployed program.
   */
  SOLANA_CHAIN_KEY: z.string().min(1).default("solana-devnet"),

  /**
   * The Solana relayer keypair, as `solana-keygen` writes it: a JSON array of 64 bytes, or the
   * same bytes in base58. **Local dev only**. Optional for the same
   * reason `RELAYER_PRIVATE_KEY` is: without it the Solana write side is off and everything else
   * runs. Never logged, never returned, never written by this code.
   */
  SOLANA_RELAYER_SECRET: z.string().min(1).optional(),

  /** The base58 address the secret above must derive to. Same guard as `RELAYER_ADDRESS`. */
  SOLANA_RELAYER_ADDRESS: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 public key")
    .optional(),

  /**
   * The binder keys. One secp256k1 key for the EVM,
   * one ed25519 key for Solana, each its own key and never a relayer key. Testnet only here,
   * under the server exception of. Optional: without one
   * that chain refuses a bind with `503 binder_not_configured`. Never logged, never returned.
   */
  BINDER_EVM_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x prefixed 32 byte hex key")
    .optional(),
  /** The address the EVM binder key must derive to. The api refuses to start on a mismatch. */
  BINDER_EVM_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
    .optional(),
  /** The Solana binder keypair, the 64 byte JSON array or base58, like `SOLANA_RELAYER_SECRET`. */
  BINDER_SOLANA_SECRET: z.string().min(1).optional(),
  /** The base58 public key the Solana binder secret must derive to. */
  BINDER_SOLANA_ADDRESS: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 public key")
    .optional(),
  /**
   * A bind needs an X login this recent, in seconds. 10 minutes: a
   * stolen 30 day cookie alone cannot bind. Each login is a cent of X API.
   */
  BIND_FRESH_LOGIN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),

  /**
   * Lamports the Solana relayer may spend in one UTC day: fees, priority fees and the rent it
   * fronts for every drop. Default 0.1 SOL, a fifth of the 0.5 devnet SOL the wallet holds.
   * Same table and same charge-before-send rule as the EVM budget.
   */
  SOLANA_RELAYER_DAILY_BUDGET_LAMPORTS: z
    .string()
    .regex(/^[0-9]+$/, "must be a whole number of lamports, as digits")
    .default("100000000"),

  /**
   * Hard ceiling on the compute unit limit of one Solana transaction. Nine SOL claims at depth 1
   * measure well under 150,000 units; the network cap is 1,400,000.
   */
  SOLANA_MAX_COMPUTE_UNITS: z.coerce.number().int().min(10_000).max(1_400_000).default(400_000),

  /** Priority fee in micro lamports per compute unit.: zero on devnet. */
  SOLANA_PRIORITY_FEE_MICROLAMPORTS: z
    .string()
    .regex(/^[0-9]+$/, "must be a whole number of micro lamports, as digits")
    .default("0"),

  /** Hard ceiling on the gas limit of one `createDrop`. A bigger estimate is refused, not sent. */
  RELAYER_MAX_GAS_PER_CREATE: z.coerce.number().int().positive().default(2_000_000),

  /** Hard ceiling on the gas limit of one `claimBatch` of up to `MAX_BATCH` claims. */
  RELAYER_MAX_GAS_PER_CLAIM_BATCH: z.coerce.number().int().positive().default(3_000_000),

  /** Hard ceiling on one `claimHandle`. About 79,000 measured locally. */
  RELAYER_MAX_GAS_PER_CLAIM_HANDLE: z.coerce.number().int().positive().default(300_000),

  /**
   * How much gas money the relayer may spend in one UTC day, in wei. Default is 0.0005 ETH, a
   * quarter of the 0.002 test ETH the testnet wallet holds, so a bug cannot drain it in one run.
   * Spending is recorded in the database, so a restart does not reset the day.
   */
  RELAYER_DAILY_GAS_BUDGET_WEI: z
    .string()
    .regex(/^[0-9]+$/, "must be a whole number of wei, as digits")
    .default("500000000000000"),

  /**
   * How often the worker looks again: at a drop's balance while it waits for funding, and at the
   * job queue in general. Five seconds is well inside the two second block time of an Orbit L2 and
   * light enough for a public RPC.
   */
  WATCHER_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(5_000),

  /**
   * The public base url for share links.
   *
   * Separate from `APP_URL` on purpose. `APP_URL` is where this process sends a browser after a
   * login, which in dev is localhost; a share link is what somebody posts on X, and posting
   * `http://localhost:3000/d/0x...` helps nobody. So this defaults to the real domain even in dev.
   */
  SHARE_BASE_URL: httpUrl().default("https://dropchad.com"),
});

export type Config = Readonly<z.infer<typeof schema>> & {
  /** Exactly the URL registered with X. Derived, never configured twice. */
  readonly xCallbackUrl: string;
  /** `RELAYER_DAILY_GAS_BUDGET_WEI` as the number it is. Parsed once, here. */
  readonly relayerDailyGasBudgetWei: bigint;
  /**
   * The RPC urls for `CHAIN_KEY`, primary first, then the fallback when one is set; `null` when
   * the primary is not set.
   *
   * The registry holds the env var **names**, never a url, so which variables to read is only
   * known after `CHAIN_KEY` is parsed. Resolving them here keeps this file the only reader of
   * `process.env`. `null` is fine for a read only run: only the write side needs an RPC.
   */
  readonly chainRpcUrls: readonly string[] | null;
  /** The RPC url for `SOLANA_CHAIN_KEY`, or `null` when its env var is not set. */
  readonly solanaRpcUrl: string | null;
  readonly solanaRelayerDailyBudgetLamports: bigint;
  readonly solanaPriorityFeeMicroLamports: bigint;
};

/**
 * The RPC urls for a chain key, or `null` when the primary variable the registry names is not set.
 *
 * A wrong `CHAIN_KEY`, or a chain with no deployed factory, is a real configuration mistake and
 * throws. A missing RPC url is not: the read side never makes an RPC call.
 */
function resolveRpcUrls(chainKey: string, env: NodeJS.ProcessEnv): readonly string[] | null {
  const chain = getDeployedChain(chainKey);
  try {
    return rpcUrlsFor(chain, env);
  } catch (error) {
    if (error instanceof ChainRegistryError) return null;
    throw error;
  }
}

/** Same as above for the Solana chain, which is looked up by key alone: it has no factory. */
function resolveSolanaRpcUrl(chainKey: string, env: NodeJS.ProcessEnv): string | null {
  const chain = getChain(chainKey);
  if (chain.family !== "svm") {
    throw new ChainRegistryError(`SOLANA_CHAIN_KEY "${chainKey}" is not an svm chain`);
  }
  try {
    return rpcUrlFor(chain, env);
  } catch (error) {
    if (error instanceof ChainRegistryError) return null;
    throw error;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `invalid environment. apps/api/.env.example lists every name.\n${problems}\n\n` +
        `Copy apps/api/.env.example to apps/api/.env and fill it in.`,
    );
  }

  const config = parsed.data;
  return {
    ...config,
    xCallbackUrl: new URL("/api/auth/x/callback", config.API_URL).toString(),
    relayerDailyGasBudgetWei: BigInt(config.RELAYER_DAILY_GAS_BUDGET_WEI),
    chainRpcUrls: resolveRpcUrls(config.CHAIN_KEY, env),
    solanaRpcUrl: resolveSolanaRpcUrl(config.SOLANA_CHAIN_KEY, env),
    solanaRelayerDailyBudgetLamports: BigInt(config.SOLANA_RELAYER_DAILY_BUDGET_LAMPORTS),
    solanaPriorityFeeMicroLamports: BigInt(config.SOLANA_PRIORITY_FEE_MICROLAMPORTS),
  };
}

/** What is safe to print. Secrets are replaced, never shortened, so nothing leaks by prefix. */
export function redactedConfig(config: Config): Record<string, string | number> {
  return {
    NODE_ENV: config.NODE_ENV,
    PORT: config.PORT,
    APP_URL: config.APP_URL,
    API_URL: config.API_URL,
    xCallbackUrl: config.xCallbackUrl,
    DATABASE_URL: config.DATABASE_URL.startsWith("postgres")
      ? "postgres://<redacted>"
      : config.DATABASE_URL,
    INDEXER_URL: config.INDEXER_URL,
    COINGECKO_URL: config.COINGECKO_URL,
    COINGECKO_API_KEY: config.COINGECKO_API_KEY === undefined ? "<unset>" : "<set>",
    PRICE_TTL_MS: config.PRICE_TTL_MS,
    CHAIN_KEY: config.CHAIN_KEY,
    chainRpcUrls:
      config.chainRpcUrls === null ? "<unset>" : `<set, ${String(config.chainRpcUrls.length)}>`,
    RELAYER_ADDRESS: config.RELAYER_ADDRESS ?? "<unset>",
    SOLANA_CHAIN_KEY: config.SOLANA_CHAIN_KEY,
    solanaRpcUrl: config.solanaRpcUrl === null ? "<unset>" : "<set>",
    SOLANA_RELAYER_ADDRESS: config.SOLANA_RELAYER_ADDRESS ?? "<unset>",
    SOLANA_RELAYER_DAILY_BUDGET_LAMPORTS: config.SOLANA_RELAYER_DAILY_BUDGET_LAMPORTS,
    SOLANA_MAX_COMPUTE_UNITS: config.SOLANA_MAX_COMPUTE_UNITS,
    SOLANA_PRIORITY_FEE_MICROLAMPORTS: config.SOLANA_PRIORITY_FEE_MICROLAMPORTS,
    RELAYER_MAX_GAS_PER_CREATE: config.RELAYER_MAX_GAS_PER_CREATE,
    RELAYER_MAX_GAS_PER_CLAIM_BATCH: config.RELAYER_MAX_GAS_PER_CLAIM_BATCH,
    RELAYER_MAX_GAS_PER_CLAIM_HANDLE: config.RELAYER_MAX_GAS_PER_CLAIM_HANDLE,
    RELAYER_DAILY_GAS_BUDGET_WEI: config.RELAYER_DAILY_GAS_BUDGET_WEI,
    WATCHER_POLL_MS: config.WATCHER_POLL_MS,
    SHARE_BASE_URL: config.SHARE_BASE_URL,
    X_CLIENT_ID: "<set>",
    X_CLIENT_SECRET: "<set>",
    X_BEARER_TOKEN: config.X_BEARER_TOKEN === undefined ? "<unset>" : "<set>",
    HANDLE_MAX_RECEIVERS: config.HANDLE_MAX_RECEIVERS,
    HANDLE_LOOKUPS_DAILY_MAX: config.HANDLE_LOOKUPS_DAILY_MAX,
    MIN_RECEIVER_USD_MAINNET: config.MIN_RECEIVER_USD_MAINNET,
    MIN_RECEIVER_USD_TESTNET: config.MIN_RECEIVER_USD_TESTNET,
    EVM_GAS_CREATE_DROP: config.EVM_GAS_CREATE_DROP,
    EVM_GAS_ACTIVATE: config.EVM_GAS_ACTIVATE,
    EVM_GAS_CLAIM_BATCH_BASE: config.EVM_GAS_CLAIM_BATCH_BASE,
    EVM_GAS_PER_ADDRESS_CLAIM: config.EVM_GAS_PER_ADDRESS_CLAIM,
    EVM_GAS_PER_HANDLE_CLAIM: config.EVM_GAS_PER_HANDLE_CLAIM,
    EVM_GAS_TOKEN_CREATE_DROP: config.EVM_GAS_TOKEN_CREATE_DROP,
    EVM_GAS_TOKEN_ACTIVATE: config.EVM_GAS_TOKEN_ACTIVATE,
    EVM_GAS_PER_TOKEN_HANDLE_CLAIM: config.EVM_GAS_PER_TOKEN_HANDLE_CLAIM,
    SESSION_SECRET: "<set>",
    // Never a prefix, never a length. Set or not set is the only thing worth printing.
    RELAYER_PRIVATE_KEY: config.RELAYER_PRIVATE_KEY === undefined ? "<unset>" : "<set>",
    SOLANA_RELAYER_SECRET: config.SOLANA_RELAYER_SECRET === undefined ? "<unset>" : "<set>",
    BINDER_EVM_PRIVATE_KEY: config.BINDER_EVM_PRIVATE_KEY === undefined ? "<unset>" : "<set>",
    BINDER_EVM_ADDRESS: config.BINDER_EVM_ADDRESS ?? "<unset>",
    BINDER_SOLANA_SECRET: config.BINDER_SOLANA_SECRET === undefined ? "<unset>" : "<set>",
    BINDER_SOLANA_ADDRESS: config.BINDER_SOLANA_ADDRESS ?? "<unset>",
    BIND_FRESH_LOGIN_SECONDS: config.BIND_FRESH_LOGIN_SECONDS,
  };
}
