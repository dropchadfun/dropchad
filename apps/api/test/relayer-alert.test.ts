/**
 * The relayer low balance alert: each relayer's coin checked every 10
 * minutes; one low message below the limit, one ok message at the limit times 1.2, nothing in
 * between; the state in `relayer_alerts`, so a restart does not warn again; the state changes
 * only after Telegram answers ok, a failed send is tried again; a failed read changes nothing;
 * plain text to the private chat, the token never in a log.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { relayerAlerts } from "../src/db/schema.js";
import {
  ALERT_TIMEOUT_MS,
  CHECK_EVERY_MS,
  createRelayerAlert,
  lowMessage,
  okMessage,
} from "../src/telegram/relayer-alert.js";

const TOKEN = "123456:sample-token-not-real";
const CHAT = "987654321";
const SVM_RELAYER = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";
const EVM_RELAYER = "0x00000000000000000000000000000000000a1e47";
const START = new Date("2026-10-15T10:00:00.000Z");
const SOL = 1_000_000_000n;

const SOLANA = {
  chainKey: "solana-devnet",
  address: SVM_RELAYER,
  limit: 800_000_000n,
  symbol: "SOL",
  decimals: 9,
};
const ROBINHOOD = {
  chainKey: "robinhood-testnet",
  address: EVM_RELAYER,
  limit: 1_000_000_000_000_000n,
  symbol: "ETH",
  decimals: 18,
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let handle: DatabaseHandle;
let clock: Date;
let calls: Call[];
let answers: (() => Promise<Response>)[];
let logs: string[];
let balances: Record<string, bigint | Error>;

const ok = () => () => Promise.resolve(Response.json({ ok: true, result: { message_id: 7 } }));
const answer = (status: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status }));
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

const reader = (chainKey: string) => () => {
  const balance = balances[chainKey];
  if (balance === undefined) throw new Error(`no balance for ${chainKey}`);
  return balance instanceof Error ? Promise.reject(balance) : Promise.resolve(balance);
};

function alert(relayers = [SOLANA]) {
  return createRelayerAlert({
    db: handle.db,
    fetch: fakeFetch,
    now: () => clock,
    token: TOKEN,
    chatId: CHAT,
    relayers: relayers.map((r) => ({ ...r, readBalance: reader(r.chainKey) })),
    log: (line) => logs.push(line),
  });
}

const stateOf = async (chainKey = SOLANA.chainKey) =>
  (await handle.db.select().from(relayerAlerts).where(eq(relayerAlerts.chainKey, chainKey)))[0]
    ?.state ?? "ok";
const bodyOf = (call: Call | undefined) =>
  JSON.parse(typeof call?.init.body === "string" ? call.init.body : "{}") as Record<
    string,
    unknown
  >;
const resultOf = async (a: ReturnType<typeof alert>, chainKey = SOLANA.chainKey) =>
  (await a.check()).find((r) => r.chainKey === chainKey)?.result;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  clock = START;
  calls = [];
  answers = [];
  logs = [];
  balances = {};
});

describe("the messages", () => {
  it("low: the chain, the address, the balance and the limit exact, the ask", () => {
    expect(lowMessage(SOLANA, 310_000_000n)).toBe(
      [
        "relayer low: solana devnet",
        SVM_RELAYER,
        "balance 0.31 SOL, limit 0.8 SOL",
        "top up the relayer.",
      ].join("\n"),
    );
    expect(lowMessage(ROBINHOOD, 400_000_000_000_000n)).toBe(
      [
        "relayer low: robinhood testnet",
        EVM_RELAYER,
        "balance 0.0004 ETH, limit 0.001 ETH",
        "top up the relayer.",
      ].join("\n"),
    );
  });

  it("ok again: the chain and the balance", () => {
    expect(okMessage(SOLANA, 2_100_000_000n)).toBe(
      ["relayer ok again: solana devnet", "balance 2.1 SOL"].join("\n"),
    );
    expect(okMessage(SOLANA, 0n)).toBe(
      ["relayer ok again: solana devnet", "balance 0 SOL"].join("\n"),
    );
  });
});

describe("the check", () => {
  it("every 10 minutes, 10 s to answer", () => {
    expect(CHECK_EVERY_MS).toBe(600_000);
    expect(ALERT_TIMEOUT_MS).toBe(10_000);
  });

  it("above the limit, and at exactly the limit: nothing is sent", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = 2n * SOL;
    expect(await resultOf(a)).toBe("ok");
    balances[SOLANA.chainKey] = SOLANA.limit;
    expect(await resultOf(a)).toBe("ok");
    expect(calls).toHaveLength(0);
    expect(await stateOf()).toBe("ok");
  });

  it("below the limit: one plain message to the private chat, then low", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok());
    expect(await resultOf(alert())).toBe("sent-low");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    const body = bodyOf(calls[0]);
    expect(body).toEqual({
      chat_id: CHAT,
      text: lowMessage(SOLANA, 310_000_000n),
      link_preview_options: { is_disabled: true },
    });
    expect(body).not.toHaveProperty("parse_mode");
    expect(await stateOf()).toBe("low");
  });

  it("warns once: still low at the next checks, nothing more is sent", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok());
    await a.check();
    balances[SOLANA.chainKey] = 200_000_000n;
    expect(await resultOf(a)).toBe("low");
    expect(await resultOf(a)).toBe("low");
    expect(calls).toHaveLength(1);
  });

  it("between the limit and the limit times 1.2: still low, nothing sent", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok());
    await a.check();
    for (const balance of [800_000_000n, 900_000_000n, 959_999_999n]) {
      balances[SOLANA.chainKey] = balance;
      expect(await resultOf(a)).toBe("low");
    }
    expect(calls).toHaveLength(1);
    expect(await stateOf()).toBe("low");
  });

  it("at the limit times 1.2: one ok message, then ok", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok(), ok());
    await a.check();
    balances[SOLANA.chainKey] = 960_000_000n;
    expect(await resultOf(a)).toBe("sent-ok");
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1])["text"]).toBe(okMessage(SOLANA, 960_000_000n));
    expect(bodyOf(calls[1])["chat_id"]).toBe(CHAT);
    expect(await stateOf()).toBe("ok");
    expect(await resultOf(a)).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("after a top up, low again warns again", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok(), ok(), ok());
    await a.check();
    balances[SOLANA.chainKey] = 2n * SOL;
    await a.check();
    balances[SOLANA.chainKey] = 700_000_000n;
    expect(await resultOf(a)).toBe("sent-low");
    expect(calls).toHaveLength(3);
  });

  it("a restart does not warn again: the state is in the database", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok());
    await alert().check();
    expect(await resultOf(alert())).toBe("low");
    expect(calls).toHaveLength(1);
  });

  it("a failed low message changes nothing and is sent again at the next check", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    const a = alert();
    for (const failure of [answer(500, { ok: false }), refused(), timeout(), answer(429, {})]) {
      answers.push(failure);
      expect(await resultOf(a)).toBe("send-failed");
      expect(await stateOf()).toBe("ok");
    }
    answers.push(ok());
    expect(await resultOf(a)).toBe("sent-low");
    expect(calls).toHaveLength(5);
    expect(await stateOf()).toBe("low");
  });

  it("an answer that says not ok is a failed send", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(answer(200, { ok: false }));
    expect(await resultOf(alert())).toBe("send-failed");
    expect(await stateOf()).toBe("ok");
  });

  it("a failed ok message stays low and is sent again at the next check", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok());
    await a.check();
    balances[SOLANA.chainKey] = 2n * SOL;
    answers.push(answer(502, { ok: false }));
    expect(await resultOf(a)).toBe("send-failed");
    expect(await stateOf()).toBe("low");
    answers.push(ok());
    expect(await resultOf(a)).toBe("sent-ok");
    expect(await stateOf()).toBe("ok");
  });

  it("a failed balance read sends nothing and changes nothing", async () => {
    const a = alert();
    balances[SOLANA.chainKey] = new Error("rpc down");
    expect(await resultOf(a)).toBe("read-failed");
    expect(calls).toHaveLength(0);
    expect(await stateOf()).toBe("ok");
    expect(logs.some((l) => l.includes("solana-devnet"))).toBe(true);
  });

  it("each chain on its own: one low, one fine, one message", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    balances[ROBINHOOD.chainKey] = 5_000_000_000_000_000n;
    answers.push(ok());
    const results = await alert([SOLANA, ROBINHOOD]).check();
    expect(results).toEqual([
      { chainKey: "solana-devnet", result: "sent-low" },
      { chainKey: "robinhood-testnet", result: "ok" },
    ]);
    expect(calls).toHaveLength(1);
    expect(await stateOf("robinhood-testnet")).toBe("ok");
  });

  it("one chain's failed read does not stop the other", async () => {
    balances[SOLANA.chainKey] = new Error("rpc down");
    balances[ROBINHOOD.chainKey] = 1n;
    answers.push(ok());
    const results = await alert([SOLANA, ROBINHOOD]).check();
    expect(results).toEqual([
      { chainKey: "solana-devnet", result: "read-failed" },
      { chainKey: "robinhood-testnet", result: "sent-low" },
    ]);
  });

  it("the token and the url are never in a log line", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    const a = alert();
    for (const failure of [answer(500, { ok: false }), refused(), timeout()]) {
      answers.push(failure);
      await a.check();
    }
    balances[SOLANA.chainKey] = new Error(`boom https://api.telegram.org/bot${TOKEN}/x`);
    await a.check();
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("api.telegram.org");
    }
  });

  it("start checks at once, then stop", async () => {
    balances[SOLANA.chainKey] = 310_000_000n;
    answers.push(ok());
    const a = alert();
    await a.start();
    a.stop();
    expect(calls).toHaveLength(1);
    expect(await stateOf()).toBe("low");
  });
});
