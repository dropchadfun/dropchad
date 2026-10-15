/**
 * The Telegram switch: off by default; on with an empty token or channel
 * stays off and says why, the api still starts; the token is never printed.
 * "The Telegram bot token": `.env.example` has the names only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, redactedConfig } from "../src/config.js";
import { telegramSettings } from "../src/telegram/settings.js";
import { TEST_ENV } from "./harness.js";

const TOKEN = "123456:sample-token-not-real";

describe("the switch", () => {
  it("is off by default", () => {
    expect(telegramSettings(loadConfig({ ...TEST_ENV }))).toEqual({
      on: false,
      reason: "TELEGRAM_POSTS is off",
    });
  });

  it("on with an empty token or channel stays off, and says why", () => {
    for (const env of [
      { TELEGRAM_POSTS: "on" },
      { TELEGRAM_POSTS: "on", TELEGRAM_BOT_TOKEN: TOKEN },
      { TELEGRAM_POSTS: "on", TELEGRAM_CHANNEL_ID: "@dropchad" },
      { TELEGRAM_POSTS: "on", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHANNEL_ID: "@dropchad" },
    ]) {
      expect(telegramSettings(loadConfig({ ...TEST_ENV, ...env }))).toEqual({
        on: false,
        reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is empty",
      });
    }
  });

  it("on with both is on", () => {
    const env = {
      TELEGRAM_POSTS: "on",
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_CHANNEL_ID: "@dropchad",
    };
    expect(telegramSettings(loadConfig({ ...TEST_ENV, ...env }))).toEqual({
      on: true,
      token: TOKEN,
      channelId: "@dropchad",
    });
  });

  it("a value other than on or off stops the start, naming the variable", () => {
    expect(() => loadConfig({ ...TEST_ENV, TELEGRAM_POSTS: "yes" })).toThrow(/TELEGRAM_POSTS/);
  });

  it("the printed config never holds the token or the channel", () => {
    const env = { TELEGRAM_POSTS: "on", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHANNEL_ID: "-1001" };
    const printed = redactedConfig(loadConfig({ ...TEST_ENV, ...env }));
    expect(printed["TELEGRAM_POSTS"]).toBe("on");
    expect(printed["TELEGRAM_BOT_TOKEN"]).toBe("<set>");
    expect(printed["TELEGRAM_CHANNEL_ID"]).toBe("<set>");
    expect(JSON.stringify(printed)).not.toContain(TOKEN);
    expect(redactedConfig(loadConfig({ ...TEST_ENV }))["TELEGRAM_BOT_TOKEN"]).toBe("<unset>");
  });
});

describe(".env.example", () => {
  it("has the three names, the switch off and no values", () => {
    const example = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
    expect(example).toMatch(/^TELEGRAM_POSTS=off$/m);
    expect(example).toMatch(/^TELEGRAM_BOT_TOKEN=$/m);
    expect(example).toMatch(/^TELEGRAM_CHANNEL_ID=$/m);
  });
});
