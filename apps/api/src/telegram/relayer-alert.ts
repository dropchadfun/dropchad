/**
 * The relayer low balance alert.
 *
 * A private Telegram message to the owner when a relayer's coin runs low, and one when it is
 * topped up again. Never the drops channel: the chat id must be a positive number (a private
 * chat) and not the channel id, or the alert stays off.
 *
 * **Read only.** One balance read per relayer, never a transaction, no key.
 *
 * **Once until topped up.** The state is in `relayer_alerts`, so a restart does not warn again. It
 * changes only after Telegram answers ok: a failed send is tried again at the next check. Here a
 * double message is better than none, the opposite of the channel posts.
 *
 * **The token is in the url.** No line here ever holds the url or an error's message.
 */
import { findChain } from "@dropchad/chains";
import { eq } from "drizzle-orm";

import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import { relayerAlerts } from "../db/schema.js";
import { chainName, exactAmount } from "./post.js";

/** The one host, fixed. */
const TELEGRAM_API = "https://api.telegram.org";
export const CHECK_EVERY_MS = 10 * 60_000;
export const ALERT_TIMEOUT_MS = 10_000;
/** A private chat id: a positive whole number. A channel is `@name` or `-100…`, a group negative. */
const PRIVATE_CHAT_ID = /^[1-9][0-9]{0,15}$/;
/** The testnet limits, about 2 days of the daily caps. Never on a mainnet. */
const TESTNET_MIN_LAMPORTS = 800_000_000n;
const TESTNET_MIN_WEI = 1_000_000_000_000_000n;

export type RelayerAlertSettings =
  | { readonly on: true; readonly token: string; readonly chatId: string }
  | { readonly on: false; readonly reason: string };

/** The switch. The reason never holds a value. */
export function relayerAlertSettings(
  config: Pick<
    Config,
    "RELAYER_ALERT" | "TELEGRAM_BOT_TOKEN" | "RELAYER_ALERT_CHAT_ID" | "TELEGRAM_CHANNEL_ID"
  >,
): RelayerAlertSettings {
  if (config.RELAYER_ALERT !== "on") return { on: false, reason: "RELAYER_ALERT is off" };
  const token = config.TELEGRAM_BOT_TOKEN ?? "";
  const chatId = config.RELAYER_ALERT_CHAT_ID ?? "";
  if (token.length === 0 || chatId.length === 0) {
    return { on: false, reason: "TELEGRAM_BOT_TOKEN or RELAYER_ALERT_CHAT_ID is empty" };
  }
  if (!PRIVATE_CHAT_ID.test(chatId)) {
    return { on: false, reason: "RELAYER_ALERT_CHAT_ID is not a private chat id" };
  }
  if (chatId === (config.TELEGRAM_CHANNEL_ID ?? "").trim()) {
    return { on: false, reason: "RELAYER_ALERT_CHAT_ID is the channel" };
  }
  return { on: true, token, chatId };
}

export interface WatchedRelayer {
  readonly chainKey: string;
  readonly address: string;
  /** Base units: lamports or wei. Below this is low. */
  readonly limit: bigint;
  readonly symbol: string;
  readonly decimals: number;
}

export interface WatchInput {
  readonly CHAIN_KEY: string;
  readonly SOLANA_CHAIN_KEY: string;
  readonly RELAYER_ADDRESS?: string | undefined;
  readonly SOLANA_RELAYER_ADDRESS?: string | undefined;
  readonly RELAYER_ALERT_MIN_LAMPORTS?: string | undefined;
  readonly RELAYER_ALERT_MIN_WEI?: string | undefined;
}

/**
 * Which relayers are watched, and why the others are not. The EVM relayer first, then Solana. On
 * a mainnet chain the testnet default does not count: no limit by hand, not watched.
 */
export function watchedRelayers(input: WatchInput): {
  watched: WatchedRelayer[];
  notWatched: { chainKey: string; reason: string }[];
} {
  const watched: WatchedRelayer[] = [];
  const notWatched: { chainKey: string; reason: string }[] = [];
  const sides = [
    {
      chainKey: input.CHAIN_KEY,
      address: input.RELAYER_ADDRESS,
      byHand: input.RELAYER_ALERT_MIN_WEI,
      testnet: TESTNET_MIN_WEI,
      decimals: 18,
    },
    {
      chainKey: input.SOLANA_CHAIN_KEY,
      address: input.SOLANA_RELAYER_ADDRESS,
      byHand: input.RELAYER_ALERT_MIN_LAMPORTS,
      testnet: TESTNET_MIN_LAMPORTS,
      decimals: 9,
    },
  ];
  for (const side of sides) {
    const chain = findChain(side.chainKey);
    if (chain === undefined) {
      notWatched.push({ chainKey: side.chainKey, reason: "unknown chain" });
      continue;
    }
    if (side.address === undefined || side.address === "") {
      notWatched.push({ chainKey: side.chainKey, reason: "no relayer address" });
      continue;
    }
    const byHand = side.byHand === undefined || side.byHand === "" ? null : BigInt(side.byHand);
    if (byHand === null && chain.kind === "mainnet") {
      notWatched.push({ chainKey: side.chainKey, reason: "no limit set on a mainnet" });
      continue;
    }
    watched.push({
      chainKey: side.chainKey,
      address: side.address,
      limit: byHand ?? side.testnet,
      symbol: chain.nativeSymbol,
      decimals: side.decimals,
    });
  }
  return { watched, notWatched };
}

