-- 0019_token_launchpad — where a token drop's token launched.
--
-- The token check's `launchpad` as it read it at create: `pump.fun` only from the sign written in
-- never a guess. NULL on a native drop, on a token with no sign, and
-- on every token drop made before this migration.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS token_launchpad TEXT;
