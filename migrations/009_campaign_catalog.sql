CREATE TABLE IF NOT EXISTS campaign_catalog (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  merchant TEXT,
  approval TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  platform TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_checks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  approved_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