type Facts = Pick<WatchedRelayer, "chainKey" | "address" | "limit" | "symbol" | "decimals">;

export function lowMessage(relayer: Facts, balance: bigint): string {
  const amount = (value: bigint) =>
    `${exactAmount(value.toString(), relayer.decimals)} ${relayer.symbol}`;
  return [
    `relayer low: ${chainName(relayer.chainKey)}`,
    relayer.address,
    `balance ${amount(balance)}, limit ${amount(relayer.limit)}`,
    "top up the relayer.",
  ].join("\n");
}

export function okMessage(relayer: Facts, balance: bigint): string {
  return [
    `relayer ok again: ${chainName(relayer.chainKey)}`,
    `balance ${exactAmount(balance.toString(), relayer.decimals)} ${relayer.symbol}`,
  ].join("\n");
}

export type RelayerCheckResult =
  "ok" | "low" | "sent-low" | "sent-ok" | "send-failed" | "read-failed";

export interface AlertRelayer extends WatchedRelayer {
  readonly readBalance: () => Promise<bigint>;
}

export interface RelayerAlertDeps {
  readonly db: Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly token: string;
  readonly chatId: string;
  readonly relayers: readonly AlertRelayer[];
  readonly log: (line: string) => void;
}

export interface RelayerAlert {
  /** Read every relayer once, at most one message each. Tests drive this directly. */
  check(): Promise<{ chainKey: string; result: RelayerCheckResult }[]>;
  /** One check at once, then every 10 minutes. */
  start(): Promise<void>;
  stop(): void;
}

function codeOf(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

export function createRelayerAlert(deps: RelayerAlertDeps): RelayerAlert {
  const { db } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  /** `null` when sent; otherwise a status for the log, never a url. */
  async function send(text: string): Promise<string | null> {
    let response: Response;
    try {
      response = await deps.fetch(`${TELEGRAM_API}/bot${deps.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: deps.chatId,
          text,
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") return "timeout";
      return `network ${codeOf(error) ?? "error"}`;
    }
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    if (!response.ok || body?.ok !== true) return `http ${String(response.status)}`;
    return null;
  }

  async function stateOf(chainKey: string): Promise<"ok" | "low"> {
    const [row] = await db
      .select({ state: relayerAlerts.state })
      .from(relayerAlerts)
      .where(eq(relayerAlerts.chainKey, chainKey));
    return row?.state === "low" ? "low" : "ok";
  }

  async function setState(chainKey: string, state: "ok" | "low") {
    const changedAt = deps.now();
    await db
      .insert(relayerAlerts)
      .values({ chainKey, state, changedAt })
      .onConflictDoUpdate({ target: relayerAlerts.chainKey, set: { state, changedAt } });
  }

  async function checkOne(relayer: AlertRelayer): Promise<RelayerCheckResult> {
    let balance: bigint;
    try {
      balance = await relayer.readBalance();
    } catch {
      deps.log(`relayer alert ${relayer.chainKey}: balance not readable, next check later`);
      return "read-failed";
    }
    const state = await stateOf(relayer.chainKey);
    if (state === "ok") {
      if (balance >= relayer.limit) return "ok";
      const failed = await send(lowMessage(relayer, balance));
      if (failed !== null) {
        deps.log(`relayer alert ${relayer.chainKey}: low message not sent, ${failed}`);
        return "send-failed";
      }
      await setState(relayer.chainKey, "low");
      deps.log(`relayer alert ${relayer.chainKey}: low, message sent`);
      return "sent-low";
    }
    // Low: ok again only at the limit times 1.2, so a balance near the limit does not flap.
    if (balance * 5n < relayer.limit * 6n) return "low";
    const failed = await send(okMessage(relayer, balance));
    if (failed !== null) {
      deps.log(`relayer alert ${relayer.chainKey}: ok message not sent, ${failed}`);
      return "send-failed";
    }
    await setState(relayer.chainKey, "ok");
    deps.log(`relayer alert ${relayer.chainKey}: ok again, message sent`);
    return "sent-ok";
  }

  async function check() {
    const results: { chainKey: string; result: RelayerCheckResult }[] = [];
    for (const relayer of deps.relayers) {
      results.push({ chainKey: relayer.chainKey, result: await checkOne(relayer) });
    }
    return results;
  }

  async function guarded() {
    if (busy) return;
    busy = true;
    try {
      await check();
    } catch (error) {
      deps.log(`relayer alert loop error: ${error instanceof Error ? error.name : "unknown"}`);
    } finally {
      busy = false;
    }
  }

  return {
    check,
    async start() {
      await guarded();
      timer = setInterval(() => void guarded(), CHECK_EVERY_MS);
      timer.unref();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
