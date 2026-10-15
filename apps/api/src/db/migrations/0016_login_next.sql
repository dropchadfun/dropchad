-- 0016_login_next —. Where the browser goes after the X
-- login: kept in the state row at start, read only from that row at callback, so it cannot be
-- swapped in between. Only `/claim` or `/claim?drop=<drop address>`; NULL is the front page.

ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS next_path TEXT;
