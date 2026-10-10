/**
 * Test harness: a whole api over an in-memory Postgres and a stubbed x.com.
 *
 * The X stub is a **`fetch` implementation**, not a fake `XClient`. That matters: the real
 * `createXClient` code runs, so the tests actually check the Basic auth header, the form body,
 * the `code_verifier`, and the parsing of `users/me`. A hand written fake client would test
 * nothing but itself.
 */
import { createApp, type AppDeps, type SolanaStatus } from "../src/app.js";
import type { ChainAdapters } from "../src/chain/adapter.js";
import type { ChainGateway } from "../src/chain/gateway.js";
import type { SvmReader } from "../src/chain/svm/reader.js";
import type { TokenChecker } from "../src/chain/svm/token-check.js";
import type { PriceService } from "../src/prices/service.js";
import { buildBinders } from "../src/binder/binders.js";
import type { DropEventBus } from "../src/worker/events.js";
import { createXClient } from "../src/auth/x-client.js";
import { loadConfig, type Config } from "../src/config.js";
import { openAndMigrate, type Database, type DatabaseHandle } from "../src/db/client.js";
import {
  IndexerUnavailableError,
  type BoardDrop,
  type IndexerClient,
} from "../src/indexer/client.js";
import { createDropEventBus } from "../src/worker/events.js";
import { adaptersFor } from "./fake-chain.js";

/**
 * The EVM write side as the tests have always built it: a gateway and a chain name. The harness
 * wraps it in the real EVM adapter, so every existing test runs the adapter code unchanged.
 */
export interface WriteSide {
  readonly chain: ChainGateway;
  readonly chainName: string;
}

/**
 * ETH at 2,000 usd and SOL at 100 usd, so the 0.01 usd testnet minimum of the design is
 * 5,000,000,000,000 wei and 100,000 lamports: under every amount the older create tests use.
 */
export const FAKE_PRICES: PriceService = {
  usdPrice: (symbol) => Promise.resolve(symbol === "ETH" ? 2_000 : symbol === "SOL" ? 100 : null),
};

export const TEST_ENV = {
  NODE_ENV: "test",
  // The test drops use tiny amounts; the 1 usd default the design is tested in config.test.ts
  // and fee-guards.test.ts, which load the config without this line.
  MIN_RECEIVER_USD_TESTNET: "0.01",
  PORT: "3000",
  X_CLIENT_ID: "test-client-id",
  X_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:3000",
  DATABASE_URL: "memory://",
  INDEXER_URL: "http://localhost:42069",
} as const;

/**
 * A stub indexer. The forwarding client itself is tested separately, against a stubbed `fetch`.
 * Here the api's own routes are what is under test: validation, status codes and shapes.
 */
export interface IndexerStubOptions {
  drops?: unknown;
  /** Anything falsy, or absent, means the stub reports no such drop. */
  drop?: unknown;
  /**
   * `getDrop` per address, lowercase keys: the indexed drop row, answered as
   * `{ drop, claims: [], events: [] }`. An address not in the map falls back to `drop`.
   */
  dropsByAddress?: Readonly<Record<string, unknown>>;
  /** The indexed claims `getDrop` answers per address, lowercase keys. Absent means none. */
  claimsByAddress?: Readonly<Record<string, readonly unknown[]>>;
  stats?: unknown;
  /** What `/board-drops` answers, whatever the `since`. The api does the window filtering too. */
  boardDrops?: readonly BoardDrop[];
  /** Make every call fail the way an indexer that is down does. */
  down?: boolean;
}

