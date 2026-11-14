-- 0004_profile_kind — which board a chad belongs on.
--
-- The boards page has three tabs, projects, kols and devs, on top of the everyone tab. Nothing
-- sets this yet: there is no admin route and no self service, so every profile starts NULL and
-- only shows on the everyone tab. Classifying people is a later task and a product decision, not
-- something a login should guess.
--
-- Values, when set: 'project' | 'kol' | 'dev'. Enforced by the api, not by a CHECK, so adding a
-- kind later is not a migration.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kind TEXT;
