CREATE TABLE IF NOT EXISTS password_reset_requests (
  id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','used','rejected','expired')),
  code_hash TEXT,
  requested_ip_hash TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  used_at TEXT,
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_email_created
ON password_reset_requests(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_status_created
ON password_reset_requests(status, created_at DESC);
