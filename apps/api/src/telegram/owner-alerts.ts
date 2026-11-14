/**
 * The owner alerts.
 *
 * Five alerts in the private chat of the relayer alert, with the same bot and the same
 * switch: 1 relayer money falling fast, 2 many claims, 3 admin actions, 5 api errors, 6 ETH
 * waiting in a drop. Alert 4 is not in the api.
 *
 * **At most once every 30 minutes per key.** `alerts_sent` keeps when each key was last sent,
 * written only after Telegram answered ok: a failed send is tried at the next check, and a
 * restart does not send again.
 *
 * **Read only.** Balance reads, `relayer_txs`, one account read and a few views. No transaction,
 * no key. **No error text in a message**, and the token never in a log.
 */
import { findChain } from "@dropchad/chains";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getAddress } from "viem";

import { decodeConfig, CONFIG_ACCOUNT_BYTES } from "../chain/svm/accounts.js";
import { DROPCHAD_PROGRAM_ID, pubkeyToBase58 } from "../chain/svm/pubkey.js";
import type { ServedEvmChain } from "../chain/client.js";
import { evmFactoryFor } from "../chain/write-side.js";
import type { Database } from "../db/client.js";
import { adminSnapshots, alertsSent, relayerBalanceSamples, relayerTxs } from "../db/schema.js";
import {
  alertText,
  alertTitle,
  asTestAlert,
  countOf,
  readableAmount,
  sendPrivateAlert,
} from "./alert-send.js";

const MINUTE_MS = 60_000;
/** Alert 1 keeps the balance reads this long, then deletes them. */
const SAMPLES_KEPT_MS = 2 * 60 * MINUTE_MS;
/** How often alerts 2 and 5 look. Alert 1 looks after every balance read, alert 3 on its own. */
const CHECK_EVERY_MS = MINUTE_MS;
/** The relayer's claim transactions, `relayer_txs.kind`, both chains. */
const CLAIM_KINDS = ["claim", "claim_handle", "claimBatch", "claimHandle"];

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/** The testnet defaults. Never on a mainnet: there they are set by hand. */
const DEFAULTS = {
  repeatMinutes: 30,
  fastMinutes: 60,
  fastDropLamports: 100_000_000n,
  fastDropWei: 200_000_000_000_000n,
  claimsCount: 50,
  claimsMinutes: 10,
  adminMinutes: 5,
  apiErrorsCount: 20,
  apiErrorsMinutes: 5,
};

const NO_NUMBER = "no number set on a mainnet";

export interface OwnerAlertInput {
  readonly CHAIN_KEY: string;
  readonly SOLANA_CHAIN_KEY: string;
  readonly ALERT_REPEAT_MINUTES?: string | undefined;
  readonly RELAYER_FAST_MINUTES?: string | undefined;
  readonly RELAYER_FAST_DROP_LAMPORTS?: string | undefined;
  readonly RELAYER_FAST_DROP_WEI?: string | undefined;
  readonly CLAIMS_ALERT_COUNT?: string | undefined;
  readonly CLAIMS_ALERT_MINUTES?: string | undefined;
  readonly ADMIN_ALERT_MINUTES?: string | undefined;
  readonly API_ERRORS_ALERT_COUNT?: string | undefined;
  readonly API_ERRORS_ALERT_MINUTES?: string | undefined;
}

interface NotWatched {
  readonly chainKey: string;
  readonly reason: string;
}

export interface OwnerAlertSettings {
  readonly repeatMinutes: number;
  readonly adminMinutes: number;
  readonly fast: {
    readonly watched: { chainKey: string; drop: bigint; minutes: number }[];
    readonly notWatched: NotWatched[];
  };
  readonly claims: {
    readonly watched: { chainKey: string; count: number; minutes: number }[];
    readonly notWatched: NotWatched[];
  };
  readonly apiErrors: { count: number; minutes: number } | { notWatched: string };
}

