CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  place_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_raw TEXT NOT NULL,
  area TEXT NOT NULL,
  source_query TEXT NOT NULL,
  address TEXT,
  postcode TEXT,
  outward_code TEXT,
  lat REAL,
  lng REAL,
  phone_e164 TEXT,
  website_url TEXT,
  google_maps_url TEXT,
  rating REAL,
  review_count INTEGER,
  business_status TEXT,
  primary_type TEXT,
  types_json TEXT,
  opening_hours_json TEXT,
  is_chain INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_query ON leads(source_query);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_e164);

CREATE TABLE IF NOT EXISTS companies_house (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  company_number TEXT,
  company_name TEXT,
  company_status TEXT,
  company_type TEXT,
  registered_postcode TEXT,
  sic_codes_json TEXT,
  match_confidence TEXT NOT NULL DEFAULT 'none',
  ltd_hint_from_site INTEGER NOT NULL DEFAULT 0,
  matched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  audited_at TEXT NOT NULL,
  run_id INTEGER,
  website_status TEXT NOT NULL,
  input_url TEXT,
  final_url TEXT,
  final_domain TEXT,
  http_status INTEGER,
  tls_error TEXT,
  redirect_count INTEGER,
  ttfb_ms INTEGER,
  https_ok INTEGER,
  http_redirects_to_https INTEGER,
  has_viewport INTEGER,
  title TEXT,
  title_len INTEGER,
  meta_desc_len INTEGER,
  h1_count INTEGER,
  builder TEXT,
  free_tier_host INTEGER,
  copyright_year INTEGER,
  phone_on_page TEXT,
  phone_matches_listing INTEGER,
  has_local_schema INTEGER,
  ltd_hint INTEGER,
  lh_perf INTEGER,
  lh_seo INTEGER,
  lh_a11y INTEGER,
  lh_bp INTEGER,
  lh_error TEXT,
  lh_json_path TEXT,
  screenshot_mobile TEXT,
  screenshot_desktop TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS scores (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  scored_at TEXT NOT NULL,
  opportunity INTEGER NOT NULL,
  viability INTEGER NOT NULL,
  total INTEGER NOT NULL,
  tier TEXT NOT NULL,
  channel TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  excluded_reason TEXT
);

CREATE TABLE IF NOT EXISTS pipeline (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new',
  channel TEXT,
  contacted_at TEXT,
  last_touch_at TEXT,
  next_touch_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppression (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT,
  added_at TEXT NOT NULL,
  UNIQUE(kind, value)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  places_requests INTEGER NOT NULL DEFAULT 0,
  psi_requests INTEGER NOT NULL DEFAULT 0,
  ch_requests INTEGER NOT NULL DEFAULT 0
);
