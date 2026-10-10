-- 0013_binding_error —. Why a handle claim failed, so the receiver can be
-- told and may bind a new address.

ALTER TABLE handle_bindings ADD COLUMN IF NOT EXISTS last_error TEXT;
