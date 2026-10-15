-- 0010_handle_mode — handle drops, the X id cache, the handle leaves and the bindings.

-- The mode is the api's, the chain does not know it. Every drop that exists
-- today is an address drop, so the default is `address`; the create path always writes it.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'address';
ALTER TABLE drops ADD CONSTRAINT drops_mode_check CHECK (mode IN ('address', 'handle'));

-- Every X account we ever resolved. Separate from `profiles`: most receivers never sign
-- in. The id is the numeric X user id as text, never the handle.
CREATE TABLE IF NOT EXISTS x_users (
  x_user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  profile_image_url TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A pasted handle, lowercased, resolved once. `resolved_at` is there so the refresh rule
-- for a recycled handle can be decided without another migration.
CREATE TABLE IF NOT EXISTS x_handle_lookups (
  handle_lower TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per handle leaf, so "which drops have a leaf for this X id" is one index read. The
-- manifest JSON holds the same numbers and stays the published source.
CREATE TABLE IF NOT EXISTS drop_handle_leaves (
  drop_address TEXT NOT NULL REFERENCES drops (address) ON DELETE CASCADE,
  leaf_index INTEGER NOT NULL,
  x_user_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  PRIMARY KEY (drop_address, leaf_index)
);
CREATE INDEX IF NOT EXISTS drop_handle_leaves_x_user_idx ON drop_handle_leaves (x_user_id);

-- One binding per leaf and one per X id per drop, enforced here and not only in
-- code. The receiver's wallet message and signature are kept on purpose: step 4 of the leak
-- playbook checks every handle claim against what the X id really signed. Nothing here is
-- secret; the binder signature goes on chain anyway.
CREATE TABLE IF NOT EXISTS handle_bindings (
  drop_address TEXT NOT NULL REFERENCES drops (address) ON DELETE CASCADE,
  leaf_index INTEGER NOT NULL,
  x_user_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  binder_signature TEXT NOT NULL,
  wallet_message TEXT NOT NULL,
  wallet_signature TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'bound'
    CONSTRAINT handle_bindings_state_check CHECK (state IN ('bound', 'submitted', 'paid', 'failed')),
  claim_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_address, leaf_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS handle_bindings_drop_x_user_key ON handle_bindings (drop_address, x_user_id);