const byHand = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;
const minutesOr = (value: string | undefined, fallback: number): number =>
  Number(byHand(value) ?? fallback);

/**
 * The alert numbers and what they watch. The EVM chain first, then Solana. On a
 * mainnet chain a default does not count: alerts 1 and 2 not watched without a number by hand,
 * and alert 5 not watched while any served chain is a mainnet and its count is not set.
 */
export function ownerAlertSettings(input: OwnerAlertInput): OwnerAlertSettings {
  const sides = [
    {
      chainKey: input.CHAIN_KEY,
      fastByHand: byHand(input.RELAYER_FAST_DROP_WEI),
      fast: DEFAULTS.fastDropWei,
    },
    {
      chainKey: input.SOLANA_CHAIN_KEY,
      fastByHand: byHand(input.RELAYER_FAST_DROP_LAMPORTS),
      fast: DEFAULTS.fastDropLamports,
    },
  ];
  const fastMinutes = minutesOr(input.RELAYER_FAST_MINUTES, DEFAULTS.fastMinutes);
  const claimsByHand = byHand(input.CLAIMS_ALERT_COUNT);
  const claimsMinutes = minutesOr(input.CLAIMS_ALERT_MINUTES, DEFAULTS.claimsMinutes);

  const fast: OwnerAlertSettings["fast"] = { watched: [], notWatched: [] };
  const claims: OwnerAlertSettings["claims"] = { watched: [], notWatched: [] };
  let anyMainnet = false;
  for (const side of sides) {
    const chain = findChain(side.chainKey);
    if (chain === undefined) {
      fast.notWatched.push({ chainKey: side.chainKey, reason: "unknown chain" });
      claims.notWatched.push({ chainKey: side.chainKey, reason: "unknown chain" });
      continue;
    }
    const mainnet = chain.kind === "mainnet";
    anyMainnet ||= mainnet;
    if (side.fastByHand === null && mainnet) {
      fast.notWatched.push({ chainKey: side.chainKey, reason: NO_NUMBER });
    } else {
      fast.watched.push({
        chainKey: side.chainKey,
        drop: side.fastByHand === null ? side.fast : BigInt(side.fastByHand),
        minutes: fastMinutes,
      });
    }
    if (claimsByHand === null && mainnet) {
      claims.notWatched.push({ chainKey: side.chainKey, reason: NO_NUMBER });
    } else {
      claims.watched.push({
        chainKey: side.chainKey,
        count: claimsByHand === null ? DEFAULTS.claimsCount : Number(claimsByHand),
        minutes: claimsMinutes,
      });
    }
  }

  const errorsByHand = byHand(input.API_ERRORS_ALERT_COUNT);
  const apiErrors =
    errorsByHand === null && anyMainnet
      ? { notWatched: "no number set while a mainnet chain is served" }
      : {
          count: errorsByHand === null ? DEFAULTS.apiErrorsCount : Number(errorsByHand),
          minutes: minutesOr(input.API_ERRORS_ALERT_MINUTES, DEFAULTS.apiErrorsMinutes),
        };

  return {
    repeatMinutes: minutesOr(input.ALERT_REPEAT_MINUTES, DEFAULTS.repeatMinutes),
    adminMinutes: minutesOr(input.ADMIN_ALERT_MINUTES, DEFAULTS.adminMinutes),
    fast,
    claims,
    apiErrors,
  };
}

// ---------------------------------------------------------------------------
// The messages, plain text
// ---------------------------------------------------------------------------

export interface FastWatch {
  readonly chainKey: string;
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Base units: above this much down in the window alerts. */
  readonly drop: bigint;
  readonly minutes: number;
}

