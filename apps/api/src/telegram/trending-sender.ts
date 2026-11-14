/**
 * The pinned trending post loop "The Telegram trending
 * post".
 *
 * Its own loop, never the drop job worker. One check at start, then every 5 minutes, at most one
 * call to Telegram per check. The message is posted once and then only edited, and only when its
 * text changed. The bot never pins: an admin pins by hand.
 *
 * **A missing post is better than a second one.** A new post only when the row has no message
 * id: the first post, or an edit that said the message is gone. At most one `sendMessage` try in
 * 24 hours; `posted_at` is written before the call, so a try with no answer, or a restart in the
 * middle, counts. A `429` or a connection that never opened is not a try.
 *
 * **The token is in the url.** No line here ever holds the url or the token. The row keeps a
 * status only; the log adds Telegram's error words, cleaned.
 */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import type { TrendingCards } from "../boards/trending.js";
import { isMainnetSite, type ConfiguredChains } from "../chain/filter.js";
import type { Database } from "../db/client.js";
import { telegramTrending } from "../db/schema.js";
import { codeOf, isTimeout, NEVER_CONNECTED } from "./sender.js";
import { buildTrendingPost, trendingButton, type TrendingNetwork } from "./trending-post.js";

/** The one host, fixed. */
const TELEGRAM_API = "https://api.telegram.org";
/** How often the cards are read. */
export const TRENDING_CHECK_MS = 5 * 60_000;
/** At most one `sendMessage` try in this long. */
export const REPOST_GAP_MS = 24 * 60 * 60_000;
export const TRENDING_TIMEOUT_MS = 10_000;

/** Sent to the owner after a new post. */
export const TRENDING_PIN_ALERT = "🤌 TRENDING POST NEW, pin it in the channel by hand.";

/** Telegram's answers to an edit, matched only, never stored. */
const NOT_MODIFIED = /message is not modified/i;
/** `MESSAGE_ID_INVALID`: the answer to an edit of a deleted channel post. */
const NOT_FOUND = /message to edit not found|MESSAGE_ID_INVALID/i;

/** At most this many characters of Telegram's words in a log line. */
const WORDS_MAX = 200;
const ANY_BOT_TOKEN = /bot\d+:[A-Za-z0-9_-]+/g;

/** Telegram's error words for the log: printable, one line, no token, cut at 200. */
function cleanWords(words: string, token: string): string {
  let clean = words.replace(/[^\x20-\x7E]+/g, " ");
  if (token !== "") clean = clean.split(token).join("***");
  return clean.replace(ANY_BOT_TOKEN, "***").replace(/ +/g, " ").trim().slice(0, WORDS_MAX);
}

export type TrendingCheck =
  "posted" | "edited" | "same" | "gone" | "unavailable" | "waiting" | "failed";

/** `mainnet` on a mainnet site. */
export function trendingNetwork(config: ConfiguredChains): TrendingNetwork {
  return isMainnetSite(config) ? "mainnet" : "testnet";
}

export interface TrendingPosterDeps {
  readonly db: Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly token: string;
  readonly channelId: string;
  /** `SHARE_BASE_URL`, the button's link. */
  readonly siteUrl: string;
  readonly network: TrendingNetwork;
  /** The cards, or `null` when they cannot be read honestly: no call then. */
  readonly read: () => Promise<TrendingCards | null>;
  /** The private alert, or `null` when it is off. The answer is a status or `null`. */
  readonly alert: ((text: string) => Promise<string | null>) | null;
  readonly log: (line: string) => void;
}

export interface TrendingPoster {
  /** One check, at most one call to Telegram. Tests drive this directly. */
  check(): Promise<TrendingCheck>;
  start(): void;
  stop(): void;
}

type Answer =
  | { readonly kind: "ok"; readonly messageId: number | null }
  | { readonly kind: "error"; readonly status: number; readonly description: string }
  | { readonly kind: "rate"; readonly waitMs: number }
  | { readonly kind: "timeout" }
  | { readonly kind: "network"; readonly code: string | null; readonly connected: boolean };

