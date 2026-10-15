-- 0007_profile_tags — what a chad says they are, in two words at most.
--
-- The profile page shows up to two self picked tags. Person tags: kol, dev,
-- streamer, trader, community. Project tags: memecoin, utility, nft. Enforced by the api, not by
-- a CHECK, like `kind` in 0004. NULL reads as no tags, an empty array is a chad who picked and
-- then cleared. `kind` stays and is now derived from the tags on every save; the boards keep
-- reading it.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tags TEXT[];
