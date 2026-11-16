/**
 * The owner alerts: money falling fast, many claims, admin
 * changes and api errors, in the private chat of the relayer alert. The same key at most
 * once every 30 minutes, kept in `alerts_sent`, written only after Telegram answers ok; testnet
 * defaults, a mainnet chain set by hand or not watched; reads only; the token never in a log, no
 * error text in a message.
 */
import { getChain, getDeployedChain } from "@dropchad/chains";
import { Hono } from "hono";
import { getAddress } from "viem";
import { describe, beforeEach, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { adminSnapshots, alertsSent, relayerBalanceSamples, relayerTxs } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { isServedEvmChain } from "../src/chain/client.js";
import {
  adminMessage,
  apiErrorsMessage,
  claimsMessage,
  createOwnerAlerts,
  ethWaitingMessage,
  evmAdminFields,
  evmAdminTargets,
  fastMessage,
  ownerAlertSettings,
  solanaAdminFields,
  type AdminWatch,
  type EthWaitingWatch,
} from "../src/telegram/owner-alerts.js";
import { createRelayerAlert } from "../src/telegram/relayer-alert.js";
import { pubkeyFromBase58 } from "../src/chain/svm/pubkey.js";
import { encodeConfigAccount } from "./fake-svm.js";
import { TEST_ENV, createHarness } from "./harness.js";

const TOKEN = "123456:sample-token-not-real";
const CHAT = "987654321";
const SVM_RELAYER = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";
const START = new Date("2026-10-18T10:00:00.000Z");
const MINUTE = 60_000;
const SOL = 1_000_000_000n;

const SOLANA_FAST = {
  chainKey: "solana-devnet",
  address: SVM_RELAYER,
  symbol: "SOL",
  decimals: 9,
  drop: 100_000_000n,
  minutes: 60,
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let handle: DatabaseHandle;
let clock: Date;
let calls: Call[];
let failNext: boolean;
let logs: string[];

const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  calls.push({ url: href, init: init ?? {} });
  if (failNext) {
    failNext = false;
    return Promise.resolve(Response.json({ ok: false }, { status: 500 }));
  }
  return Promise.resolve(Response.json({ ok: true, result: { message_id: 7 } }));
};

const textOf = (call: Call | undefined) =>
  (JSON.parse(typeof call?.init.body === "string" ? call.init.body : "{}") as { text?: string })
    .text;

function alerts(
  options: {
    fast?: (typeof SOLANA_FAST)[];
    claims?: { chainKey: string; count: number; minutes: number }[];
    admin?: AdminWatch[];
    apiErrors?: { count: number; minutes: number } | null;
    ethWaiting?: EthWaitingWatch | null;
  } = {},
) {
  return createOwnerAlerts({
    db: handle.db,
    fetch: fakeFetch,
    now: () => clock,
    token: TOKEN,
    chatId: CHAT,
    log: (line) => logs.push(line),
    repeatMinutes: 30,
    fast: options.fast ?? [SOLANA_FAST],
    claims: options.claims ?? [{ chainKey: "solana-devnet", count: 50, minutes: 10 }],
    admin: options.admin ?? [],
    apiErrors: options.apiErrors === undefined ? { count: 20, minutes: 5 } : options.apiErrors,
    ethWaiting: options.ethWaiting ?? null,
  });
}

const later = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * MINUTE);
};

async function claimTx(n: number, kind = "claim", chainKey = "solana-devnet", at = clock) {
  await handle.db.insert(relayerTxs).values({
    txHash: `tx-${chainKey}-${kind}-${String(n)}-${String(at.getTime())}`,
    kind,
    chainId: chainKey === "solana-devnet" ? 103 : 46630,
    chainKey,
    toAddress: "program",
    gasLimit: "0",
    status: "success",
    createdAt: at,
  });
}

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  clock = START;
  calls = [];
  failNext = false;
  logs = [];
  return () => handle.close();
});

