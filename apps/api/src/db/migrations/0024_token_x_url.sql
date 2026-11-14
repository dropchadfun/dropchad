-- 0024_token_x_url — a token drop's X link.
--
-- The token check's `xUrl` as it read it at create: the metadata JSON's `twitter` field, kept only
-- after the link checks and rebuilt on `x.com`. NULL on a native drop, on Robinhood, on a
-- token with no usable link, and on every token drop made before this migration.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS token_x_url TEXT;
