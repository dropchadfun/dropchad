-- 0018_token_drops — a token drop's row.
--
-- The mint goes in the existing `asset` column. These hold what the token check read at create
-- (the token program, decimals, name and ticker, untrusted text cut to 32 and 10 characters),
-- the vault the chain made, and the fee of: the SOL fee and the account budget in lamports
-- as read back from the `Drop` account, the usd tier and the SOL price it was worked out at.
-- All NULL on a native drop. A token drop never gets `price_usd`.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS token_program TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS token_decimals INTEGER;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS token_name TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS token_symbol TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS vault TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS sol_fee_lamports NUMERIC;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS account_budget_lamports NUMERIC;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS fee_tier_usd NUMERIC;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS fee_sol_price_usd NUMERIC;
