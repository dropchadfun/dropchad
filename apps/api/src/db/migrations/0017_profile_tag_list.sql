-- 0017_profile_tag_list — up to three tags, in the order tapped, and every lock cleared.
--
-- A chad picks one to three tags from the same
-- flat list; the first is the first one tapped, the one rows and boards show, and `kind` comes
-- from it. Enforced by the api, not by a CHECK, like `tag` in 0008. The lock is now 30 days.
--
-- A profile with a `tag` gets a list of that one tag; `kind` already came from it, so it stays.
-- Every lock is cleared: the 30 days start at the next save. The old `tag` column stays, never
-- read or written, so the code before this change still runs on this database; a later
-- migration drops it. `tags` was a column of 0007 that 0008 dropped, so the name is free.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tags TEXT[];
UPDATE profiles SET tags = CASE WHEN tag IS NULL THEN '{}'::TEXT[] ELSE ARRAY[tag] END;
ALTER TABLE profiles ALTER COLUMN tags SET DEFAULT '{}'::TEXT[];
ALTER TABLE profiles ALTER COLUMN tags SET NOT NULL;
UPDATE profiles SET tag_set_at = NULL;
