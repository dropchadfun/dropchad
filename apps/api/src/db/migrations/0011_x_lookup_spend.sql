-- 0011_x_lookup_spend — paid X handle lookups per UTC day.
--
-- `HANDLE_LOOKUPS_DAILY_MAX` caps them, 1,000 a day on testnet (the X credits are 25 usd). The
-- count is charged **before** the call, like the relayer gas budget, so the cap is a cap and a
-- restart does not reset it. A cached handle costs nothing and is never counted.

CREATE TABLE IF NOT EXISTS x_lookup_spend (
  day DATE PRIMARY KEY,
  lookups INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
