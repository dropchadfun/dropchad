-- 0022_relayer_alerts — the relayer low balance alert
-- "The relayer low balance alert".
--
-- One row per watched chain. `low` after the low message was sent to the owner, `ok` after the
-- ok message. No row counts as `ok`. Kept here so a restart or a deploy does not warn again.

CREATE TABLE IF NOT EXISTS relayer_alerts (
  chain_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'low')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
