-- 0015_commitment_blind —. Every drop made
-- since 21b hides its X id in `creator_commitment` behind 32 random bytes the api makes per drop:
-- `keccak256(abi.encode(xUserId, nonce, blind))`. The blind is kept here and never served or
-- logged. NULL is a drop made before 21b, with the unblinded commitment.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS commitment_blind TEXT;
ALTER TABLE drops ADD CONSTRAINT drops_commitment_blind_check
  CHECK (commitment_blind IS NULL OR commitment_blind ~ '^0x[0-9a-f]{64}$');
