CREATE TABLE IF NOT EXISTS builds (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  failed_step TEXT,
  step_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  repo_dir TEXT,
  repo_url TEXT,
  seed_sha TEXT,
  head_sha TEXT,
  vercel_project TEXT,
  deployment_url TEXT,
  preview_url TEXT,
  brand_json_path TEXT,
  gate_json_path TEXT,
  evidence_path TEXT,
  agent_result_path TEXT,
  agent_turns INTEGER,
  agent_seconds INTEGER,
  agent_cost_usd REAL,
  research_fallback INTEGER,
  created_at TEXT NOT NULL,
  built_at TEXT,
  deployed_at TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  torn_down_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS build_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  step TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_events_lead ON build_events(lead_id);
