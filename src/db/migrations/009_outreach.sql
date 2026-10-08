CREATE TABLE IF NOT EXISTS outreach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out',      -- out | in
  kind TEXT NOT NULL,                         -- pitch | followup_1 | followup_2 | reply
  channel TEXT NOT NULL,                      -- email | phone | walk_in | whatsapp | dm
  to_addr TEXT,
  from_addr TEXT,
  subject TEXT,
  body TEXT,
  transport TEXT NOT NULL,                    -- manual | test | proton | resend | imap
  status TEXT NOT NULL,                       -- sent | logged | written | failed | received
  message_id TEXT,
  in_reply_to TEXT,
  provider_id TEXT,
  error TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_lead ON outreach_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_at ON outreach_messages(at);
CREATE INDEX IF NOT EXISTS idx_outreach_msgid ON outreach_messages(message_id);

CREATE TABLE IF NOT EXISTS outreach_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
