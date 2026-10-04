ALTER TABLE leads ADD COLUMN photo_count INTEGER;

CREATE TABLE IF NOT EXISTS searches (
  query TEXT PRIMARY KEY,
  trade TEXT NOT NULL,
  area TEXT NOT NULL,
  variants INTEGER NOT NULL DEFAULT 0,
  first_run_at TEXT,
  last_run_at TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  tier_ab INTEGER NOT NULL DEFAULT 0,
  yield REAL,
  low_runs INTEGER NOT NULL DEFAULT 0,
  retired INTEGER NOT NULL DEFAULT 0,
  retired_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS picks (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  picked_at TEXT NOT NULL,
  picked_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  pick_score INTEGER,
  buildability INTEGER
);
