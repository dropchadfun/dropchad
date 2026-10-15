-- 0001_init — profiles, sessions and the short lived oauth state.
--
-- Plain Postgres SQL on purpose. PGlite **is** Postgres, so this same file runs unchanged against
-- the server Postgres later. There is no dialect to port and no generator output to trust.
--
-- Rules from the design that this schema enforces:
--   * the identity is the **numeric** X user id, never the handle
--   * no X access token is stored anywhere, so there is no column for one
--   * a session id is never stored in the clear, only its keyed hash

CREATE TABLE IF NOT EXISTS profiles (
  -- The numeric X user id, as text. It does not fit a JS number and it is never the handle.
  x_user_id         TEXT PRIMARY KEY,
  -- Display only. Handles change and can be recycled, so this is refreshed on every login.
  handle            TEXT        NOT NULL,
  display_name      TEXT        NOT NULL,
  profile_image_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  -- HMAC-SHA256(SESSION_SECRET, session id). The opaque id itself only ever exists in the cookie,
  -- so a dump of this table is not a set of usable sessions.
  id              TEXT PRIMARY KEY,
  x_user_id       TEXT        NOT NULL REFERENCES profiles (x_user_id) ON DELETE CASCADE,
  -- Same treatment for the double submit CSRF token.
  csrf_token_hash TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_x_user_id_idx ON sessions (x_user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  -- HMAC of the `state` value. Single use: the row is deleted the moment it is read.
  state_hash        TEXT PRIMARY KEY,
  -- The PKCE code verifier. This one cannot be hashed, the token exchange needs the value back.
  -- It lives for ten minutes and is deleted on use.
  code_verifier     TEXT        NOT NULL,
  -- Binds the state to the browser that started the login, so a state stolen from one browser is
  -- useless in another.
  pre_session_hash  TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states (expires_at);
