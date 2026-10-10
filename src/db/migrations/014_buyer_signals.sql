-- Signals that a business will pay for a site, and the instrumentation to learn which ones matter.

-- Companies House: when the company was incorporated. A company one to five years old is the classic buyer of a
-- first proper site; the search result already carried this and it was being thrown away.
ALTER TABLE companies_house ADD COLUMN date_of_creation TEXT;

-- The review count on every sighting. Google returns the five most relevant reviews, not the newest, so their dates
-- say little about whether a business is active. The change in the count between sightings does.
CREATE TABLE IF NOT EXISTS review_history (
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL,
  review_count INTEGER NOT NULL,
  rating REAL,
  PRIMARY KEY (lead_id, seen_at)
);
INSERT OR IGNORE INTO review_history (lead_id, seen_at, review_count, rating)
  SELECT id, last_seen_at, review_count, rating FROM leads WHERE review_count IS NOT NULL;

-- Dead sites: the domain's registration state (RDAP) and the last archived copy (the Wayback Machine), which gives
-- the build real photos, words and a logo, and gives the pitch "your domain has expired, I can get it back".
ALTER TABLE audits ADD COLUMN domain_status TEXT;        -- registered | expiring | available | unknown
ALTER TABLE audits ADD COLUMN domain_expires_at TEXT;
ALTER TABLE audits ADD COLUMN wayback_url TEXT;          -- the archived copy, as a browser shows it
ALTER TABLE audits ADD COLUMN wayback_at TEXT;           -- when that copy was taken
ALTER TABLE audits ADD COLUMN rescued_at TEXT;           -- when the domain and archive were last looked up

-- Outreach: the hook each pitch led with (no website, site down, slow site ...), so outcomes can be read by hook
-- as well as by trade and channel.
ALTER TABLE outreach_messages ADD COLUMN hook TEXT;

-- Preview opens, counted by the preview site itself and read back from the shared store.
CREATE TABLE IF NOT EXISTS preview_opens (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  opens INTEGER NOT NULL DEFAULT 0,
  first_at TEXT,
  last_at TEXT,
  checked_at TEXT NOT NULL
);

-- The call before the build (checkpoints.call in config/build.yaml): whether they said yes to being sent the link.
ALTER TABLE picks ADD COLUMN consent TEXT;               -- yes | no
ALTER TABLE picks ADD COLUMN consent_at TEXT;
ALTER TABLE picks ADD COLUMN consent_note TEXT;
