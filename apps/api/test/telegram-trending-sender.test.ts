/**
 * The trending post loop: one post, then only edits, and an
 * edit only when the text changed; the message id kept across a restart, one row per network; a
 * new post only when Telegram says the old one is gone, at most one try in 24 hours, a try with
 * no answer counts; a `429` waits; the private alert after a new post; an error answer's words
 * in the log, cleaned, never in the row; the token never in a log or a row.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { BoardProfile } from "../src/boards/compute.js";
import { NO_TRENDING, type TrendingCards } from "../src/boards/trending.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { telegramTrending } from "../src/db/schema.js";
import {
  createTrendingPoster,
  REPOST_GAP_MS,
  TRENDING_CHECK_MS,
  type TrendingPosterDeps,
} from "../src/telegram/trending-sender.js";

const TOKEN = "123456:sample-token-not-real";
const CHANNEL = "@sampledropchad";
const START = new Date("2026-10-29T10:00:00.000Z");

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let handle: DatabaseHandle;
let clock: Date;
let calls: Call[];
let answers: (() => Promise<Response>)[];
let logs: string[];
let alerts: string[];
let current: TrendingCards | null;

const ok =
  (id = 42) =>
  () =>
    Promise.resolve(Response.json({ ok: true, result: { message_id: id } }));
const answer = (status: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status }));
const notFound = () =>
  answer(400, {
    ok: false,
    error_code: 400,
    description: "Bad Request: message to edit not found",
  });
/** The real answer to an edit of a deleted channel post, seen on the test channel. */
const messageIdInvalid = () =>
  answer(400, { ok: false, error_code: 400, description: "Bad Request: MESSAGE_ID_INVALID" });
const notModified = () =>
  answer(400, {
    ok: false,
    error_code: 400,
    description:
      "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
  });
const refused = () => () => {
  const error = new TypeError("fetch failed");
  (error as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return Promise.reject(error);
};
const timeout = () => () =>
  Promise.reject(
    Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    }),
  );

const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  calls.push({ url: href, init: init ?? {} });
  const next = answers.shift();
  if (next === undefined) throw new Error("no answer queued");
  return next();
};

function poster(overrides: Partial<TrendingPosterDeps> = {}) {
  return createTrendingPoster({
    db: handle.db,
    fetch: fakeFetch,
    now: () => clock,
    token: TOKEN,
    channelId: CHANNEL,
    siteUrl: "https://dropchad.com",
    network: "testnet",
    read: () => Promise.resolve(current),
    alert: (text) => {
      alerts.push(text);
      return Promise.resolve(null);
    },
    log: (line) => logs.push(line),
    ...overrides,
  });
}

function withChad(handleName: string): TrendingCards {
  const profile: BoardProfile = {
    xUserId: "1",
    handle: handleName,
    displayName: "S",
    profileImageUrl: null,
    kind: "chad",
    tags: [],
    tagLockedUntil: null,
    badges: [],
    streams: [],
  };
  return {
    ...NO_TRENDING,
    chad: {
      range: "day",
      items: [
        {
          profile,
          people: 2,
          drops: 1,
          lastDropAt: 1_800_000_000,
          chainKey: "solana-devnet",
          amount: 10n ** 9n,
        },
      ],
    },
  };
}

const row = async (network: "testnet" | "mainnet" = "testnet") =>
  (await handle.db.select().from(telegramTrending).where(eq(telegramTrending.network, network)))[0];
const later = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const bodyOf = (call: Call | undefined) =>
  JSON.parse(typeof call?.init.body === "string" ? call.init.body : "{}") as Record<
    string,
    unknown
  >;
const methodOf = (call: Call | undefined) => call?.url.split("/").pop();

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  clock = START;
  calls = [];
  answers = [];
  logs = [];
  alerts = [];
  current = NO_TRENDING;
  return () => handle.close();
});

describe("the numbers", () => {
  it("checks every 5 minutes; a new post at most once in 24 hours", () => {
    expect(TRENDING_CHECK_MS).toBe(5 * 60_000);
    expect(REPOST_GAP_MS).toBe(24 * 60 * 60_000);
  });
});

