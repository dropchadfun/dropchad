/**
 * The Telegram sender.
 *
 * Its own loop, never the drop job worker: the worker runs one job at a time, so a slow Telegram
 * would slow payouts, and a job that fails writes `drops.last_error`, which the drop page shows.
 * Here a Telegram outage touches nothing but this table.
 *
 * **At most once.** A row is `sending` before the call. A restart that finds one marks it
 * `failed`, never sends it again. A retry happens only when nothing was posted: a `429`, or a
 * connection that never opened. Any other answer, a timeout or a reset is final: a missing post
 * is better than a double one.
 *
 * **The token is in the url.** No line here ever holds the url; errors keep a status only.
 */
import { findChain } from "@dropchad/chains";
import { and, asc, eq, lte } from "drizzle-orm";

import { canonicalAddress } from "../chain/address.js";
import type { Database } from "../db/client.js";
import { drops, profiles, telegramPosts } from "../db/schema.js";
import { tokenInfoOf } from "../drops/token-info.js";
import { buildTelegramPost, type TelegramPostFacts } from "./post.js";

/** The one host, fixed. */
const TELEGRAM_API = "https://api.telegram.org";
/** At least this long between two posts. */
export const POST_GAP_MS = 3_000;
/** No answer in this long is final: it may have posted. */
export const POST_TIMEOUT_MS = 10_000;
export const MAX_TRIES = 8;
/** Not sent within this long of going live: skipped, late news is noise. */
export const POST_MAX_AGE_MS = 60 * 60_000;
/** How often the loop looks for a post that is due. */
const LOOP_MS = 1_000;

/** A connection that never opened: nothing reached Telegram, so a retry cannot double post. */
const NEVER_CONNECTED = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** 30 s, 1, 2, 4, 8 minutes, then 10. */
export function telegramBackoffMs(tries: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, tries - 1), 10 * 60_000);
}

export type TelegramTick = "idle" | "waiting" | "sent" | "retry" | "failed" | "skipped";

export interface TelegramSenderDeps {
  readonly db: Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly token: string;
  readonly channelId: string;
  /** `SHARE_BASE_URL`, where the drop page link goes. */
  readonly siteUrl: string;
  readonly log: (line: string) => void;
}

export interface TelegramSender {
  /** A `sending` row left by a restart becomes `failed`. Returns how many. */
  recover(): Promise<number>;
  /** Look at the next due post, at most one call to Telegram. Tests drive this directly. */
  tick(): Promise<TelegramTick>;
  start(): Promise<void>;
  stop(): void;
}

/** Queue the post of a drop that just went live. A second call for the same drop does nothing. */
export async function enqueueTelegramPost(db: Database, dropAddress: string, now: Date) {
  await db
    .insert(telegramPosts)
    .values({ dropAddress: canonicalAddress(dropAddress), runAfter: now, createdAt: now })
    .onConflictDoNothing();
}

