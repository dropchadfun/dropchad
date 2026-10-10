-- 0012_binding_x_login_only —.: no wallet connect and no
-- wallet signature, the X login is the only proof.
--
-- The two wallet proof columns of 0010 never held a row: nothing wrote the table before this
-- step. What the leak playbook checks now is that every on chain `HandleClaimed` has a row here.

ALTER TABLE handle_bindings DROP COLUMN IF EXISTS wallet_message;
ALTER TABLE handle_bindings DROP COLUMN IF EXISTS wallet_signature;