describe("the messages", () => {
  it("MONEY FALLING FAST: title with the chain, down in how long, balance, what happened, what to do", () => {
    expect(fastMessage(SOLANA_FAST, 150_000_000n, 2_350_000_000n)).toBe(
      [
        "🔴 MONEY FALLING FAST, SOLANA DEVNET",
        "",
        "Down 0.15 SOL in 60 minutes",
        "Balance 2.35 SOL",
        "",
        "The relayer spends much more than normal.",
        "",
        "If there are many real drops, nothing to do. If not, turn off new drops and check the server.",
      ].join("\n"),
    );
  });

  it("MANY CLAIMS", () => {
    expect(claimsMessage("robinhood-testnet", 51, 10)).toBe(
      [
        "🟠 MANY CLAIMS, ROBINHOOD CHAIN TESTNET",
        "",
        "51 claims in 10 minutes",
        "",
        "A lot of claims came very fast.",
        "",
        "Look at the boards. If it is a big real drop, nothing to do. If it looks strange, turn off new drops.",
      ].join("\n"),
    );
  });

  it("ADMIN CHANGE: one line per field, old to new, fee amounts readable, bps as a percent", () => {
    expect(
      adminMessage("solana-devnet", [
        { field: "paused", old: "false", new: "true" },
        { field: "default_fee_bps", old: "100", new: "200" },
        { field: "min_fee_lamports", old: "2500000", new: "0" },
        { field: "relayer", old: "GWuN", new: "NEW" },
      ]),
    ).toBe(
      [
        "🔴 ADMIN CHANGE, SOLANA DEVNET",
        "",
        "paused false to true",
        "default_fee_bps 1% to 2%",
        "min_fee_lamports 0.0025 SOL to 0 SOL",
        "relayer GWuN to NEW",
        "",
        "A setting on the program was changed.",
        "",
        "If you did it, nothing to do. If not, turn off new drops and check the admin key now.",
      ].join("\n"),
    );
    const evm = adminMessage("robinhood-testnet", [
      { field: "factory.defaultFeeBps", old: "100", new: "150" },
      { field: "factory.minFeePerReceiver", old: "10000000000000", new: "20000000000000" },
      { field: "factory.maxFeeAmount", old: "1000000000000000000", new: "500000000000000000" },
      { field: "oldFactory.paused", old: "true", new: "false" },
    ]);
    expect(evm.split("\n").slice(0, 6)).toEqual([
      "🔴 ADMIN CHANGE, ROBINHOOD CHAIN TESTNET",
      "",
      "factory.defaultFeeBps 1% to 1.5%",
      "factory.minFeePerReceiver 0.00001 ETH to 0.00002 ETH",
      "factory.maxFeeAmount 1 ETH to 0.5 ETH",
      "oldFactory.paused true to false",
    ]);
  });

  it("API ERRORS has no chain", () => {
    expect(apiErrorsMessage(21, 5)).toBe(
      [
        "🔴 API ERRORS",
        "",
        "21 errors in 5 minutes",
        "",
        "The server is failing many times.",
        "",
        "Check the api log on the server.",
      ].join("\n"),
    );
  });

  it("one or more: 1 claim, 1 error, 1 minute, the plural for any other count", () => {
    expect(claimsMessage("solana-devnet", 1, 1)).toContain("\n1 claim in 1 minute\n");
    expect(claimsMessage("solana-devnet", 0, 10)).toContain("\n0 claims in 10 minutes\n");
    expect(claimsMessage("solana-devnet", 2, 1)).toContain("\n2 claims in 1 minute\n");
    expect(apiErrorsMessage(1, 1)).toContain("\n1 error in 1 minute\n");
    expect(apiErrorsMessage(1, 5)).toContain("\n1 error in 5 minutes\n");
    expect(fastMessage({ ...SOLANA_FAST, minutes: 1 }, 10_000_000n, SOL)).toContain(
      "\nDown 0.01 SOL in 1 minute\n",
    );
  });

  it("no dashes, colons or arrows in a text", () => {
    for (const text of [
      fastMessage(SOLANA_FAST, 150_000_000n, 2_350_000_000n),
      claimsMessage("solana-devnet", 51, 10),
      adminMessage("solana-devnet", [{ field: "paused", old: "false", new: "true" }]),
      apiErrorsMessage(21, 5),
    ]) {
      expect(text).not.toMatch(/[-:>→–—]/);
    }
  });
});

