/**
 * The Telegram sender: one post per drop, at most once, at least 3 s
 * apart, a retry only when nothing was posted (a `429`, a connection that never opened), any
 * other answer or a timeout is final, 8 tries, skipped after 1 hour, the text built at send time,
 * the token never in a log or a row.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { drops, profiles, telegramPosts } from "../src/db/schema.js";
import { createTelegramSender, enqueueTelegramPost } from "../src/telegram/sender.js";

const TOKEN = "123456:sample-token-not-real";
const CHANNEL = "@sampledropchad";
const DROP = "0x00000000000000000000000000000000005a0d01";
const DROP_2 = "0x00000000000000000000000000000000005a0d02";
const START = new Date("2026-10-12T10:00:00.000Z");

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let handle: DatabaseHandle;
let clock: Date;
let calls: Call[];
let answers: (() => Promise<Response>)[];
let logs: string[];

const ok =
  (id = 42) =>
  () =>
    Promise.resolve(Response.json({ ok: true, result: { message_id: id } }));
const answer = (status: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status }));
const refused = () => () => {
  const error = new TypeError("fetch failed");
  (error as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return Promise.reject(error);
};
const reset = () => () => {
  const error = new TypeError("fetch failed");
  (error as { cause?: unknown }).cause = Object.assign(new Error("socket hang up"), {
    code: "ECONNRESET",
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

function sender() {
  return createTelegramSender({
    db: handle.db,
    fetch: fakeFetch,
    now: () => clock,
    token: TOKEN,
    channelId: CHANNEL,
    siteUrl: "https://dropchad.com",
    log: (line) => logs.push(line),
  });
}

async function seedDrop(address: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "samplechad", displayName: "S", profileImageUrl: null })
    .onConflictDoNothing();
  await handle.db.insert(drops).values({
    address,
    chainId: 46630,
    chainKey: "robinhood-testnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "500000000000000",
    feeAmount: "0",
    grossRequired: "500000000000000",
    leafCount: 2,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 604_800,
    mode: "handle",
    state: "active",
    title: "gm",
    createTxHash: `0x${"55".repeat(32)}`,
    ...overrides,
  });
}

const row = async (address = DROP) =>
  (await handle.db.select().from(telegramPosts).where(eq(telegramPosts.dropAddress, address)))[0];
const later = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const bodyOf = (call: Call | undefined) =>
  JSON.parse(typeof call?.init.body === "string" ? call.init.body : "{}") as Record<
    string,
    unknown
  >;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  clock = START;
  calls = [];
  answers = [];
  logs = [];
  await seedDrop(DROP);
  await enqueueTelegramPost(handle.db, DROP, clock);
  return () => handle.close();
});

describe("a post that goes through", () => {
  it("is sent once, with the message id kept", async () => {
    answers.push(ok(42));
    const s = sender();
    expect(await s.tick()).toBe("sent");
    expect(await row()).toMatchObject({ state: "sent", messageId: 42, attempts: 1 });
    expect((await row())?.sentAt?.toISOString()).toBe(START.toISOString());
    later(60_000);
    expect(await s.tick()).toBe("idle");
    expect(calls).toHaveLength(1);
  });

  it("asks Telegram's fixed host, HTML, previews off, the channel, a 10 s limit", async () => {
    answers.push(ok());
    await sender().tick();
    const call = calls[0];
    expect(call?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    const body = bodyOf(call);
    expect(body).toMatchObject({
      chat_id: CHANNEL,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    expect(String(body["text"])).toContain("🤌 NEW DROP");
    expect(String(body["text"])).toContain("chain: robinhood testnet");
    expect(String(body["text"])).toContain("message: <code>gm</code>");
  });

  it("builds the text at send time: the handle as it is now", async () => {
    await handle.db
      .update(profiles)
      .set({ handle: "renamedchad" })
      .where(eq(profiles.xUserId, "1"));
    answers.push(ok());
    await sender().tick();
    expect(String(bodyOf(calls[0])["text"])).toContain('href="https://x.com/renamedchad"');
  });

  it("enqueueing twice still posts once", async () => {
    await enqueueTelegramPost(handle.db, DROP, clock);
    answers.push(ok());
    const s = sender();
    await s.tick();
    later(10_000);
    expect(await s.tick()).toBe("idle");
    expect(calls).toHaveLength(1);
  });

  it("two posts are at least 3 s apart", async () => {
    await seedDrop(DROP_2);
    await enqueueTelegramPost(handle.db, DROP_2, clock);
    answers.push(ok(1), ok(2));
    const s = sender();
    expect(await s.tick()).toBe("sent");
    later(1_000);
    expect(await s.tick()).toBe("waiting");
    later(2_000);
    expect(await s.tick()).toBe("sent");
    expect(calls).toHaveLength(2);
  });
});

describe("retries, only when nothing was posted", () => {
  it("a 429 waits Telegram's retry_after and pauses the whole loop", async () => {
    answers.push(answer(429, { ok: false, error_code: 429, parameters: { retry_after: 7 } }), ok());
    const s = sender();
    expect(await s.tick()).toBe("retry");
    expect(await row()).toMatchObject({ state: "ready", attempts: 1 });
    later(5_000);
    expect(await s.tick()).toBe("waiting");
    later(2_000);
    expect(await s.tick()).toBe("sent");
    expect(calls).toHaveLength(2);
  });

  it("a connection that never opened retries after 30 s, then 60 s", async () => {
    answers.push(refused(), refused(), ok());
    const s = sender();
    expect(await s.tick()).toBe("retry");
    expect((await row())?.runAfter.toISOString()).toBe(
      new Date(START.getTime() + 30_000).toISOString(),
    );
    later(30_000);
    expect(await s.tick()).toBe("retry");
    expect((await row())?.runAfter.getTime()).toBe(clock.getTime() + 60_000);
    later(60_000);
    expect(await s.tick()).toBe("sent");
  });

  it("gives up after 8 tries, all inside the hour", async () => {
    const s = sender();
    const results: string[] = [];
    for (let i = 0; i < 8; i++) {
      answers.push(refused());
      results.push(await s.tick());
      clock = (await row())?.runAfter ?? clock;
    }
    expect(results).toEqual([...Array<string>(7).fill("retry"), "failed"]);
    expect(await row()).toMatchObject({ state: "failed", attempts: 8 });
    expect(calls).toHaveLength(8);
    expect(clock.getTime() - START.getTime()).toBeLessThan(60 * 60_000);
  });

  it("the backoff doubles up to 10 minutes", async () => {
    const s = sender();
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      answers.push(refused());
      await s.tick();
      const r = await row();
      gaps.push((r?.runAfter.getTime() ?? 0) - clock.getTime());
      clock = r?.runAfter ?? clock;
    }
    expect(gaps).toEqual([30, 60, 120, 240, 480, 600].map((s) => s * 1000));
  });
});

describe("final, never sent again", () => {
  it("a timeout may have posted: failed, no retry", async () => {
    answers.push(timeout());
    const s = sender();
    expect(await s.tick()).toBe("failed");
    later(60 * 60_000);
    expect(await s.tick()).toBe("idle");
    expect(calls).toHaveLength(1);
    expect((await row())?.state).toBe("failed");
  });

  it("a connection reset may have posted: failed, no retry", async () => {
    answers.push(reset());
    expect(await sender().tick()).toBe("failed");
  });

  it("a 400 or a 500 is failed, with the status only", async () => {
    answers.push(
      answer(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }),
    );
    expect(await sender().tick()).toBe("failed");
    expect((await row())?.lastError).toBe("http 400");

    await seedDrop(DROP_2);
    await enqueueTelegramPost(handle.db, DROP_2, clock);
    later(5_000);
    answers.push(answer(500, { ok: false, error_code: 500 }));
    expect(await sender().tick()).toBe("failed");
    expect((await row(DROP_2))?.lastError).toBe("http 500");
  });

  it("a row left in sending by a restart is failed at start, never resent", async () => {
    await handle.db
      .update(telegramPosts)
      .set({ state: "sending" })
      .where(eq(telegramPosts.dropAddress, DROP));
    const s = sender();
    expect(await s.recover()).toBe(1);
    expect(await row()).toMatchObject({ state: "failed", lastError: "unknown, maybe posted" });
    expect(await s.tick()).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("not sent within 1 hour of going live: skipped, never posted", async () => {
    later(60 * 60_000 + 1);
    expect(await sender().tick()).toBe("skipped");
    expect((await row())?.state).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("a multisend row is skipped, never posted", async () => {
    await handle.db.update(drops).set({ mode: "address" }).where(eq(drops.address, DROP));
    expect(await sender().tick()).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

describe("the token stays secret", () => {
  it("never in a log line or a row, whatever goes wrong", async () => {
    answers.push(refused(), answer(429, { ok: false, parameters: { retry_after: 1 } }), timeout());
    const s = sender();
    for (let i = 0; i < 3; i++) {
      await s.tick();
      later(10 * 60_000);
    }
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("api.telegram.org/bot");
    }
    expect(JSON.stringify(await row())).not.toContain(TOKEN);
  });
});
