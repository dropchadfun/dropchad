/**
 * The trending post switch: off by default, apart from
 * `TELEGRAM_POSTS`; on with an empty token or channel stays off and says why, the api still
 * starts; the network from the mainnet site test. `.env.example` has the name only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, redactedConfig } from "../src/config.js";
import { telegramSettings, telegramTrendingSettings } from "../src/telegram/settings.js";
import { trendingNetwork } from "../src/telegram/trending-sender.js";
import { TEST_ENV } from "./harness.js";

const TOKEN = "123456:sample-token-not-real";
const BOTH = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHANNEL_ID: "@dropchad" };

describe("the switch", () => {
  it("is off by default", () => {
    expect(telegramTrendingSettings(loadConfig({ ...TEST_ENV, ...BOTH }))).toEqual({
      on: false,
      reason: "TELEGRAM_TRENDING is off",
    });
  });

  it("on with an empty token or channel stays off, and says why", () => {
    for (const env of [
      { TELEGRAM_TRENDING: "on" },
      { TELEGRAM_TRENDING: "on", TELEGRAM_BOT_TOKEN: TOKEN },
      { TELEGRAM_TRENDING: "on", TELEGRAM_CHANNEL_ID: "@dropchad" },
      { TELEGRAM_TRENDING: "on", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHANNEL_ID: "@dropchad" },
    ]) {
      expect(telegramTrendingSettings(loadConfig({ ...TEST_ENV, ...env }))).toEqual({
        on: false,
        reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is empty",
      });
    }
  });

  it("on with both is on, and does not need TELEGRAM_POSTS", () => {
    const config = loadConfig({ ...TEST_ENV, ...BOTH, TELEGRAM_TRENDING: "on" });
    expect(telegramTrendingSettings(config)).toEqual({
      on: true,
      token: TOKEN,
      channelId: "@dropchad",
    });
    expect(telegramSettings(config).on).toBe(false);
  });

  it("TELEGRAM_POSTS on does not turn trending on", () => {
    const config = loadConfig({ ...TEST_ENV, ...BOTH, TELEGRAM_POSTS: "on" });
    expect(telegramTrendingSettings(config).on).toBe(false);
    expect(telegramSettings(config).on).toBe(true);
  });

  it("a value other than on or off stops the start, naming the variable", () => {
    expect(() => loadConfig({ ...TEST_ENV, TELEGRAM_TRENDING: "yes" })).toThrow(
      /TELEGRAM_TRENDING/,
    );
  });

  it("the printed config shows the switch, never the token", () => {
    const printed = redactedConfig(loadConfig({ ...TEST_ENV, ...BOTH, TELEGRAM_TRENDING: "on" }));
    expect(printed["TELEGRAM_TRENDING"]).toBe("on");
    expect(JSON.stringify(printed)).not.toContain(TOKEN);
  });
});

describe("the network", () => {
  const site = (CHAIN_KEY: string, SOLANA_CHAIN_KEY: string) =>
    trendingNetwork({ CHAIN_KEY, SOLANA_CHAIN_KEY });

  it("is mainnet on a mainnet site: either configured chain is a mainnet chain", () => {
    expect(site("robinhood-testnet", "solana")).toBe("mainnet");
    expect(site("robinhood", "solana-devnet")).toBe("mainnet");
    expect(site("robinhood", "solana")).toBe("mainnet");
  });

  it("is testnet when both configured chains are testnets", () => {
    expect(site("robinhood-testnet", "solana-devnet")).toBe("testnet");
  });

  it("the api start passes the whole config, not CHAIN_KEY alone", () => {
    const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
    expect(index).toContain("network: trendingNetwork(config),");
    expect(index).not.toContain("trendingNetwork(config.CHAIN_KEY)");
  });
});

describe(".env.example", () => {
  it("has the name, the switch off", () => {
    const example = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
    expect(example).toMatch(/^TELEGRAM_TRENDING=off$/m);
  });
});