describe("the numbers", () => {
  const testnet = { CHAIN_KEY: "robinhood-testnet", SOLANA_CHAIN_KEY: "solana-devnet" };
  const mainnet = { CHAIN_KEY: "robinhood", SOLANA_CHAIN_KEY: "solana" };

  it("the testnet defaults: 30 min repeat, 0.1 SOL and 0.0002 ETH in 60 min, 50 claims in 10, admin every 5, 20 errors in 5", () => {
    const s = ownerAlertSettings(testnet);
    expect(s.repeatMinutes).toBe(30);
    expect(s.adminMinutes).toBe(5);
    expect(s.fast.watched).toEqual([
      { chainKey: "robinhood-testnet", drop: 200_000_000_000_000n, minutes: 60 },
      { chainKey: "solana-devnet", drop: 100_000_000n, minutes: 60 },
    ]);
    expect(s.claims.watched).toEqual([
      { chainKey: "robinhood-testnet", count: 50, minutes: 10 },
      { chainKey: "solana-devnet", count: 50, minutes: 10 },
    ]);
    expect(s.apiErrors).toEqual({ count: 20, minutes: 5 });
  });

  it("every number is an env setting", () => {
    const s = ownerAlertSettings({
      ...testnet,
      ALERT_REPEAT_MINUTES: "45",
      RELAYER_FAST_MINUTES: "30",
      RELAYER_FAST_DROP_LAMPORTS: "5",
      RELAYER_FAST_DROP_WEI: "6",
      CLAIMS_ALERT_COUNT: "7",
      CLAIMS_ALERT_MINUTES: "8",
      ADMIN_ALERT_MINUTES: "9",
      API_ERRORS_ALERT_COUNT: "10",
      API_ERRORS_ALERT_MINUTES: "11",
    });
    expect(s.repeatMinutes).toBe(45);
    expect(s.adminMinutes).toBe(9);
    expect(s.fast.watched).toEqual([
      { chainKey: "robinhood-testnet", drop: 6n, minutes: 30 },
      { chainKey: "solana-devnet", drop: 5n, minutes: 30 },
    ]);
    expect(s.claims.watched).toEqual([
      { chainKey: "robinhood-testnet", count: 7, minutes: 8 },
      { chainKey: "solana-devnet", count: 7, minutes: 8 },
    ]);
    expect(s.apiErrors).toEqual({ count: 10, minutes: 11 });
  });

  it("on a mainnet chain the defaults do not count: alerts 1, 2 and 5 not watched, and why", () => {
    const s = ownerAlertSettings(mainnet);
    expect(s.fast.watched).toEqual([]);
    expect(s.fast.notWatched).toEqual([
      { chainKey: "robinhood", reason: "no number set on a mainnet" },
      { chainKey: "solana", reason: "no number set on a mainnet" },
    ]);
    expect(s.claims.watched).toEqual([]);
    expect(s.claims.notWatched).toHaveLength(2);
    expect(s.apiErrors).toEqual({ notWatched: "no number set while a mainnet chain is served" });
  });

  it("on a mainnet chain a number set by hand is watched", () => {
    const s = ownerAlertSettings({
      ...mainnet,
      RELAYER_FAST_DROP_LAMPORTS: "250000000",
      CLAIMS_ALERT_COUNT: "100",
      API_ERRORS_ALERT_COUNT: "20",
    });
    expect(s.fast.watched).toEqual([{ chainKey: "solana", drop: 250_000_000n, minutes: 60 }]);
    expect(s.fast.notWatched).toEqual([
      { chainKey: "robinhood", reason: "no number set on a mainnet" },
    ]);
    expect(s.claims.watched).toHaveLength(2);
    expect(s.apiErrors).toEqual({ count: 20, minutes: 5 });
  });

  it("the api refuses to start on a number that is not a whole number above zero", () => {
    for (const [name, value] of [
      ["ALERT_REPEAT_MINUTES", "0"],
      ["RELAYER_FAST_DROP_LAMPORTS", "-1"],
      ["CLAIMS_ALERT_COUNT", "abc"],
      ["API_ERRORS_ALERT_MINUTES", "1.5"],
    ] as const) {
      expect(() => loadConfig({ ...TEST_ENV, [name]: value }), name).toThrow();
    }
    expect(() => loadConfig({ ...TEST_ENV, CLAIMS_ALERT_COUNT: "0" })).not.toThrow();
  });
});

