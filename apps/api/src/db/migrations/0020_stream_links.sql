-- 0020_stream_links — streamer connect, Kick and Twitch.
--
-- A signed in chad links a Kick or Twitch account only to prove they own it. One row per platform
-- per X id; a platform account belongs to one X id only, the unique index. The platform's user id
-- is the identity; `channel` is the name the link is built from (the Kick `slug`, the Twitch
-- `login`), refreshed on the next connect. No token is ever stored. The row goes with the profile.
--
-- The OAuth state row learns which login it belongs to: `x` for the X login, as every row before
-- this migration, or `kick` / `twitch`, which also keep the X id of the session that started it.

ALTER TABLE oauth_states
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'x'
  CHECK (provider IN ('x', 'kick', 'twitch'));
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS x_user_id TEXT;

CREATE TABLE IF NOT EXISTS stream_links (
  x_user_id TEXT NOT NULL REFERENCES profiles (x_user_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('kick', 'twitch')),
  platform_user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (x_user_id, platform)
);

CREATE UNIQUE INDEX IF NOT EXISTS stream_links_platform_user_idx
  ON stream_links (platform, platform_user_id);
