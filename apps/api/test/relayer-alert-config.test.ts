/**
 * The relayer alert switch and what it watches: off by default; it needs
 * the bot token and a private chat id, never the channel; it does not need `TELEGRAM_POSTS`; the
 * testnet limits 0.8 SOL and 0.001 ETH, on a mainnet chain set by hand or not watched; the token
 * and the chat id never printed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, redactedConfig } from "../src/config.js";
import { relayerAlertSettings, watchedRelayers } from "../src/telegram/relayer-alert.js";
import { TEST_ENV } from "./harness.js";

const TOKEN = "123456:sample-token-not-real";
const CHAT = "987654321";
const EVM_RELAYER = "0x00000000000000000000000000000000000a1e47";
const SVM_RELAYER = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";

const settingsOf = (env: Record<string, string>) =>
  relayerAlertSettings(loadConfig({ ...TEST_ENV, ...env }));

describe("the switch", () => {
  it("is off by default", () => {
    expect(settingsOf({})).toEqual({ on: false, reason: "RELAYER_ALERT is off" });
  });

  it("on with an empty token or chat id stays off, and says why", () => {
    for (const env of [
      { RELAYER_ALERT: "on" },
      { RELAYER_ALERT: "on", TELEGRAM_BOT_TOKEN: TOKEN },
      { RELAYER_ALERT: "on", RELAYER_ALERT_CHAT_ID: CHAT },
      { RELAYER_ALERT: "on", TELEGRAM_BOT_TOKEN: "", RELAYER_ALERT_CHAT_ID: CHAT },
      { RELAYER_ALERT: "on", TELEGRAM_BOT_TOKEN: TOKEN, RELAYER_ALERT_CHAT_ID: "" },
    ]) {
      expect(settingsOf(env)).toEqual({
        on: false,
        reason: "TELEGRAM_BOT_TOKEN or RELAYER_ALERT_CHAT_ID is empty",
      });
    }
  });

  it("a channel, a group or anything not a positive whole number stays off", () => {
    for (const chat of [
      "@dropchad",
      "-1001234567890",
      "-5",
      "0",
      "01",
      "12a",
      " 12",
      "1".repeat(17),
    ]) {
      const settings = settingsOf({
        RELAYER_ALERT: "on",
        TELEGRAM_BOT_TOKEN: TOKEN,
        RELAYER_ALERT_CHAT_ID: chat,
      });
      expect(settings).toEqual({
        on: false,
        reason: "RELAYER_ALERT_CHAT_ID is not a private chat id",
      });
    }
  });

  it("the chat id of the channel stays off, even a positive one", () => {
    expect(
      settingsOf({
        RELAYER_ALERT: "on",
        TELEGRAM_BOT_TOKEN: TOKEN,
        RELAYER_ALERT_CHAT_ID: CHAT,
        TELEGRAM_CHANNEL_ID: CHAT,
      }),
    ).toEqual({ on: false, reason: "RELAYER_ALERT_CHAT_ID is the channel" });
  });

  it("on with the token and a private chat id is on, with the channel posts off", () => {
    expect(
      settingsOf({
        RELAYER_ALERT: "on",
        TELEGRAM_POSTS: "off",
        TELEGRAM_BOT_TOKEN: TOKEN,
        RELAYER_ALERT_CHAT_ID: CHAT,
        TELEGRAM_CHANNEL_ID: "@dropchad",
      }),
    ).toEqual({ on: true, token: TOKEN, chatId: CHAT });
  });

  it("a reason never holds the token or the chat id", () => {
    for (const chat of ["@dropchad", CHAT]) {
      const settings = settingsOf({
        RELAYER_ALERT: "on",
        TELEGRAM_BOT_TOKEN: TOKEN,
        RELAYER_ALERT_CHAT_ID: chat,
        TELEGRAM_CHANNEL_ID: CHAT,
      });
      expect(settings.on).toBe(false);
      expect(JSON.stringify(settings)).not.toContain(TOKEN);
      expect(JSON.stringify(settings)).not.toContain(chat);
    }
  });

  it("a value other than on or off stops the start, naming the variable", () => {
    expect(() => loadConfig({ ...TEST_ENV, RELAYER_ALERT: "yes" })).toThrow(/RELAYER_ALERT/);
  });

  it("a limit that is not whole digits stops the start, naming the variable", () => {
    expect(() => loadConfig({ ...TEST_ENV, RELAYER_ALERT_MIN_LAMPORTS: "0.8" })).toThrow(
      /RELAYER_ALERT_MIN_LAMPORTS/,
    );
    expect(() => loadConfig({ ...TEST_ENV, RELAYER_ALERT_MIN_WEI: "1e15" })).toThrow(
      /RELAYER_ALERT_MIN_WEI/,
    );
  });

  it("the printed config never holds the token or the chat id", () => {
    const env = { RELAYER_ALERT: "on", TELEGRAM_BOT_TOKEN: TOKEN, RELAYER_ALERT_CHAT_ID: CHAT };
    const printed = redactedConfig(loadConfig({ ...TEST_ENV, ...env }));
    expect(printed["RELAYER_ALERT"]).toBe("on");
    expect(printed["RELAYER_ALERT_CHAT_ID"]).toBe("<set>");
    expect(JSON.stringify(printed)).not.toContain(TOKEN);
    expect(JSON.stringify(printed)).not.toContain(CHAT);
    expect(redactedConfig(loadConfig({ ...TEST_ENV }))["RELAYER_ALERT_CHAT_ID"]).toBe("<unset>");
  });
});

describe("what is watched", () => {
  const testnet = {
    CHAIN_KEY: "robinhood-testnet",
    SOLANA_CHAIN_KEY: "solana-devnet",
    RELAYER_ADDRESS: EVM_RELAYER,
    SOLANA_RELAYER_ADDRESS: SVM_RELAYER,
    RELAYER_ALERT_MIN_LAMPORTS: undefined,
    RELAYER_ALERT_MIN_WEI: undefined,
  };

  it("on the testnets both relayers, 0.8 SOL and 0.001 ETH by default", () => {
    expect(watchedRelayers(testnet)).toEqual({
      watched: [
        {
          chainKey: "robinhood-testnet",
          address: EVM_RELAYER,
          limit: 1_000_000_000_000_000n,
          symbol: "ETH",
          decimals: 18,
        },
        {
          chainKey: "solana-devnet",
          address: SVM_RELAYER,
          limit: 800_000_000n,
          symbol: "SOL",
          decimals: 9,
        },
      ],
      notWatched: [],
    });
  });

  it("a limit set by hand counts", () => {
    const { watched } = watchedRelayers({
      ...testnet,
      RELAYER_ALERT_MIN_LAMPORTS: "2000000000",
      RELAYER_ALERT_MIN_WEI: "5000000000000000",
    });
    expect(watched.map((w) => w.limit)).toEqual([5_000_000_000_000_000n, 2_000_000_000n]);
  });

  it("a chain with no relayer address is not watched, and says why", () => {
    expect(
      watchedRelayers({
        ...testnet,
        RELAYER_ADDRESS: undefined,
        SOLANA_RELAYER_ADDRESS: undefined,
      }),
    ).toEqual({
      watched: [],
      notWatched: [
        { chainKey: "robinhood-testnet", reason: "no relayer address" },
        { chainKey: "solana-devnet", reason: "no relayer address" },
      ],
    });
  });

  it("on a mainnet chain the default does not count: no limit by hand, not watched", () => {
    const mainnet = { ...testnet, CHAIN_KEY: "robinhood", SOLANA_CHAIN_KEY: "solana" };
    expect(watchedRelayers(mainnet)).toEqual({
      watched: [],
      notWatched: [
        { chainKey: "robinhood", reason: "no limit set on a mainnet" },
        { chainKey: "solana", reason: "no limit set on a mainnet" },
      ],
    });
  });

  it("on a mainnet chain a limit by hand is watched", () => {
    const { watched, notWatched } = watchedRelayers({
      ...testnet,
      CHAIN_KEY: "robinhood",
      SOLANA_CHAIN_KEY: "solana",
      RELAYER_ALERT_MIN_LAMPORTS: "3000000000",
    });
    expect(watched).toEqual([
      {
        chainKey: "solana",
        address: SVM_RELAYER,
        limit: 3_000_000_000n,
        symbol: "SOL",
        decimals: 9,
      },
    ]);
    expect(notWatched).toEqual([{ chainKey: "robinhood", reason: "no limit set on a mainnet" }]);
  });
});

describe(".env.example", () => {
  it("has the names, the switch off and no chat id", () => {
    const example = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
    expect(example).toMatch(/^RELAYER_ALERT=off$/m);
    expect(example).toMatch(/^RELAYER_ALERT_CHAT_ID=$/m);
    expect(example).toMatch(/^#? ?RELAYER_ALERT_MIN_LAMPORTS=[0-9]*$/m);
    expect(example).toMatch(/^#? ?RELAYER_ALERT_MIN_WEI=[0-9]*$/m);
  });
});