describe("the first post", () => {
  it("posts once, keeps the message id, and tells the owner to pin it", async () => {
    answers.push(ok(42));
    expect(await poster().check()).toBe("posted");
    expect(await row()).toMatchObject({ network: "testnet", messageId: 42, lastError: null });
    expect((await row())?.postedAt?.toISOString()).toBe(START.toISOString());
    expect((await row())?.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(alerts).toEqual(["🤌 TRENDING POST NEW, pin it in the channel by hand."]);
  });

  it("asks the fixed host, HTML, previews off, the channel, the button, a 10 s limit", async () => {
    answers.push(ok());
    await poster().check();
    const call = calls[0];
    expect(call?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    const body = bodyOf(call);
    expect(body).toMatchObject({
      chat_id: CHANNEL,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: "open dropchad", url: "https://dropchad.com" }]],
      },
    });
    expect(
      String(body["text"]).startsWith("<b>🧪 TESTNET, test coins only</b>\n\n<b>🤌 TRENDING</b>"),
    ).toBe(true);
  });

  it("never pins: only sendMessage and editMessageText are called", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(ok(42));
    later(TRENDING_CHECK_MS);
    await p.check();
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText"]);
  });

  it("no alert function: the post still goes, nothing else", async () => {
    answers.push(ok(42));
    expect(await poster({ alert: null }).check()).toBe("posted");
  });
});

describe("edits", () => {
  it("the same text: no call at all", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("same");
    expect(calls).toHaveLength(1);
  });

  it("a change edits the same message, with the button again", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    const firstHash = (await row())?.textHash;
    current = withChad("alpha");
    answers.push(ok(42));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("edited");
    const call = calls[1];
    expect(call?.url).toBe(`https://api.telegram.org/bot${TOKEN}/editMessageText`);
    expect(bodyOf(call)).toMatchObject({
      chat_id: CHANNEL,
      message_id: 42,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: "open dropchad", url: "https://dropchad.com" }]],
      },
    });
    expect(String(bodyOf(call)["text"])).toContain('href="https://x.com/alpha"');
    expect((await row())?.textHash).not.toBe(firstHash);
    expect((await row())?.editedAt?.toISOString()).toBe(clock.toISOString());
    expect(alerts).toHaveLength(1);
  });

  it("not modified: the hash is stored, no error, no new post", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(notModified());
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("edited");
    expect(await row()).toMatchObject({ messageId: 42, lastError: null });
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("same");
    expect(calls).toHaveLength(2);
  });

  it("another error keeps the old hash, so the next check tries again; never a new post", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(answer(403, { ok: false, error_code: 403, description: "Forbidden: x" }));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("failed");
    expect(await row()).toMatchObject({ messageId: 42, lastError: "http 403" });
    answers.push(ok(42));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("edited");
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText", "editMessageText"]);
  });

  it("a timeout or a network error on an edit: tried again next check, never a new post", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(timeout(), refused(), ok(42));
    for (let i = 0; i < 3; i++) {
      later(TRENDING_CHECK_MS);
      await p.check();
    }
    expect(calls.map(methodOf)).toEqual([
      "sendMessage",
      "editMessageText",
      "editMessageText",
      "editMessageText",
    ]);
    expect(await row()).toMatchObject({ messageId: 42, lastError: null });
  });

  it("a 429 waits its retry_after: no call before, then the edit", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(
      answer(429, { ok: false, error_code: 429, parameters: { retry_after: 600 } }),
      ok(42),
    );
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("waiting");
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("waiting");
    expect(calls).toHaveLength(2);
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("edited");
  });
});

describe("cards not available", () => {
  it("the read answers null: no call, the post keeps its last text", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = null;
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("unavailable");
    expect(calls).toHaveLength(1);
  });

  it("before the first post: nothing is posted", async () => {
    current = null;
    expect(await poster().check()).toBe("unavailable");
    expect(calls).toHaveLength(0);
    expect(await row()).toBeUndefined();
  });
});