export function fastMessage(watch: FastWatch, down: bigint, balance: bigint): string {
  const amount = (value: bigint) => readableAmount(value, watch.decimals, watch.symbol);
  return alertText([
    [alertTitle("🔴", "MONEY FALLING FAST", watch.chainKey)],
    [`Down ${amount(down)} in ${countOf(watch.minutes, "minute")}`, `Balance ${amount(balance)}`],
    ["The relayer spends much more than normal."],
    [
      "If there are many real drops, nothing to do. If not, turn off new drops and check the server.",
    ],
  ]);
}

export function claimsMessage(chainKey: string, count: number, minutes: number): string {
  return alertText([
    [alertTitle("🟠", "MANY CLAIMS", chainKey)],
    [`${countOf(count, "claim")} in ${countOf(minutes, "minute")}`],
    ["A lot of claims came very fast."],
    [
      "Look at the boards. If it is a big real drop, nothing to do. If it looks strange, turn off new drops.",
    ],
  ]);
}

export interface AdminChange {
  readonly field: string;
  readonly old: string;
  readonly new: string;
}

/** The fee fields shown as an amount of the chain's coin. */
const AMOUNT_FIELDS = new Set([
  "min_fee_lamports",
  "min_fee_per_receiver_lamports",
  "max_fee_lamports",
  "factory.minFeeAmount",
  "factory.minFeePerReceiver",
  "factory.maxFeeAmount",
]);
/** The fee fields in basis points, shown as a percent: `150` is `1.5%`. */
const BPS_FIELDS = new Set(["default_fee_bps", "factory.defaultFeeBps"]);

/** One value as the owner reads it. `admin_snapshots` keeps the raw value. */
function adminValue(chainKey: string, field: string, value: string): string {
  if (!/^[0-9]+$/.test(value)) return value;
  if (BPS_FIELDS.has(field)) {
    const bps = BigInt(value);
    const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return `${(bps / 100n).toString()}${fraction === "" ? "" : `.${fraction}`}%`;
  }
  const chain = findChain(chainKey);
  if (AMOUNT_FIELDS.has(field) && chain !== undefined) {
    return readableAmount(BigInt(value), chain.family === "svm" ? 9 : 18, chain.nativeSymbol);
  }
  return value;
}

export function adminMessage(chainKey: string, changes: readonly AdminChange[]): string {
  const shown = (c: AdminChange, value: string) => adminValue(chainKey, c.field, value);
  return alertText([
    [alertTitle("🔴", "ADMIN CHANGE", chainKey)],
    changes.map((c) => `${c.field} ${shown(c, c.old)} to ${shown(c, c.new)}`),
    ["A setting on the program was changed."],
    ["If you did it, nothing to do. If not, turn off new drops and check the admin key now."],
  ]);
}

/** One `native_waiting` row not swept, from the indexer's `GET /native-waiting`. */
export interface EthWaitingRow {
  readonly drop: string;
  /** The refund address that did not take the ETH. */
  readonly to: string;
  /** Wei, a decimal string. */
  readonly amount: string;
}

export function ethWaitingMessage(chainKey: string, row: EthWaitingRow): string {
  return alertText([
    [alertTitle("🟠", "ETH WAITING", chainKey)],
    [readableAmount(BigInt(row.amount), 18, "ETH"), `Drop ${row.drop}`, `Refund address ${row.to}`],
    ["The refund address did not take the ETH. It waits in the drop."],
    ["Tell the sender. Once that address can take ETH, anyone can send it on with sweep."],
  ]);
}

export function apiErrorsMessage(count: number, minutes: number): string {
  return alertText([
    [alertTitle("🔴", "API ERRORS", null)],
    [`${countOf(count, "error")} in ${countOf(minutes, "minute")}`],
    ["The server is failing many times."],
    ["Check the api log on the server."],
  ]);
}

// ---------------------------------------------------------------------------
// Alert 3, what is read on each chain
// ---------------------------------------------------------------------------

/** `pending_admin`: after `max_fee_lamports`, 89 bytes past the 116 byte base. */
const PENDING_ADMIN_AT = CONFIG_ACCOUNT_BYTES + 89;

