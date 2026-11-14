-- 0026_binding_valid_until — binding v2.7.
--
-- `binding_valid_until`: the latest `validUntil` the worker signed for this binding, unix seconds,
-- written before the signature leaves and never lowered. A failed v2 binding takes a new address
-- once the chain's time is past it and the claim bit is clear. NULL: no v2 signature ever left.
-- `binder_signature` may be NULL: on a v2 drop the bind stores the address only and the worker
-- signs at send time.

ALTER TABLE handle_bindings ADD COLUMN IF NOT EXISTS binding_valid_until BIGINT;
ALTER TABLE handle_bindings ALTER COLUMN binder_signature DROP NOT NULL;