describe("a restart", () => {
  it("a new poster edits the stored message, never posts a new one", async () => {
    answers.push(ok(42));
    await poster().check();
    current = withChad("alpha");
    answers.push(ok(42));
    later(TRENDING_CHECK_MS);
    expect(await poster().check()).toBe("edited");
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText"]);
    expect(bodyOf(calls[1])["message_id"]).toBe(42);
  });

  it("the same text after a restart: no call", async () => {
    answers.push(ok(42));
    await poster().check();
    later(TRENDING_CHECK_MS);
    expect(await poster().check()).toBe("same");
    expect(calls).toHaveLength(1);
  });

  it("a mainnet poster does not use the testnet row: it posts its own, no testnet line", async () => {
    answers.push(ok(42));
    await poster().check();
    answers.push(ok(77));
    expect(await poster({ network: "mainnet" }).check()).toBe("posted");
    expect(await row("mainnet")).toMatchObject({ messageId: 77 });
    expect(await row("testnet")).toMatchObject({ messageId: 42 });
    // The mainnet title.
    expect(String(bodyOf(calls[1])["text"]).startsWith("<b>🤌 TRENDING (beta version)</b>")).toBe(
      true,
    );
  });
});

describe("a deleted post", () => {
  async function postThenDelete(p: ReturnType<typeof poster>, gone = notFound()) {
    answers.push(ok(42));
    await p.check();
    later(REPOST_GAP_MS + 1);
    current = withChad("alpha");
    answers.push(gone);
    later(TRENDING_CHECK_MS);
    return p.check();
  }

  it("the real words, MESSAGE_ID_INVALID: gone, then one new post with the alert", async () => {
    const p = poster();
    expect(await postThenDelete(p, messageIdInvalid())).toBe("gone");
    expect(await row()).toMatchObject({ messageId: null, lastError: "gone" });
    answers.push(ok(43));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("posted");
    expect(await row()).toMatchObject({ messageId: 43, lastError: null });
    expect(alerts).toEqual([
      "🤌 TRENDING POST NEW, pin it in the channel by hand.",
      "🤌 TRENDING POST NEW, pin it in the channel by hand.",
    ]);
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("same");
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText", "sendMessage"]);
  });

  it.each([
    ["message can't be edited", "Bad Request: message can't be edited", "failed"],
    [
      "can't parse entities",
      "Bad Request: can't parse entities: Unsupported start tag at byte offset 0",
      "failed",
    ],
    [
      "message is not modified",
      "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
      "edited",
    ],
  ])("%s never causes a new post, even after 24 hours", async (_name, description, result) => {
    const p = poster();
    const words = answer(400, { ok: false, error_code: 400, description });
    expect(await postThenDelete(p, words)).toBe(result);
    expect(await row()).toMatchObject({ messageId: 42 });
    later(REPOST_GAP_MS + 1);
    current = withChad("bravo");
    answers.push(answer(400, { ok: false, error_code: 400, description }));
    await p.check();
    expect(await row()).toMatchObject({ messageId: 42 });
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText", "editMessageText"]);
    expect(alerts).toHaveLength(1);
  });

  it("not found clears the id; the next check posts once, with the alert", async () => {
    const p = poster();
    expect(await postThenDelete(p)).toBe("gone");
    expect(await row()).toMatchObject({ messageId: null });
    answers.push(ok(43));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("posted");
    expect(await row()).toMatchObject({ messageId: 43 });
    expect(alerts).toHaveLength(2);
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText", "sendMessage"]);
  });

  it("a second delete within 24 hours of the last post brings no new post", async () => {
    const p = poster();
    await postThenDelete(p);
    answers.push(ok(43));
    later(TRENDING_CHECK_MS);
    await p.check();
    current = withChad("bravo");
    answers.push(notFound());
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("gone");
    for (let i = 0; i < 3; i++) {
      later(TRENDING_CHECK_MS);
      expect(await p.check()).toBe("waiting");
    }
    expect(calls.map(methodOf)).toEqual([
      "sendMessage",
      "editMessageText",
      "sendMessage",
      "editMessageText",
    ]);
    answers.push(ok(44));
    later(REPOST_GAP_MS);
    expect(await p.check()).toBe("posted");
  });

  it("a deleted post within 24 hours of the first post waits the rest of the 24 hours", async () => {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(notFound());
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("gone");
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("waiting");
    expect(calls).toHaveLength(2);
  });
});

