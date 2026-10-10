-- 0002_write_side — our own record of a drop, the job queue, and what the relayer spent.
--
-- **This database is intent and progress. It is never the truth about the chain.**
-- The indexer is the truth. A row here says "we asked for this and we
-- got this far"; a row in the indexer says "this happened". `GET /api/drops/:address` shows both
-- and always says which is which.
--
-- Plain Postgres SQL, like 0001, so it runs unchanged against a server Postgres later.
--
-- Wei amounts are NUMERIC(78, 0): 78 digits holds every uint256 exactly, and NUMERIC is exact,
-- never floating point. They come back out of the driver as decimal strings and are turned into
-- bigint at the edge, the same rule the HTTP boundary already follows.

CREATE TABLE IF NOT EXISTS drops (
  -- The clone address, lowercase. Predicted before creation and confirmed against the
  -- `DropCreated` event before this row is written, so it is never a guess.
  address            TEXT PRIMARY KEY,
  chain_id           INTEGER     NOT NULL,

  -- Who asked for it. The numeric X user id. ON DELETE RESTRICT because a
  -- drop that exists on chain must not lose its creator when a profile row is tidied up.
  x_user_id          TEXT        NOT NULL REFERENCES profiles (x_user_id) ON DELETE RESTRICT,

  -- The salt inputs. `nonce` is per X id, so the same creator can have many
  -- drops and each gets its own address.
  nonce              BIGINT      NOT NULL,
  creator_commitment TEXT        NOT NULL,
  salt               TEXT        NOT NULL,

  -- Everything below is what went on chain. Read back out of `DropCreated`, never assumed.
  asset              TEXT        NOT NULL,   -- 0x000...0 means native ETH
  merkle_root        TEXT        NOT NULL,
  manifest_hash      TEXT        NOT NULL,   -- keccak256 of manifest_json
  manifest_json      TEXT        NOT NULL,   -- the canonical bytes the hash was taken over
  total_entitlements NUMERIC(78, 0) NOT NULL,
  fee_amount         NUMERIC(78, 0) NOT NULL,
  gross_required     NUMERIC(78, 0) NOT NULL,
  leaf_count         INTEGER     NOT NULL,
  refund_recipient   TEXT        NOT NULL,
  funding_deadline   BIGINT      NOT NULL,   -- unix seconds, absolute
  claim_period       INTEGER     NOT NULL,   -- seconds, relative.

  -- Ours only. Never in the manifest, never in the hash, provable by nobody.
  title              TEXT,
  meme_image_url     TEXT,

  -- Our progress, not the chain's. 'created' -> 'funded' -> 'active' -> 'paying' -> 'finished',
  -- plus 'failed'. The chain's own status is the indexer's business.
  state              TEXT        NOT NULL DEFAULT 'created',
  paid_count         INTEGER     NOT NULL DEFAULT 0,
  -- Leaf indexes that could not be paid, for example a recipient contract that rejects ETH.
  -- one failed native send reverts a whole batch, so a bad index is isolated and skipped.
  failed_indexes     JSONB       NOT NULL DEFAULT '[]'::jsonb,

  create_tx_hash     TEXT        NOT NULL,
  activate_tx_hash   TEXT,
  last_tx_hash       TEXT,
  last_error         TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The per user create rate limit counts rows in this window, so it needs both columns.
CREATE INDEX IF NOT EXISTS drops_x_user_created_idx ON drops (x_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS drops_state_idx ON drops (state);

-- The queue.
--
-- A table, not pg-boss: pg-boss speaks the Postgres **wire protocol** and uses advisory locks and
-- LISTEN/NOTIFY, and PGlite has no wire server, so it would force Docker Postgres into local dev
-- today. This is plain SQL that runs unchanged on a server Postgres later, exactly like the
-- migrations. All state is rows, so a restart resumes where the worker stopped.
CREATE TABLE IF NOT EXISTS drop_jobs (
  id           BIGSERIAL PRIMARY KEY,
  drop_address TEXT        NOT NULL REFERENCES drops (address) ON DELETE CASCADE,
  -- 'watch_funding' | 'activate' | 'pay'
  kind         TEXT        NOT NULL,
  -- 'ready' | 'running' | 'done' | 'failed'
  state        TEXT        NOT NULL DEFAULT 'ready',
  -- Backoff lives here, not in memory. A restart honours it.
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One job of a kind per drop. Enqueueing twice is a no-op, not a second worker.
  UNIQUE (drop_address, kind)
);

CREATE INDEX IF NOT EXISTS drop_jobs_ready_idx ON drop_jobs (state, run_after);

-- Every transaction the relayer ever sent. The hash is public, the key is not and is never here.
CREATE TABLE IF NOT EXISTS relayer_txs (
  tx_hash             TEXT PRIMARY KEY,
  -- 'createDrop' | 'activate' | 'claim' | 'claimBatch'. There is no fifth kind, and the relayer
  -- has no code path that could produce one.
  kind                TEXT        NOT NULL,
  chain_id            INTEGER     NOT NULL,
  drop_address        TEXT,
  to_address          TEXT        NOT NULL,
  nonce               BIGINT      NOT NULL,
  gas_limit           NUMERIC(78, 0) NOT NULL,
  gas_used            NUMERIC(78, 0),
  effective_gas_price NUMERIC(78, 0),
  cost_wei            NUMERIC(78, 0),
  -- 'sent' | 'success' | 'reverted'
  status              TEXT        NOT NULL DEFAULT 'sent',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS relayer_txs_drop_idx ON relayer_txs (drop_address);

-- The daily gas budget.
--
-- `wei_spent` is charged with the **worst case** cost of a transaction before it is sent
-- (gas limit x max fee), then corrected by the difference once the receipt gives the real cost.
-- Charging first is what makes the cap a cap: a burst of sends can never outrun the accounting.
CREATE TABLE IF NOT EXISTS relayer_spend (
  day        DATE           NOT NULL,   -- UTC
  chain_id   INTEGER        NOT NULL,
  wei_spent  NUMERIC(78, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (day, chain_id)
);