describe("at most once every 30 minutes", () => {
  it("the same key waits 30 minutes, also after a restart; sent_at only after Telegram says ok", async () => {
    const a = alerts();
    for (let i = 0; i < 51; i += 1) await claimTx(i);

    failNext = true;
    expect(await a.checkClaims()).toEqual([{ key: "claims:solana-devnet", result: "send-failed" }]);
    expect(await handle.db.select().from(alertsSent)).toEqual([]);

    expect(await a.checkClaims()).toEqual([{ key: "claims:solana-devnet", result: "sent" }]);
    expect(calls).toHaveLength(2);

    later(29);
    for (let i = 0; i < 51; i += 1) await claimTx(100 + i);
    const restarted = alerts();
    expect(await restarted.checkClaims()).toEqual([
      { key: "claims:solana-devnet", result: "repeat" },
    ]);
    expect(calls).toHaveLength(2);

    later(1);
    expect(await restarted.checkClaims()).toEqual([
      { key: "claims:solana-devnet", result: "sent" },
    ]);
    expect(calls).toHaveLength(3);
  });

  it("goes to the private chat, plain text, link previews off, never the token in a log", async () => {
    const a = alerts();
    for (let i = 0; i < 51; i += 1) await claimTx(i);
    failNext = true;
    await a.checkClaims();
    await a.checkClaims();
    expect(calls[1]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = JSON.parse(
      typeof calls[1]?.init.body === "string" ? calls[1].init.body : "{}",
    ) as Record<string, unknown>;
    expect(body["chat_id"]).toBe(CHAT);
    expect(body["parse_mode"]).toBeUndefined();
    expect(body["link_preview_options"]).toEqual({ is_disabled: true });
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain("api.telegram.org");
  });
});

describe("alert 1, relayer money falling fast", () => {
  it("alerts when the highest balance in the window minus now is above the number", async () => {
    const a = alerts();
    await a.recordBalance("solana-devnet", 3n * SOL);
    later(10);
    await a.recordBalance("solana-devnet", 3n * SOL - 100_000_000n);
    // Exactly the number is not above it.
    expect(await a.checkFast()).toEqual([{ key: "relayer_fast:solana-devnet", result: "quiet" }]);
    later(10);
    await a.recordBalance("solana-devnet", 3n * SOL - 100_000_001n);
    expect(await a.checkFast()).toEqual([{ key: "relayer_fast:solana-devnet", result: "sent" }]);
    expect(textOf(calls[0])).toBe(fastMessage(SOLANA_FAST, 100_000_001n, 2_899_999_999n));
  });

  it("a top up never alerts, and a read older than the window does not count", async () => {
    const a = alerts();
    await a.recordBalance("solana-devnet", 1n * SOL);
    later(10);
    await a.recordBalance("solana-devnet", 5n * SOL);
    expect((await a.checkFast())[0]?.result).toBe("quiet");

    later(61);
    await a.recordBalance("solana-devnet", 4n * SOL);
    // The 5 SOL read is 61 minutes old now: only the 4 SOL read is in the window.
    expect((await a.checkFast())[0]?.result).toBe("quiet");
    expect(calls).toHaveLength(0);
  });

  it("keeps the reads 2 hours, then deletes them", async () => {
    const a = alerts();
    await a.recordBalance("solana-devnet", 1n * SOL);
    later(121);
    await a.recordBalance("solana-devnet", 1n * SOL);
    const rows = await handle.db.select().from(relayerBalanceSamples);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.readAt).toEqual(clock);
  });

  it("no read yet, nothing to say", async () => {
    expect((await alerts().checkFast())[0]?.result).toBe("quiet");
  });
});

describe("alert 2, many claims", () => {
  it("counts the relayer's claim transactions in the window, more than the number alerts", async () => {
    const a = alerts();
    for (let i = 0; i < 25; i += 1) await claimTx(i, "claim");
    for (let i = 0; i < 25; i += 1) await claimTx(i, "claim_handle");
    // Not claims, or another chain, or too old: never counted.
    await claimTx(0, "create_drop");
    await claimTx(0, "activate");
    await claimTx(0, "claim", "robinhood-testnet");
    await claimTx(99, "claim", "solana-devnet", new Date(clock.getTime() - 11 * MINUTE));
    expect(await a.checkClaims()).toEqual([{ key: "claims:solana-devnet", result: "quiet" }]);

    await claimTx(50, "claim");
    expect(await a.checkClaims()).toEqual([{ key: "claims:solana-devnet", result: "sent" }]);
    expect(textOf(calls[0])).toBe(claimsMessage("solana-devnet", 51, 10));
  });

  it("the EVM kinds: claim, claimBatch, claimHandle", async () => {
    const a = alerts({ claims: [{ chainKey: "robinhood-testnet", count: 2, minutes: 10 }] });
    await claimTx(0, "claim", "robinhood-testnet");
    await claimTx(1, "claimBatch", "robinhood-testnet");
    await claimTx(2, "claimHandle", "robinhood-testnet");
    await claimTx(3, "createDrop", "robinhood-testnet");
    expect(await a.checkClaims()).toEqual([{ key: "claims:robinhood-testnet", result: "sent" }]);
    expect(textOf(calls[0])).toBe(claimsMessage("robinhood-testnet", 3, 10));
  });
});

