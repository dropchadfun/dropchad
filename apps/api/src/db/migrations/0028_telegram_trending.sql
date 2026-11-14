-- 0028_telegram_trending — the pinned trending post in the Telegram channel
--
-- One row per network, so a restart edits the same message. `posted_at` is the last
-- `sendMessage` try, written before the call: a new post waits 24 hours after it. `text_hash` is
-- the text last accepted by Telegram. `last_error` holds a status, never a url or Telegram's words.

CREATE TABLE IF NOT EXISTS telegram_trending (
  network TEXT PRIMARY KEY CHECK (network IN ('testnet', 'mainnet')),
  message_id BIGINT,
  text_hash TEXT,
  posted_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  last_error TEXT
);
