CREATE TABLE IF NOT EXISTS turnstile_checks (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('login','signup','payout')),
  success INTEGER NOT NULL DEFAULT 0,
  hostname TEXT,
  error_codes TEXT NOT NULL DEFAULT '[]',
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_turnstile_checks_created
ON turnstile_checks(created_at DESC);

CREATE TABLE IF NOT EXISTS turnstile_health (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  first_success_at TEXT,
  replay_rejected_at TEXT,
  last_action TEXT,
  last_hostname TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