export function createTrendingPoster(deps: TrendingPosterDeps): TrendingPoster {
  const { db, network } = deps;
  /** No call before this: Telegram's `retry_after`. */
  let notBefore = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function setRow(values: Partial<typeof telegramTrending.$inferInsert>) {
    await db.update(telegramTrending).set(values).where(eq(telegramTrending.network, network));
  }

  async function call(method: string, body: Record<string, unknown>): Promise<Answer> {
    let response: Response;
    try {
      response = await deps.fetch(`${TELEGRAM_API}/bot${deps.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: deps.channelId,
          ...body,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: trendingButton(deps.siteUrl),
        }),
        signal: AbortSignal.timeout(TRENDING_TIMEOUT_MS),
      });
    } catch (error) {
      if (isTimeout(error)) return { kind: "timeout" };
      const code = codeOf(error);
      return { kind: "network", code, connected: code === null || !NEVER_CONNECTED.has(code) };
    }
    const json = (await response.json().catch(() => null)) as {
      ok?: unknown;
      description?: unknown;
      result?: { message_id?: unknown };
      parameters?: { retry_after?: unknown };
    } | null;
    if (response.status === 429) {
      const after = Number(json?.parameters?.retry_after);
      return { kind: "rate", waitMs: (Number.isFinite(after) && after > 0 ? after : 30) * 1000 };
    }
    if (!response.ok || json?.ok !== true) {
      const description = typeof json?.description === "string" ? json.description : "";
      return { kind: "error", status: response.status, description };
    }
    const messageId = Number(json.result?.message_id);
    return { kind: "ok", messageId: Number.isSafeInteger(messageId) ? messageId : null };
  }

  async function failed(error: string, words = ""): Promise<"failed"> {
    const clean = cleanWords(words, deps.token);
    deps.log(`telegram trending: ${error}${clean === "" ? "" : `, ${clean}`}`);
    await setRow({ lastError: error });
    return "failed";
  }

  async function waitFor(waitMs: number, now: Date): Promise<"waiting"> {
    notBefore = now.getTime() + waitMs;
    deps.log("telegram trending: http 429, waiting");
    await setRow({ lastError: "http 429" });
    return "waiting";
  }

  async function post(text: string, hash: string, before: Date | null, now: Date) {
    // Written before the call: a try with no answer, or a restart now, waits the 24 hours.
    await db
      .insert(telegramTrending)
      .values({ network, postedAt: now })
      .onConflictDoUpdate({
        target: telegramTrending.network,
        set: { postedAt: now, messageId: null, textHash: null },
      });
    const answer = await call("sendMessage", { text });
    switch (answer.kind) {
      case "ok":
        await setRow({
          messageId: answer.messageId,
          textHash: hash,
          editedAt: null,
          lastError: null,
        });
        if (deps.alert !== null) {
          const status = await deps.alert(TRENDING_PIN_ALERT);
          if (status !== null) deps.log(`telegram trending: pin alert ${status}`);
        }
        return "posted";
      case "rate":
        await setRow({ postedAt: before });
        return waitFor(answer.waitMs, now);
      case "network":
        if (!answer.connected) {
          await setRow({ postedAt: before });
          return failed(`network ${answer.code ?? "error"}`);
        }
        return failed(`network ${answer.code ?? "error"}, maybe posted`);
      case "timeout":
        return failed("timeout, maybe posted");
      case "error":
        return failed(`http ${String(answer.status)}`, answer.description);
    }
  }

  async function edit(messageId: number, text: string, hash: string, now: Date) {
    const answer = await call("editMessageText", { message_id: messageId, text });
    switch (answer.kind) {
      case "ok":
        await setRow({ textHash: hash, editedAt: now, lastError: null });
        return "edited";
      case "rate":
        return waitFor(answer.waitMs, now);
      case "network":
        return failed(`network ${answer.code ?? "error"}`);
      case "timeout":
        return failed("timeout");
      case "error":
        if (NOT_MODIFIED.test(answer.description)) {
          await setRow({ textHash: hash, lastError: null });
          return "edited";
        }
        if (NOT_FOUND.test(answer.description)) {
          deps.log("telegram trending: the post is gone");
          await setRow({ messageId: null, textHash: null, lastError: "gone" });
          return "gone";
        }
        return failed(`http ${String(answer.status)}`, answer.description);
    }
  }

  async function check(): Promise<TrendingCheck> {
    const now = deps.now();
    if (now.getTime() < notBefore) return "waiting";
    const cards = await deps.read();
    if (cards === null) return "unavailable";

    const text = buildTrendingPost(cards, network);
    const hash = createHash("sha256")
      .update(`${text}\n${JSON.stringify(trendingButton(deps.siteUrl))}`)
      .digest("hex");
    const [row] = await db
      .select()
      .from(telegramTrending)
      .where(eq(telegramTrending.network, network));

    if (row?.messageId !== null && row?.messageId !== undefined) {
      if (row.textHash === hash) return "same";
      return edit(row.messageId, text, hash, now);
    }
    const before = row?.postedAt ?? null;
    if (before !== null && now.getTime() - before.getTime() < REPOST_GAP_MS) return "waiting";
    return post(text, hash, before, now);
  }

  function run() {
    if (busy) return;
    busy = true;
    check()
      .catch((error: unknown) =>
        deps.log(`telegram trending error: ${error instanceof Error ? error.name : "unknown"}`),
      )
      .finally(() => {
        busy = false;
      });
  }

  return {
    check,
    start() {
      run();
      timer = setInterval(run, TRENDING_CHECK_MS);
      timer.unref();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
