/**
 * The Telegram switch. Off unless `TELEGRAM_POSTS=on` and both the token
 * and the channel are set; on with an empty value stays off and the start log says why, the api
 * still starts. The reason never holds a value.
 */
import type { Config } from "../config.js";

export type TelegramSettings =
  | { readonly on: true; readonly token: string; readonly channelId: string }
  | { readonly on: false; readonly reason: string };

export function telegramSettings(
  config: Pick<Config, "TELEGRAM_POSTS" | "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHANNEL_ID">,
): TelegramSettings {
  if (config.TELEGRAM_POSTS !== "on") return { on: false, reason: "TELEGRAM_POSTS is off" };
  const token = config.TELEGRAM_BOT_TOKEN ?? "";
  const channelId = config.TELEGRAM_CHANNEL_ID ?? "";
  if (token.length === 0 || channelId.length === 0) {
    return { on: false, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is empty" };
  }
  return { on: true, token, channelId };
}
