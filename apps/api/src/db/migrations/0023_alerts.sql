-- 0023_alerts — the owner alerts.
--
-- `alerts_sent`: when each alert key was last sent, so the same alert goes out at most once every
-- `ALERT_REPEAT_MINUTES`, also across a restart. Written only after Telegram answered ok.
-- `relayer_balance_samples`: the relayer balance reads, kept 2 hours, for alert 1.
-- `admin_snapshots`: the last value of every admin field read, for alert 3.

CREATE TABLE IF NOT EXISTS alerts_sent (
  key TEXT PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS relayer_balance_samples (
  chain_key TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL,
  balance NUMERIC NOT NULL,
  PRIMARY KEY (chain_key, read_at)
);

CREATE TABLE IF NOT EXISTS admin_snapshots (
  chain_key TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_key, field)
);