function codeOf(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export function createTelegramSender(deps: TelegramSenderDeps): TelegramSender {
  const { db } = deps;
  /** No call before this: the gap after a post, or Telegram's `retry_after`. */
  let notBefore = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function setRow(address: string, values: Partial<typeof telegramPosts.$inferInsert>) {
    await db.update(telegramPosts).set(values).where(eq(telegramPosts.dropAddress, address));
  }

  /** The facts at send time: the handle and the title as they are now. `null`: never post. */
  async function factsOf(address: string): Promise<TelegramPostFacts | null> {
    const [row] = await db.select().from(drops).where(eq(drops.address, address));
    if (row?.mode !== "handle") return null;
    const [sender] = await db
      .select({ handle: profiles.handle })
      .from(profiles)
      .where(eq(profiles.xUserId, row.xUserId));
    const chain = findChain(row.chainKey);
    if (sender === undefined || chain === undefined) return null;
    const token = tokenInfoOf(row);
    return {
      dropAddress: row.address,
      chainKey: row.chainKey,
      senderHandle: sender.handle,
      amount: row.totalEntitlements,
      decimals: token?.decimals ?? (chain.family === "svm" ? 9 : 18),
      coinSymbol: chain.nativeSymbol,
      receivers: row.leafCount,
      title: row.title,
      token:
        token === null ? null : { address: token.mint, name: token.name, symbol: token.symbol },
    };
  }

  async function finish(address: string, tries: number, error: string): Promise<"failed"> {
    deps.log(`telegram post for ${address} failed: ${error}`);
    await setRow(address, { state: "failed", attempts: tries, lastError: error });
    return "failed";
  }

  /** Nothing was posted: try again later, or give up after the last try. */
  async function again(
    address: string,
    tries: number,
    error: string,
    waitMs: number,
  ): Promise<"retry" | "failed"> {
    if (tries >= MAX_TRIES) return finish(address, tries, error);
    const now = deps.now();
    deps.log(`telegram post for ${address}: ${error}, try ${String(tries + 1)} later`);
    await setRow(address, {
      state: "ready",
      attempts: tries,
      lastError: error,
      runAfter: new Date(now.getTime() + waitMs),
    });
    return "retry";
  }

  async function tick(): Promise<TelegramTick> {
    const now = deps.now();
    if (now.getTime() < notBefore) return "waiting";

    const [due] = await db
      .select()
      .from(telegramPosts)
      .where(and(eq(telegramPosts.state, "ready"), lte(telegramPosts.runAfter, now)))
      .orderBy(asc(telegramPosts.runAfter), asc(telegramPosts.createdAt))
      .limit(1);
    if (due === undefined) return "idle";
    const address = due.dropAddress;

    if (now.getTime() - due.createdAt.getTime() > POST_MAX_AGE_MS) {
      await setRow(address, { state: "skipped", lastError: "older than 1 hour" });
      return "skipped";
    }
    const facts = await factsOf(address);
    if (facts === null) {
      await setRow(address, { state: "skipped", lastError: "not a handle drop" });
      return "skipped";
    }

    // Marked before the call, and only if still ready: a second loop cannot take it too.
    const tries = due.attempts + 1;
    const taken = await db
      .update(telegramPosts)
      .set({ state: "sending", attempts: tries })
      .where(and(eq(telegramPosts.dropAddress, address), eq(telegramPosts.state, "ready")))
      .returning({ dropAddress: telegramPosts.dropAddress });
    if (taken.length === 0) return "idle";
    notBefore = now.getTime() + POST_GAP_MS;

    let response: Response;
    try {
      response = await deps.fetch(`${TELEGRAM_API}/bot${deps.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: deps.channelId,
          text: buildTelegramPost(facts, deps.siteUrl),
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
    } catch (error) {
      if (isTimeout(error)) return finish(address, tries, "timeout, maybe posted");
      const code = codeOf(error);
      if (code !== null && NEVER_CONNECTED.has(code)) {
        return again(address, tries, `network ${code}`, telegramBackoffMs(tries));
      }
      return finish(address, tries, `network ${code ?? "error"}, maybe posted`);
    }

    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      result?: { message_id?: unknown };
      parameters?: { retry_after?: unknown };
    } | null;

    if (response.status === 429) {
      const after = Number(body?.parameters?.retry_after);
      const waitMs = (Number.isFinite(after) && after > 0 ? after : 30) * 1000;
      notBefore = now.getTime() + waitMs;
      return again(address, tries, "http 429", waitMs);
    }
    if (!response.ok || body?.ok !== true)
      return finish(address, tries, `http ${String(response.status)}`);

    const messageId = Number(body.result?.message_id);
    await setRow(address, {
      state: "sent",
      attempts: tries,
      lastError: null,
      messageId: Number.isSafeInteger(messageId) ? messageId : null,
      sentAt: now,
    });
    return "sent";
  }

  async function recover(): Promise<number> {
    const rows = await db
      .update(telegramPosts)
      .set({ state: "failed", lastError: "unknown, maybe posted" })
      .where(eq(telegramPosts.state, "sending"))
      .returning({ dropAddress: telegramPosts.dropAddress });
    return rows.length;
  }

  return {
    recover,
    tick,
    async start() {
      const lost = await recover();
      if (lost > 0) deps.log(`telegram posts: ${String(lost)} left in sending, not sent again`);
      timer = setInterval(() => {
        if (busy) return;
        busy = true;
        tick()
          .catch((error: unknown) =>
            deps.log(`telegram loop error: ${error instanceof Error ? error.name : "unknown"}`),
          )
          .finally(() => {
            busy = false;
          });
      }, LOOP_MS);
      timer.unref();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