export function createIndexerStub(options: IndexerStubOptions = {}): IndexerClient {
  const fail = () => {
    throw new IndexerUnavailableError();
  };
  return {
    listDrops: (limit) =>
      options.down === true ? fail() : Promise.resolve(options.drops ?? { drops: [], limit }),
    getDrop: (address) => {
      if (options.down === true) return fail();
      const own = options.dropsByAddress?.[address.toLowerCase()];
      const claims = options.claimsByAddress?.[address.toLowerCase()] ?? [];
      if (own !== undefined) return Promise.resolve({ drop: own, claims, events: [] });
      // `drop: null` and an absent `drop` both mean "no such drop".
      return Promise.resolve(options.drop == null ? null : { drop: { address } });
    },
    getStats: () =>
      options.down === true
        ? fail()
        : Promise.resolve(
            options.stats ?? {
              droppedTotalWei: "0",
              dropCount: 0,
              uniqueReceivers: 0,
              claimCount: 0,
              finality: "final",
            },
          ),
    listBoardDrops: (since) =>
      options.down === true
        ? fail()
        : Promise.resolve({
            drops: (options.boardDrops ?? []).filter(
              (drop) => since === null || Number(drop.createdAt) >= since,
            ),
            finality: "final" as const,
          }),
    isHealthy: () => Promise.resolve(options.down !== true),
  };
}

export interface XCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface XStubOptions {
  /** What `users/me` returns. */
  user?: { id: string; username: string; name: string; profile_image_url?: string };
  /** Force the token endpoint to fail with this status. */
  tokenStatus?: number;
  /** Force `users/me` to fail with this status. */
  meStatus?: number;
  accessToken?: string;
  /** The accounts `GET /2/users/by` knows. Absent: the lookup is not stubbed. */
  xLookup?: readonly { id: string; username: string; name: string; profile_image_url?: string }[];
}

export interface XStub {
  readonly calls: XCall[];
  readonly fetchImpl: typeof fetch;
  /** Every `code_verifier` the token endpoint received. */
  verifiers(): string[];
  revoked(): string[];
}

export function createXStub(options: XStubOptions = {}): XStub {
  const calls: XCall[] = [];
  const accessToken = options.accessToken ?? "x-access-token-abc";
  const user = options.user ?? {
    id: "1234567890",
    username: "dropchadfun",
    name: "dropchad",
    profile_image_url: "https://pbs.twimg.com/profile_images/1/avatar.png",
  };

  const json = (status: number, payload: unknown): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  const fetchImpl: typeof fetch = (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) {
      headers[key.toLowerCase()] = value;
    }

    const body =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string"
          ? init.body
          : "";

    calls.push({ url, method, headers, body });

    if (url.startsWith("https://api.x.com/2/oauth2/token")) {
      return options.tokenStatus !== undefined
        ? json(options.tokenStatus, { error: "invalid_grant" })
        : json(200, { token_type: "bearer", expires_in: 7200, access_token: accessToken });
    }

    if (url.startsWith("https://api.x.com/2/users/me")) {
      return options.meStatus !== undefined
        ? json(options.meStatus, { title: "Unauthorized" })
        : json(200, { data: user });
    }

    if (url.startsWith("https://api.x.com/2/oauth2/revoke")) {
      return json(200, { revoked: true });
    }

    if (url.startsWith("https://api.x.com/2/users/by") && options.xLookup !== undefined) {
      const known = new Map(options.xLookup.map((u) => [u.username.toLowerCase(), u]));
      const names = (new URL(url).searchParams.get("usernames") ?? "").split(",");
      const data = names.map((n) => known.get(n.toLowerCase())).filter((u) => u !== undefined);
      return json(200, data.length > 0 ? { data } : { errors: [{ title: "Not Found Error" }] });
    }

    throw new Error(`unexpected fetch to ${url}`);
  };

  return {
    calls,
    fetchImpl,
    verifiers: () =>
      calls
        .filter((call) => call.url.includes("/oauth2/token"))
        .map((call) => new URLSearchParams(call.body).get("code_verifier") ?? ""),
    revoked: () =>
      calls
        .filter((call) => call.url.includes("/oauth2/revoke"))
        .map((call) => new URLSearchParams(call.body).get("token") ?? ""),
  };
}

export interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly deps: AppDeps;
  readonly config: Config;
  readonly handle: DatabaseHandle;
  readonly x: XStub;
  /** Move the app's clock. Nothing waits thirty days for a session to expire. */
  setNow(date: Date): void;
  close(): Promise<void>;
}

