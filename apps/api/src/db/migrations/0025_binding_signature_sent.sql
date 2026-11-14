-- 0025_binding_signature_sent — when a binding's signature first left the api.
--
-- Set by the worker before the first gas estimate, simulate or send that carries the signature,
-- never cleared. While it is NULL a failed claim may take a new address. `pending` is a
-- claim whose result is unknown after the send; the worker checks the chain, never marks it failed.

ALTER TABLE handle_bindings ADD COLUMN IF NOT EXISTS binding_signature_sent_at TIMESTAMPTZ;
ALTER TABLE handle_bindings DROP CONSTRAINT IF EXISTS handle_bindings_state_check;
ALTER TABLE handle_bindings ADD CONSTRAINT handle_bindings_state_check
  CHECK (state IN ('bound', 'submitted', 'pending', 'paid', 'failed'));
