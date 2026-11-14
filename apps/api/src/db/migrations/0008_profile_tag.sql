-- 0008_profile_tag — one tag, not two, and the day it was picked.
--
-- The two tag rule of 0007 lasted an afternoon: `memecoin` plus `kol` on one person makes no
-- sense. One flat list now: chad, kol, dev, streamer, trader, community,
-- memecoin, utility, nft. Enforced by the api, not by a CHECK. `tag_set_at` is the save time;
-- a change before 90 days later is refused by the api, `409 tag_locked`. Nobody had picked a
-- tag when this ran, so `tags` is dropped, not migrated.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tag_set_at TIMESTAMPTZ;
ALTER TABLE profiles DROP COLUMN IF EXISTS tags;
