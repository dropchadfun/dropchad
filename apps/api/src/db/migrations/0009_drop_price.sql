-- 0009_drop_price — the coin's usd price, frozen when the drop activated.
--
-- `price_usd` is usd per whole coin from Coingecko at the moment the worker activated the drop,
-- `priced_at` when. Written once in `worker.ts` `activate`, never again, so a drop's usd value
-- does not move with the market. NULL means the lookup failed or never ran; such a drop counts
-- zero on the usd boards and the profile tile. Native coins only, no tokens.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS price_usd NUMERIC;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS priced_at TIMESTAMPTZ;
