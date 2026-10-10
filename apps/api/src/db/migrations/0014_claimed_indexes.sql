-- 0014_claimed_indexes —. `close_drop` deletes a Solana drop's bitmap,
-- the boards read the claimed leaves from it. The settle job keeps a copy
-- here first: read at `finalized` once the claim deadline has passed, before our `refund` or
-- `cancel_unfunded`, for every Solana drop. NULL means no copy was taken, never "none claimed".

ALTER TABLE drops ADD COLUMN IF NOT EXISTS claimed_indexes JSONB;
