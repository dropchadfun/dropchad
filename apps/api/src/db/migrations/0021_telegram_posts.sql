-- 0021_telegram_posts — Telegram channel posts for new drops
--
-- One row per drop, the primary key, so a drop is posted at most once. The worker adds it when a
-- handle drop goes live and the switch is on; the sender loop moves it on. `sending` is set before
-- the call, so a restart in the middle never sends twice: such a row becomes `failed`.
-- `last_error` holds a status, never a url: the bot token is in the url.

CREATE TABLE IF NOT EXISTS telegram_posts (
  drop_address TEXT PRIMARY KEY REFERENCES drops (address) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  message_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS telegram_posts_ready_idx ON telegram_posts (state, run_after);
