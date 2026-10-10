-- 0006_settle — the end of a Solana drop, written down.
--
-- On Solana the relayer can refund, cancel and close a drop, and
-- `close_drop` is what returns the bitmap rent it paid at creation. The worker's `settle` job
-- does those two steps after the deadline and records them here. `settle_tx_hash` is the refund
-- or the cancel, `close_tx_hash` the close. On an EVM row both stay null: that relayer sends four
-- calls and no fifth, and the refund there is anyone's to trigger.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS settle_tx_hash TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS close_tx_hash TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