/** Every field of the Solana `Config`, as text. Throws on a config without handle mode. */
export function solanaAdminFields(data: Uint8Array): Record<string, string> {
  const config = decodeConfig({
    lamports: 0n,
    owner: DROPCHAD_PROGRAM_ID,
    data,
    executable: false,
  });
  if (config.handle === null) throw new Error("the config has no handle mode fields");
  const h = config.handle;
  return {
    admin: pubkeyToBase58(config.admin),
    pending_admin: pubkeyToBase58(data.slice(PENDING_ADMIN_AT, PENDING_ADMIN_AT + 32)),
    relayer: pubkeyToBase58(config.relayer),
    fee_wallet: pubkeyToBase58(config.feeWallet),
    default_fee_bps: String(config.defaultFeeBps),
    paused: String(config.paused),
    binder: pubkeyToBase58(h.binder),
    binder_revoked: String(h.binderRevoked),
    guardian: pubkeyToBase58(h.guardian),
    min_fee_lamports: h.minFeeLamports.toString(),
    min_fee_per_receiver_lamports: h.minFeePerReceiverLamports.toString(),
    max_fee_lamports: h.maxFeeLamports.toString(),
  };
}

/** The one view call alert 3 makes. viem's `readContract` fits it. */
export interface ViewReader {
  readContract(call: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

/** One view with no input, or one `address` input, and one output. */
const typed = (name: string, output: string, inputs: readonly { type: string }[] = []) => ({
  type: "function",
  name,
  stateMutability: "view",
  inputs: inputs.map((input, n) => ({ name: `a${String(n)}`, type: input.type })),
  outputs: [{ name: "", type: output }],
});
const ADMIN_ABI = [
  typed("paused", "bool"),
  typed("owner", "address"),
  typed("pendingOwner", "address"),
  typed("defaultFeeBps", "uint16"),
  typed("feeRecipient", "address"),
  typed("minFeeAmount", "uint256"),
  typed("minFeePerReceiver", "uint256"),
  typed("maxFeeAmount", "uint256"),
  typed("allowedCreator", "bool", [{ type: "address" }]),
  typed("binder", "address"),
  typed("revoked", "bool"),
  typed("guardian", "address"),
  typed("pauseGuardian", "address"),
] as const;

const FACTORY_VIEWS = [
  "paused",
  "owner",
  "pendingOwner",
  "defaultFeeBps",
  "feeRecipient",
  "minFeeAmount",
  "minFeePerReceiver",
  "maxFeeAmount",
] as const;
const OLD_FACTORY_VIEWS = ["paused", "owner"] as const;
const REGISTRY_VIEWS = ["binder", "revoked", "guardian", "owner"] as const;
/** `BinderRegistryV2` is `Ownable2Step`, so it has a `pendingOwner` too. */
const REGISTRY_V2_VIEWS = [...REGISTRY_VIEWS, "pendingOwner"] as const;

/** What alert 3 reads on a Robinhood chain. */
export interface EvmAdminTargets {
  readonly factory: string;
  readonly oldFactory: string | null;
  readonly registry: string | null;
  readonly registryV2?: string | null;
  /** `DropFactoryV6` and `DropFactoryV7` have `pauseGuardian` item P; older ones do not. */
  readonly pauseGuardian?: boolean;
  readonly relayer: string;
}

/**
 * The factory new drops are made on, the one before it (unpausing it
 * would open it again), the `BinderRegistry` while recorded and `BinderRegistryV2` once V6.
 * V7 on top of V6 makes V6 the one before it.
 */
export function evmAdminTargets(chain: ServedEvmChain, relayer: string): EvmAdminTargets {
  const c = chain.contracts;
  const factories = [
    c.factoryV7,
    c.factoryV6,
    c.factoryV5,
    c.factoryV4,
    c.factoryV3,
    c.factoryV2,
    c.factory,
  ]
    .filter((f): f is string => f !== null)
    .map((f) => getAddress(f));
  const picked = evmFactoryFor(chain);
  const older = factories.slice(factories.indexOf(picked.factory) + 1);
  return {
    factory: picked.factory,
    oldFactory: older[0] ?? null,
    registry: c.binderRegistry === null ? null : getAddress(c.binderRegistry),
    registryV2: c.binderRegistryV2 === null ? null : getAddress(c.binderRegistryV2),
    pauseGuardian: picked.version >= 6,
    relayer,
  };
}

/**
 * The Robinhood admin state: the live factory, the old factory (unpausing it would open it again)
 * and the `BinderRegistry`. One failed read fails the whole read, so nothing changes.
 */
export async function evmAdminFields(
  client: ViewReader,
  targets: EvmAdminTargets,
): Promise<Record<string, string>> {
  const read = async (address: string, functionName: string, args?: readonly unknown[]) =>
    String(
      await client.readContract({
        address: address as `0x${string}`,
        abi: ADMIN_ABI,
        functionName,
        ...(args === undefined ? {} : { args }),
      }),
    );
  const fields: Record<string, string> = {};
  for (const name of FACTORY_VIEWS) fields[`factory.${name}`] = await read(targets.factory, name);
  fields["factory.allowedCreator"] = await read(targets.factory, "allowedCreator", [
    targets.relayer,
  ]);
  if (targets.pauseGuardian === true) {
    fields["factory.pauseGuardian"] = await read(targets.factory, "pauseGuardian");
  }
  if (targets.oldFactory !== null) {
    for (const name of OLD_FACTORY_VIEWS) {
      fields[`oldFactory.${name}`] = await read(targets.oldFactory, name);
    }
  }
  if (targets.registry !== null) {
    for (const name of REGISTRY_VIEWS) {
      fields[`registry.${name}`] = await read(targets.registry, name);
    }
  }
  const registryV2 = targets.registryV2 ?? null;
  if (registryV2 !== null) {
    for (const name of REGISTRY_V2_VIEWS) {
      fields[`registryV2.${name}`] = await read(registryV2, name);
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// The live test by hand
// ---------------------------------------------------------------------------

/**
 * One `TEST` message of each text, through the same send and the same chat. No database: the
 * script runs next to the live api, and a second process on its PGlite folder would break it.
 * Each answer is `null` when sent, else a status, never the url.
 */
export async function sendSampleAlerts(
  deps: { readonly fetch: typeof fetch; readonly token: string; readonly chatId: string },
  fast: FastWatch | null,
  chainKey: string | null,
  ethChainKey: string | null = null,
): Promise<(string | null)[]> {
  const watch = fast ?? {
    chainKey: chainKey ?? "solana-devnet",
    address: "the relayer",
    symbol: "SOL",
    decimals: 9,
    drop: 0n,
    minutes: 60,
  };
  const chain = chainKey ?? watch.chainKey;
  const texts = [
    fastMessage(watch, watch.drop + 1n, 1_000_000_000n),
    claimsMessage(chain, 51, 10),
    adminMessage(chain, [{ field: "paused", old: "false", new: "true" }]),
    apiErrorsMessage(21, 5),
    ethWaitingMessage(ethChainKey ?? "robinhood-testnet", {
      drop: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      amount: "50000000000000000",
    }),
  ];
  const results: (string | null)[] = [];
  for (const text of texts) results.push(await sendPrivateAlert(deps, asTestAlert(text)));
  return results;
}

// ---------------------------------------------------------------------------
// The alerts
// ---------------------------------------------------------------------------

export interface AdminWatch {
  readonly chainKey: string;
  readonly read: () => Promise<Record<string, string>>;
}

/** Alert 6: the rows not swept, from the indexer of this chain. */
export interface EthWaitingWatch {
  readonly chainKey: string;
  readonly read: () => Promise<readonly EthWaitingRow[]>;
}

export type AlertResult = "sent" | "quiet" | "repeat" | "send-failed";

export interface OwnerAlertDeps {
  readonly db: Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly token: string;
  readonly chatId: string;
  readonly log: (line: string) => void;
  readonly repeatMinutes: number;
  readonly fast: readonly FastWatch[];
  readonly claims: readonly { chainKey: string; count: number; minutes: number }[];
  readonly admin: readonly AdminWatch[];
  /** `null` is not watched: nothing is counted. */
  readonly apiErrors: { count: number; minutes: number } | null;
  /** How often alert 3 reads. Only `start` uses it. */
  readonly adminMinutes?: number;
  /** Alert 6. `null` or absent is not watched: no indexer. */
  readonly ethWaiting?: EthWaitingWatch | null;
}

export interface OwnerAlerts {
  /** Alert 1: keep one balance read. The relayer alert calls this after every read. */
  recordBalance(chainKey: string, balance: bigint): Promise<void>;
  checkFast(): Promise<{ key: string; result: AlertResult }[]>;
  checkClaims(): Promise<{ key: string; result: AlertResult }[]>;
  /** Only the changed fields have a result; the first read and no change give none. */
  checkAdmin(): Promise<{ key: string; result: AlertResult }[]>;
  /** Alert 5: one unhandled error, now. Never its message. */
  countApiError(): void;
  checkApiErrors(): Promise<{ key: string; result: AlertResult }[]>;
  /** Alert 6: once per drop, ever. A failed indexer read gives no result. */
  checkEthWaiting(): Promise<{ key: string; result: AlertResult }[]>;
  /** The live test by hand: one `TEST` message of each text. Writes nothing to `alerts_sent`. */
  sendSamples(): Promise<(string | null)[]>;
  start(): Promise<void>;
  stop(): void;
}

export function createOwnerAlerts(deps: OwnerAlertDeps): OwnerAlerts {
  const { db } = deps;
  const repeatMs = deps.repeatMinutes * MINUTE_MS;
  let errors: number[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const busy = new Set<string>();

  const send = (text: string) => sendPrivateAlert(deps, text);

  async function everSent(key: string): Promise<boolean> {
    const [row] = await db
      .select({ sentAt: alertsSent.sentAt })
      .from(alertsSent)
      .where(eq(alertsSent.key, key));
    return row !== undefined;
  }

  async function recentlySent(key: string, now: Date): Promise<boolean> {
    const [row] = await db
      .select({ sentAt: alertsSent.sentAt })
      .from(alertsSent)
      .where(eq(alertsSent.key, key));
    return row !== undefined && now.getTime() - row.sentAt.getTime() < repeatMs;
  }

  async function markSent(keys: readonly string[], now: Date): Promise<void> {
    for (const key of keys) {
      await db
        .insert(alertsSent)
        .values({ key, sentAt: now })
        .onConflictDoUpdate({ target: alertsSent.key, set: { sentAt: now } });
    }
  }

  /** One alert: the repeat rule, the send, `sent_at` only after ok. */
  async function deliver(key: string, text: string): Promise<AlertResult> {
    const now = deps.now();
    if (await recentlySent(key, now)) return "repeat";
    const failed = await send(text);
    if (failed !== null) {
      deps.log(`owner alert ${key}: not sent, ${failed}`);
      return "send-failed";
    }
    await markSent([key], now);
    deps.log(`owner alert ${key}: sent`);
    return "sent";
  }

  async function recordBalance(chainKey: string, balance: bigint): Promise<void> {
    const now = deps.now();
    await db
      .insert(relayerBalanceSamples)
      .values({ chainKey, readAt: now, balance: balance.toString() })
      .onConflictDoUpdate({
        target: [relayerBalanceSamples.chainKey, relayerBalanceSamples.readAt],
        set: { balance: balance.toString() },
      });
    await db
      .delete(relayerBalanceSamples)
      .where(lt(relayerBalanceSamples.readAt, new Date(now.getTime() - SAMPLES_KEPT_MS)));
  }

  async function checkFast() {
    const results: { key: string; result: AlertResult }[] = [];
    for (const watch of deps.fast) {
      const key = `relayer_fast:${watch.chainKey}`;
      const since = new Date(deps.now().getTime() - watch.minutes * MINUTE_MS);
      const inWindow = and(
        eq(relayerBalanceSamples.chainKey, watch.chainKey),
        gte(relayerBalanceSamples.readAt, since),
      );
      const [latest] = await db
        .select({ balance: relayerBalanceSamples.balance })
        .from(relayerBalanceSamples)
        .where(inWindow)
        .orderBy(desc(relayerBalanceSamples.readAt))
        .limit(1);
      const [highest] = await db
        .select({ balance: sql<string | null>`max(${relayerBalanceSamples.balance})` })
        .from(relayerBalanceSamples)
        .where(inWindow);
      if (latest === undefined || highest?.balance == null) {
        results.push({ key, result: "quiet" });
        continue;
      }
      const now = BigInt(latest.balance);
      const down = BigInt(highest.balance) - now;
      if (down <= watch.drop) {
        results.push({ key, result: "quiet" });
        continue;
      }
      results.push({ key, result: await deliver(key, fastMessage(watch, down, now)) });
    }
    return results;
  }

  async function checkClaims() {
    const results: { key: string; result: AlertResult }[] = [];
    for (const watch of deps.claims) {
      const key = `claims:${watch.chainKey}`;
      const since = new Date(deps.now().getTime() - watch.minutes * MINUTE_MS);
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(relayerTxs)
        .where(
          and(
            eq(relayerTxs.chainKey, watch.chainKey),
            inArray(relayerTxs.kind, CLAIM_KINDS),
            gte(relayerTxs.createdAt, since),
          ),
        );
      const count = row?.count ?? 0;
      if (count <= watch.count) {
        results.push({ key, result: "quiet" });
        continue;
      }
      results.push({
        key,
        result: await deliver(key, claimsMessage(watch.chainKey, count, watch.minutes)),
      });
    }
    return results;
  }

  async function checkAdminOne(watch: AdminWatch) {
    let fields: Record<string, string>;
    try {
      fields = await watch.read();
    } catch {
      deps.log(`owner alert admin ${watch.chainKey}: not readable, next check later`);
      return [];
    }
    const now = deps.now();
    const rows = await db
      .select()
      .from(adminSnapshots)
      .where(eq(adminSnapshots.chainKey, watch.chainKey));
    const before = new Map(rows.map((r) => [r.field, r.value]));
    const store = async (field: string, value: string) => {
      await db
        .insert(adminSnapshots)
        .values({ chainKey: watch.chainKey, field, value, readAt: now })
        .onConflictDoUpdate({
          target: [adminSnapshots.chainKey, adminSnapshots.field],
          set: { value, readAt: now },
        });
    };

    const changes: (AdminChange & { key: string })[] = [];
    for (const [field, value] of Object.entries(fields)) {
      const old = before.get(field);
      // A field seen for the first time is only stored, as on the first read.
      if (old === undefined) await store(field, value);
      else if (old !== value) {
        changes.push({ field, old, new: value, key: `admin:${watch.chainKey}:${field}:${value}` });
      }
    }
    if (changes.length === 0) return [];

    const results: { key: string; result: AlertResult }[] = [];
    const toSend: typeof changes = [];
    for (const change of changes) {
      if (await recentlySent(change.key, now)) results.push({ key: change.key, result: "repeat" });
      else toSend.push(change);
    }
    if (toSend.length > 0) {
      const failed = await send(adminMessage(watch.chainKey, toSend));
      if (failed !== null) {
        deps.log(`owner alert admin ${watch.chainKey}: not sent, ${failed}`);
        // The snapshot stays as it was, so the next check sends these again.
        for (const c of toSend) results.push({ key: c.key, result: "send-failed" });
        for (const c of changes.filter((c) => !toSend.includes(c))) await store(c.field, c.new);
        return order(changes, results);
      }
      await markSent(
        toSend.map((c) => c.key),
        now,
      );
      deps.log(`owner alert admin ${watch.chainKey}: ${String(toSend.length)} changes sent`);
      for (const c of toSend) results.push({ key: c.key, result: "sent" });
    }
    for (const c of changes) await store(c.field, c.new);
    return order(changes, results);
  }

  /** The results in the order of the fields read. */
  function order(
    changes: readonly { key: string }[],
    results: { key: string; result: AlertResult }[],
  ) {
    return changes.map(
      (c) => results.find((r) => r.key === c.key) ?? { key: c.key, result: "quiet" as const },
    );
  }

  async function checkAdmin() {
    const results: { key: string; result: AlertResult }[] = [];
    for (const watch of deps.admin) results.push(...(await checkAdminOne(watch)));
    return results;
  }

  function countApiError() {
    if (deps.apiErrors === null) return;
    errors.push(deps.now().getTime());
  }

  async function checkApiErrors() {
    if (deps.apiErrors === null) return [];
    const { count, minutes } = deps.apiErrors;
    const since = deps.now().getTime() - minutes * MINUTE_MS;
    errors = errors.filter((at) => at >= since);
    const key = "api_errors";
    if (errors.length <= count) return [{ key, result: "quiet" as const }];
    return [{ key, result: await deliver(key, apiErrorsMessage(errors.length, minutes)) }];
  }

  /** Alert 6: no 30 minute repeat. A key once sent is never sent again. */
  async function checkEthWaiting() {
    const watch = deps.ethWaiting ?? null;
    if (watch === null) return [];
    let rows: readonly EthWaitingRow[];
    try {
      rows = await watch.read();
    } catch {
      deps.log(`owner alert eth_waiting ${watch.chainKey}: indexer not readable, next check later`);
      return [];
    }
    const results: { key: string; result: AlertResult }[] = [];
    for (const row of rows) {
      const key = `eth_waiting:${watch.chainKey}:${row.drop.toLowerCase()}`;
      if (await everSent(key)) {
        results.push({ key, result: "repeat" });
        continue;
      }
      results.push({ key, result: await deliver(key, ethWaitingMessage(watch.chainKey, row)) });
    }
    return results;
  }

  const sendSamples = () =>
    sendSampleAlerts(
      deps,
      deps.fast[0] ?? null,
      deps.claims[0]?.chainKey ?? null,
      deps.ethWaiting?.chainKey ?? null,
    );

  /** One run of a check at a time, per check. A failed run waits for the next one. */
  async function guarded(run: () => Promise<unknown>, name: string) {
    if (busy.has(name)) return;
    busy.add(name);
    try {
      await run();
    } catch (error) {
      deps.log(`owner alert ${name} error: ${error instanceof Error ? error.name : "unknown"}`);
    } finally {
      busy.delete(name);
    }
  }

  return {
    recordBalance,
    checkFast,
    checkClaims,
    checkAdmin,
    countApiError,
    checkApiErrors,
    checkEthWaiting,
    sendSamples,
    async start() {
      await guarded(checkAdmin, "admin");
      const every = (ms: number, run: () => Promise<unknown>, name: string) => {
        const timer = setInterval(() => void guarded(run, name), ms);
        timer.unref();
        timers.push(timer);
      };
      every((deps.adminMinutes ?? DEFAULTS.adminMinutes) * MINUTE_MS, checkAdmin, "admin");
      every(
        CHECK_EVERY_MS,
        async () => {
          await checkClaims();
          await checkApiErrors();
        },
        "claims",
      );
      every(CHECK_EVERY_MS, checkEthWaiting, "eth_waiting");
    },
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