export async function createHarness(
  options: XStubOptions & {
    indexer?: IndexerStubOptions;
    /** Absent means no relayer key, which is how the read only api runs. */
    writeSide?: WriteSide;
    /**
     * A write side that needs the database to exist first, which the real one does: the relayer
     * asks the `drops` table whether an address is a drop we created, and the gas budget lives in
     * a table too. The anvil test uses this.
     */
    writeSideFor?: (db: Database) => WriteSide;
    /** Several chains at once, already wrapped. The Solana tests use this. */
    writeSides?: ChainAdapters;
    /** What `index.ts` reports about the Solana write side. */
    solana?: SolanaStatus;
    /** The Solana read side, over a fake cluster. */
    solanaReader?: SvmReader;
    /** The token check of, over a fake cluster. Absent means `503 solana_unavailable`. */
    tokenChecker?: TokenChecker;
    /**
     * The Robinhood token check. Absent, as on the live api until `DropFactoryV3` is
     * recorded: `?chain=robinhood` is `400 chain_not_supported`.
     */
    evmTokenChecker?: TokenChecker;
    /** Pass the worker's bus in when a test wants the SSE stream to see real events. */
    events?: DropEventBus;
    /** Override single env values. `{ NODE_ENV: "production" }` is the use today. */
    /** Override or add single env values, as `apps/api/.env` would. */
    env?: Partial<Record<string, string>>;
    /** The usd feed the create guards read. Absent means `FAKE_PRICES`. */
    prices?: PriceService;
    /**
     * The commitment blind of each new drop. Absent means the real random source; a
     * test fixes it only when it must know a commitment before the drop exists.
     */
    randomBlind?: () => `0x${string}`;
  } = {},
): Promise<Harness> {
  const config = loadConfig({ ...TEST_ENV, ...options.env });
  const handle = await openAndMigrate(config.DATABASE_URL);
  const x = createXStub(options);

  let current = new Date("2026-09-09T00:00:00.000Z");

  const deps: AppDeps = {
    config,
    db: handle.db,
    xClient: createXClient({
      clientId: config.X_CLIENT_ID,
      clientSecret: config.X_CLIENT_SECRET,
      redirectUri: config.xCallbackUrl,
      fetchImpl: x.fetchImpl,
    }),
    indexer: createIndexerStub(options.indexer),
    now: () => current,
    events: options.events ?? createDropEventBus(),
    writeSides: options.writeSides ?? wrap(options.writeSide ?? options.writeSideFor?.(handle.db)),
    solana: options.solana,
    solanaReader: options.solanaReader,
    tokenChecker: options.tokenChecker,
    evmTokenChecker: options.evmTokenChecker,
    xFetch: x.fetchImpl,
    prices: options.prices ?? FAKE_PRICES,
    binders: buildBinders(config),
    ...(options.randomBlind === undefined ? {} : { randomBlind: options.randomBlind }),
  };

  return {
    app: createApp(deps),
    deps,
    config,
    handle,
    x,
    setNow: (date) => {
      current = date;
    },
    close: () => handle.close(),
  };
}

function wrap(side: WriteSide | undefined): ChainAdapters | undefined {
  return side === undefined ? undefined : adaptersFor(side.chain);
}

// ---------------------------------------------------------------------------
// cookie helpers
// ---------------------------------------------------------------------------

/** Parse `set-cookie` headers into a name -> value map. Attributes are dropped. */
export function cookiesFrom(response: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const index = pair?.indexOf("=") ?? -1;
    if (pair === undefined || index < 0) continue;
    jar[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
  }
  return jar;
}

/** The raw `set-cookie` header for one cookie, so a test can assert on its flags. */
export function setCookieHeader(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

export function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

/** Walk a login from `/api/auth/x/start` to a signed in cookie jar. */
export async function login(
  harness: Harness,
  options: { code?: string } = {},
): Promise<{ jar: Record<string, string>; callback: Response }> {
  const start = await harness.app.request("/api/auth/x/start");
  const startJar = cookiesFrom(start);
  const location = start.headers.get("location");
  if (location === null) throw new Error("start did not redirect");
  const state = new URL(location).searchParams.get("state");
  if (state === null) throw new Error("start had no state");

  const callback = await harness.app.request(
    `/api/auth/x/callback?code=${options.code ?? "auth-code-1"}&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookieHeader(startJar) } },
  );

  return { jar: { ...startJar, ...cookiesFrom(callback) }, callback };
}
