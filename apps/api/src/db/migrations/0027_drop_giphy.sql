-- 0027_drop_giphy — a GIF on a drop.
--
-- `giphy_id`: the GIPHY id, letters and digits, checked by the api. `giphy_kind`: `gif` or
-- `sticker`. Both NULL or both set. No GIPHY URL is stored. `meme_image_url` stays and is never
-- written or read again.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS giphy_id TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS giphy_kind TEXT;
ALTER TABLE drops ADD CONSTRAINT drops_giphy_check
  CHECK (
    (giphy_id IS NULL AND giphy_kind IS NULL)
    OR (giphy_id IS NOT NULL AND giphy_kind IS NOT NULL AND giphy_kind IN ('gif', 'sticker'))
  );
