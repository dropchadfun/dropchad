-- 0003_pay_cursor — where the payer got to.
--
-- The payer walks the leaves once, in order, in batches of MAX_BATCH (20). This column is how far
-- it has walked. It is a **position**, not a count: `paid_count` says how many Claimed events we
-- saw, and those two are different numbers whenever somebody claimed a leaf themselves.
--
-- Why a cursor at all, instead of asking the chain every pass: `isClaimed` is one call per leaf,
-- and a 10,000 leaf drop would mean 10,000 calls on every single pass. With the cursor each leaf
-- is looked at once. Correctness does not depend on it either way — makes the contract skip
-- an index that is already claimed, so a leaf that is somehow visited twice costs nothing.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS next_claim_index INTEGER NOT NULL DEFAULT 0;