describe("a post in doubt", () => {
  it("a timeout on sendMessage counts as a try: no new post for 24 hours", async () => {
    answers.push(timeout());
    const p = poster();
    expect(await p.check()).toBe("failed");
    expect(await row()).toMatchObject({ messageId: null, lastError: "timeout, maybe posted" });
    expect((await row())?.postedAt?.toISOString()).toBe(START.toISOString());
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("waiting");
    expect(calls).toHaveLength(1);
    expect(alerts).toHaveLength(0);
    answers.push(ok(42));
    later(REPOST_GAP_MS);
    expect(await p.check()).toBe("posted");
  });

  it("an error answer on sendMessage counts as a try too", async () => {
    answers.push(answer(400, { ok: false, error_code: 400, description: "Bad Request: x" }));
    const p = poster();
    expect(await p.check()).toBe("failed");
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("waiting");
    expect(calls).toHaveLength(1);
  });

  it("a restart in the middle of a post waits the 24 hours: posted_at is written before the call", async () => {
    answers.push(() => new Promise<Response>(() => undefined));
    void poster().check();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await row())?.postedAt?.toISOString()).toBe(START.toISOString());
    later(TRENDING_CHECK_MS);
    expect(await poster().check()).toBe("waiting");
  });

  it("a connection that never opened is not a try: the next check posts", async () => {
    answers.push(refused());
    const p = poster();
    expect(await p.check()).toBe("failed");
    expect((await row())?.postedAt ?? null).toBeNull();
    answers.push(ok(42));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("posted");
  });

  it("a 429 on sendMessage is not a try: after its retry_after, it posts", async () => {
    answers.push(answer(429, { ok: false, error_code: 429, parameters: { retry_after: 60 } }));
    const p = poster();
    expect(await p.check()).toBe("waiting");
    expect((await row())?.postedAt ?? null).toBeNull();
    answers.push(ok(42));
    later(TRENDING_CHECK_MS);
    expect(await p.check()).toBe("posted");
  });
});

describe("the error words in the log", () => {
  async function editAnswering(description: string) {
    answers.push(ok(42));
    const p = poster();
    await p.check();
    current = withChad("alpha");
    answers.push(answer(400, { ok: false, error_code: 400, description }));
    later(TRENDING_CHECK_MS);
    return p.check();
  }

  it("an unknown 400 on an edit logs its words; the row keeps the status; no new post", async () => {
    expect(await editAnswering("Bad Request: MESSAGE_TOO_LONG")).toBe("failed");
    expect(logs).toContain("telegram trending: http 400, Bad Request: MESSAGE_TOO_LONG");
    expect(await row()).toMatchObject({ messageId: 42, lastError: "http 400" });
    expect(calls.map(methodOf)).toEqual(["sendMessage", "editMessageText"]);
  });

  it("an error answer on sendMessage logs its words too", async () => {
    answers.push(
      answer(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }),
    );
    expect(await poster().check()).toBe("failed");
    expect(logs).toEqual(["telegram trending: http 400, Bad Request: chat not found"]);
    expect(await row()).toMatchObject({ messageId: null, lastError: "http 400" });
  });

  it("the token and any bot token in the words are replaced", async () => {
    await editAnswering(`Bad Request: ${TOKEN} bot987654:AAbb_cc-DD and bot${TOKEN}`);
    const line = logs.at(-1) ?? "";
    expect(line).toBe("telegram trending: http 400, Bad Request: *** *** and bot***");
    expect(line).not.toContain("sample-token");
    expect(line).not.toContain("AAbb");
  });

  it("the words are printable, on one line, at most 200 characters", async () => {
    await editAnswering(`Bad\nRequest:\t🤌 ${"x".repeat(500)}`);
    const line = logs.at(-1) ?? "";
    const words = line.slice("telegram trending: http 400, ".length);
    expect(words.startsWith("Bad Request: x")).toBe(true);
    expect(words).toHaveLength(200);
    expect(line).toMatch(/^[\x20-\x7E]+$/);
  });

  it("no words: the status only", async () => {
    await editAnswering("");
    expect(logs.at(-1)).toBe("telegram trending: http 400");
  });
});

describe("the token", () => {
  it("is never in a log line or a row, and Telegram's words are never stored in a row", async () => {
    answers.push(timeout());
    const p = poster();
    await p.check();
    later(REPOST_GAP_MS);
    answers.push(ok(42));
    await p.check();
    current = withChad("alpha");
    answers.push(answer(400, { ok: false, description: `Bad Request: ${TOKEN}` }));
    later(TRENDING_CHECK_MS);
    await p.check();
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("api.telegram.org");
    }
    const stored = JSON.stringify(await row());
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain("Bad Request");
  });
});