describe("alert 3, admin actions", () => {
  let state: Record<string, string>;
  let readFails: boolean;
  const watch = (): AdminWatch => ({
    chainKey: "solana-devnet",
    read: () => (readFails ? Promise.reject(new Error("rpc down")) : Promise.resolve({ ...state })),
  });

  beforeEach(() => {
    state = { paused: "false", default_fee_bps: "100", relayer: "GWuN" };
    readFails = false;
  });

  it("the first read only stores, then every change alerts with old and new, in one message", async () => {
    const a = alerts({ admin: [watch()] });
    expect(await a.checkAdmin()).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await handle.db.select().from(adminSnapshots)).toHaveLength(3);

    expect(await a.checkAdmin()).toEqual([]);

    state["paused"] = "true";
    state["default_fee_bps"] = "200";
    expect(await a.checkAdmin()).toEqual([
      { key: "admin:solana-devnet:paused:true", result: "sent" },
      { key: "admin:solana-devnet:default_fee_bps:200", result: "sent" },
    ]);
    expect(calls).toHaveLength(1);
    expect(textOf(calls[0])).toBe(
      adminMessage("solana-devnet", [
        { field: "paused", old: "false", new: "true" },
        { field: "default_fee_bps", old: "100", new: "200" },
      ]),
    );
  });

  it("two different changes within 30 minutes both alert", async () => {
    const a = alerts({ admin: [watch()] });
    await a.checkAdmin();
    state["paused"] = "true";
    await a.checkAdmin();
    later(5);
    state["paused"] = "false";
    expect(await a.checkAdmin()).toEqual([
      { key: "admin:solana-devnet:paused:false", result: "sent" },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("a guardian pause on Solana is the paused change, the same alert", async () => {
    const key = (n: number) => new Uint8Array(32).fill(n);
    const config = (paused: boolean) =>
      encodeConfigAccount(
        {
          admin: key(1),
          relayer: key(2),
          feeWallet: key(3),
          defaultFeeBps: 100,
          paused,
          chainId: 101n,
          handle: {
            binder: key(4),
            binderRevoked: false,
            minFeeLamports: 0n,
            minFeePerReceiverLamports: 300_000n,
            maxFeeLamports: 500_000_000n,
          },
        },
        254,
      );
    // `guardian_pause` moves the `paused` byte only.
    let bytes = config(false);
    const a = alerts({
      admin: [{ chainKey: "solana", read: () => Promise.resolve(solanaAdminFields(bytes)) }],
    });
    expect(await a.checkAdmin()).toEqual([]);
    bytes = config(true);
    expect(await a.checkAdmin()).toEqual([{ key: "admin:solana:paused:true", result: "sent" }]);
    expect(textOf(calls[0])).toBe(
      adminMessage("solana", [{ field: "paused", old: "false", new: "true" }]),
    );
  });

  it("a failed read changes nothing and sends nothing", async () => {
    const a = alerts({ admin: [watch()] });
    await a.checkAdmin();
    readFails = true;
    state["relayer"] = "NEW";
    expect(await a.checkAdmin()).toEqual([]);
    expect(calls).toHaveLength(0);
    readFails = false;
    expect(await a.checkAdmin()).toEqual([
      { key: "admin:solana-devnet:relayer:NEW", result: "sent" },
    ]);
  });
});

describe("alert 5, api errors", () => {
  it("more than the number of unhandled errors in the window alerts; older ones drop out", async () => {
    const a = alerts();
    for (let i = 0; i < 20; i += 1) a.countApiError();
    expect(await a.checkApiErrors()).toEqual([{ key: "api_errors", result: "quiet" }]);
    later(6);
    a.countApiError();
    // The first 20 are 6 minutes old now.
    expect(await a.checkApiErrors()).toEqual([{ key: "api_errors", result: "quiet" }]);
    for (let i = 0; i < 20; i += 1) a.countApiError();
    expect(await a.checkApiErrors()).toEqual([{ key: "api_errors", result: "sent" }]);
    expect(textOf(calls[0])).toBe(apiErrorsMessage(21, 5));
  });

  it("not watched means no count and no message", async () => {
    const a = alerts({ apiErrors: null });
    for (let i = 0; i < 100; i += 1) a.countApiError();
    expect(await a.checkApiErrors()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("the api error handler counts an unhandled error, never an answer we chose", async () => {
    const harness = await createHarness();
    let counted = 0;
    const app = createApp({ ...harness.deps, onUnhandledError: () => (counted += 1) });
    const extra = new Hono();
    extra.get("/boom", () => {
      throw new Error("secret query text");
    });
    app.route("/test", extra);

    const boom = await app.request("/test/boom");
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({ error: "internal_error" });
    expect(counted).toBe(1);

    await app.request("/api/drops/not-an-address");
    await app.request("/nothing-here");
    expect(counted).toBe(1);
  });
});

describe("the live test by hand", () => {
  it("sends one sample of each text with TEST before the title, writes nothing to alerts_sent", async () => {
    const a = alerts();
    await a.sendSamples();
    const texts = calls.map(textOf);
    expect(texts.map((text) => text?.split("\n")[0])).toEqual([
      "🔴 TEST MONEY FALLING FAST, SOLANA DEVNET",
      "🟠 TEST MANY CLAIMS, SOLANA DEVNET",
      "🔴 TEST ADMIN CHANGE, SOLANA DEVNET",
      "🔴 TEST API ERRORS",
      "🟠 TEST ETH WAITING, ROBINHOOD CHAIN TESTNET",
    ]);
    for (const text of texts) expect(text).not.toMatch(/[-:>→–—]/);
    expect(await handle.db.select().from(alertsSent)).toEqual([]);
  });
});

describe("alert 3, what is read on each chain", () => {
  const key = (n: number) => new Uint8Array(32).fill(n);

  it("Solana: every field of Config, pending_admin included", () => {
    const bytes = encodeConfigAccount(
      {
        admin: key(1),
        relayer: key(2),
        feeWallet: key(3),
        defaultFeeBps: 100,
        paused: true,
        chainId: 103n,
        handle: {
          binder: key(4),
          binderRevoked: false,
          minFeeLamports: 5n,
          minFeePerReceiverLamports: 300_000n,
          maxFeeLamports: 500_000_000n,
        },
      },
      254,
    );
    // pending_admin: after max_fee_lamports, bytes 205 to 237.
    bytes.set(key(6), 205);
    const fields = solanaAdminFields(bytes);
    expect(Object.keys(fields)).toEqual([
      "admin",
      "pending_admin",
      "relayer",
      "fee_wallet",
      "default_fee_bps",
      "paused",
      "binder",
      "binder_revoked",
      "guardian",
      "min_fee_lamports",
      "min_fee_per_receiver_lamports",
      "max_fee_lamports",
    ]);
    expect(pubkeyFromBase58(fields["admin"] ?? "")).toEqual(key(1));
    expect(pubkeyFromBase58(fields["pending_admin"] ?? "")).toEqual(key(6));
    expect(fields["default_fee_bps"]).toBe("100");
    expect(fields["paused"]).toBe("true");
    expect(fields["binder_revoked"]).toBe("false");
    expect(fields["min_fee_per_receiver_lamports"]).toBe("300000");
    expect(fields["max_fee_lamports"]).toBe("500000000");
  });

  it("Robinhood: the live factory, the old factory and the BinderRegistry", async () => {
    const FACTORY = "0x00000000000000000000000000000000000fac75";
    const OLD = "0x00000000000000000000000000000000000fac74";
    const REGISTRY = "0x00000000000000000000000000000000000b1d01";
    const RELAYER = "0x000000000000000000000000000000000000be11";
    const reads: string[] = [];
    const client = {
      readContract: (call: {
        address: string;
        functionName: string;
        args?: readonly unknown[];
      }) => {
        reads.push(
          `${call.address}.${call.functionName}${call.args === undefined ? "" : `(${String(call.args[0])})`}`,
        );
        const values: Record<string, unknown> = {
          paused: false,
          owner: "0x00000000000000000000000000000000000000a1",
          pendingOwner: "0x0000000000000000000000000000000000000000",
          defaultFeeBps: 100,
          feeRecipient: "0x00000000000000000000000000000000000000fe",
          minFeeAmount: 0n,
          minFeePerReceiver: 10_000_000_000_000n,
          maxFeeAmount: 20_000_000_000_000_000n,
          allowedCreator: true,
          binder: "0x00000000000000000000000000000000000000b1",
          revoked: false,
          guardian: "0x0000000000000000000000000000000000000000",
        };
        return Promise.resolve(values[call.functionName]);
      },
    };
    const fields = await evmAdminFields(client, {
      factory: FACTORY,
      oldFactory: OLD,
      registry: REGISTRY,
      relayer: RELAYER,
    });
    expect(Object.keys(fields)).toEqual([
      "factory.paused",
      "factory.owner",
      "factory.pendingOwner",
      "factory.defaultFeeBps",
      "factory.feeRecipient",
      "factory.minFeeAmount",
      "factory.minFeePerReceiver",
      "factory.maxFeeAmount",
      "factory.allowedCreator",
      "oldFactory.paused",
      "oldFactory.owner",
      "registry.binder",
      "registry.revoked",
      "registry.guardian",
      "registry.owner",
    ]);
    expect(fields["factory.allowedCreator"]).toBe("true");
    expect(fields["factory.maxFeeAmount"]).toBe("20000000000000000");
    expect(reads).toContain(`${FACTORY}.allowedCreator(${RELAYER})`);
    expect(reads).toContain(`${OLD}.paused`);
    expect(reads).toContain(`${REGISTRY}.binder`);
  });

  it("Robinhood: a failed view read fails the whole read, so nothing changes", async () => {
    const client = { readContract: () => Promise.reject(new Error("rpc down")) };
    await expect(
      evmAdminFields(client, {
        factory: "0x00000000000000000000000000000000000fac75",
        oldFactory: null,
        registry: null,
        relayer: "0x000000000000000000000000000000000000be11",
      }),
    ).rejects.toThrow();
  });
});

describe("alert 1 gets the relayer alert's reads", () => {
  it("every balance the relayer alert reads goes to onBalance; a failed read does not", async () => {
    const seen: [string, bigint][] = [];
    let fail = false;
    const relayerAlert = createRelayerAlert({
      db: handle.db,
      fetch: fakeFetch,
      now: () => clock,
      token: TOKEN,
      chatId: CHAT,
      relayers: [
        {
          chainKey: "solana-devnet",
          address: SVM_RELAYER,
          limit: 800_000_000n,
          symbol: "SOL",
          decimals: 9,
          readBalance: () => (fail ? Promise.reject(new Error("down")) : Promise.resolve(2n * SOL)),
        },
      ],
      log: (line) => logs.push(line),
      onBalance: (chainKey, balance) => {
        seen.push([chainKey, balance]);
        return Promise.resolve();
      },
    });
    await relayerAlert.check();
    fail = true;
    await relayerAlert.check();
    expect(seen).toEqual([["solana-devnet", 2n * SOL]]);
  });
});

describe("alert 3 with V6", () => {
  // The live testnet entry carries V6 since; the shapes below use made up V6 addresses.
  const F6 = getAddress("0x00000000000000000000000000000000000000f6");
  const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
  const v6 = {
    factoryV6: F6,
    implementationV6: getAddress("0x00000000000000000000000000000000000000d6"),
    binderRegistryV2: REGISTRY_V2,
    deployBlockV6: 140_000_000,
  };
  const RELAYER = "0x000000000000000000000000000000000000be11";
  const LIVE = getDeployedChain("robinhood-testnet");
  /** The live testnet entry without V7; the V7 targets are in `factory-v7-pick.test.ts`. */
  const TESTNET = {
    ...LIVE,
    contracts: { ...LIVE.contracts, factoryV7: null, implementationV7: null, deployBlockV7: null },
  };
  const V5 = getAddress("0xF01FF6f70482955078AF1cF774bd500E9276AFdc");
  const V4 = getAddress("0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4");
  const REGISTRY = getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");

  it("V6 the newest, as before V7: V6 live with its guardian, V5 old", () => {
    expect(evmAdminTargets(TESTNET, RELAYER)).toEqual({
      factory: getAddress("0x53Bf91C6a2e290479F47690Ff0B91805A6a7d8Ba"),
      oldFactory: V5,
      registry: REGISTRY,
      registryV2: getAddress("0x3AFad174a45B82B3A0418D2f39c640C86d76Ea20"),
      pauseGuardian: true,
      relayer: RELAYER,
    });
  });

  it("V5 the newest, as before V6: V5 live, V4 old, no V2 and no guardian", () => {
    const noV6 = {
      factoryV6: null,
      implementationV6: null,
      binderRegistryV2: null,
      deployBlockV6: null,
    };
    const chain = { ...TESTNET, contracts: { ...TESTNET.contracts, ...noV6 } };
    expect(evmAdminTargets(chain, RELAYER)).toEqual({
      factory: V5,
      oldFactory: V4,
      registry: REGISTRY,
      registryV2: null,
      pauseGuardian: false,
      relayer: RELAYER,
    });
  });

  it("V6 on top of V5: V6 live with its guardian, V5 old, both registries", () => {
    const chain = { ...TESTNET, contracts: { ...TESTNET.contracts, ...v6 } };
    expect(evmAdminTargets(chain, RELAYER)).toEqual({
      factory: F6,
      oldFactory: V5,
      registry: REGISTRY,
      registryV2: REGISTRY_V2,
      pauseGuardian: true,
      relayer: RELAYER,
    });
  });

  it("the V6 set alone: no old factory and no old registry", () => {
    const mainnet = getChain("robinhood");
    // Without the V7 record, V6 is the only set.
    const noV7 = { factoryV7: null, implementationV7: null, deployBlockV7: null };
    const chain = { ...mainnet, contracts: { ...mainnet.contracts, ...v6, ...noV7 } };
    if (!isServedEvmChain(chain)) throw new Error("the V6 only chain should be served");
    expect(evmAdminTargets(chain, RELAYER)).toEqual({
      factory: F6,
      oldFactory: null,
      registry: null,
      registryV2: REGISTRY_V2,
      pauseGuardian: true,
      relayer: RELAYER,
    });
  });

  it("the fields: factory.pauseGuardian and registryV2 with pendingOwner", async () => {
    const reads: string[] = [];
    const client = {
      readContract: (call: { address: string; functionName: string }) => {
        reads.push(`${call.address}.${call.functionName}`);
        const values: Record<string, unknown> = {
          paused: false,
          owner: "0x00000000000000000000000000000000000000a1",
          pendingOwner: "0x0000000000000000000000000000000000000000",
          defaultFeeBps: 100,
          feeRecipient: "0x00000000000000000000000000000000000000fe",
          minFeeAmount: 0n,
          minFeePerReceiver: 10_000_000_000_000n,
          maxFeeAmount: 20_000_000_000_000_000n,
          allowedCreator: true,
          pauseGuardian: "0x00000000000000000000000000000000000000c1",
          binder: "0x00000000000000000000000000000000000000b1",
          revoked: false,
          guardian: "0x00000000000000000000000000000000000000c1",
        };
        return Promise.resolve(values[call.functionName]);
      },
    };
    const fields = await evmAdminFields(client, {
      factory: F6,
      oldFactory: null,
      registry: null,
      registryV2: REGISTRY_V2,
      pauseGuardian: true,
      relayer: RELAYER,
    });
    expect(Object.keys(fields)).toEqual([
      "factory.paused",
      "factory.owner",
      "factory.pendingOwner",
      "factory.defaultFeeBps",
      "factory.feeRecipient",
      "factory.minFeeAmount",
      "factory.minFeePerReceiver",
      "factory.maxFeeAmount",
      "factory.allowedCreator",
      "factory.pauseGuardian",
      "registryV2.binder",
      "registryV2.revoked",
      "registryV2.guardian",
      "registryV2.owner",
      "registryV2.pendingOwner",
    ]);
    expect(fields["factory.pauseGuardian"]).toBe("0x00000000000000000000000000000000000000c1");
    expect(reads).toContain(`${F6}.pauseGuardian`);
    expect(reads).toContain(`${REGISTRY_V2}.pendingOwner`);
  });

  it("without the guardian flag no pauseGuardian is read: V5 has none", async () => {
    const reads: string[] = [];
    const client = {
      readContract: (call: { address: string; functionName: string }) => {
        reads.push(call.functionName);
        return Promise.resolve("0");
      },
    };
    await evmAdminFields(client, {
      factory: V5,
      oldFactory: null,
      registry: null,
      relayer: RELAYER,
    });
    expect(reads).not.toContain("pauseGuardian");
  });
});

describe("alert 6, ETH waiting", () => {
  const DROP = "0x0000000000000000000000000000000000d60001";
  const OTHER = "0x0000000000000000000000000000000000d50002";
  const TO = "0x00000000000000000000000000000000000000aa";
  const waitingRow = (drop: string) => ({
    drop,
    to: TO,
    amount: "50000000000000000",
    transactionHash: `0x${"11".repeat(32)}`,
  });
  const watch = (read: EthWaitingWatch["read"]): EthWaitingWatch => ({
    chainKey: "robinhood-testnet",
    read,
  });

  it("the text: title with the chain, the amount, the drop, the refund address, what to do", () => {
    expect(ethWaitingMessage("robinhood-testnet", waitingRow(DROP))).toBe(
      [
        "🟠 ETH WAITING, ROBINHOOD CHAIN TESTNET",
        "",
        "0.05 ETH",
        `Drop ${DROP}`,
        `Refund address ${TO}`,
        "",
        "The refund address did not take the ETH. It waits in the drop.",
        "",
        "Tell the sender. Once that address can take ETH, anyone can send it on with sweep.",
      ].join("\n"),
    );
  });

  it("each drop alerts once and never again, not after 30 minutes either", async () => {
    let rows = [waitingRow(DROP)];
    const a = alerts({ ethWaiting: watch(() => Promise.resolve(rows)) });
    expect(await a.checkEthWaiting()).toEqual([
      { key: `eth_waiting:robinhood-testnet:${DROP}`, result: "sent" },
    ]);
    later(120);
    rows = [waitingRow(DROP), waitingRow(OTHER)];
    expect(await a.checkEthWaiting()).toEqual([
      { key: `eth_waiting:robinhood-testnet:${DROP}`, result: "repeat" },
      { key: `eth_waiting:robinhood-testnet:${OTHER}`, result: "sent" },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("a failed send is tried again at the next check", async () => {
    const a = alerts({ ethWaiting: watch(() => Promise.resolve([waitingRow(DROP)])) });
    failNext = true;
    expect((await a.checkEthWaiting())[0]?.result).toBe("send-failed");
    later(1);
    expect((await a.checkEthWaiting())[0]?.result).toBe("sent");
  });

  it("a failed indexer read sends nothing and changes nothing", async () => {
    const a = alerts({ ethWaiting: watch(() => Promise.reject(new Error("down"))) });
    expect(await a.checkEthWaiting()).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await handle.db.select().from(alertsSent)).toEqual([]);
  });

  it("not watched without the indexer: no read, nothing sent", async () => {
    expect(await alerts().checkEthWaiting()).toEqual([]);
  });
});
