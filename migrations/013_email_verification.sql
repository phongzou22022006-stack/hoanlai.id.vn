ALTER TABLE members ADD COLUMN email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS email_verification_requests (
  id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','used','expired','failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_verification_member_created
ON email_verification_requests(member_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_verification_status_expires
ON email_verification_requests(status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_email_verification
ON email_verification_requests(member_code)
WHERE status='pending';

PRAGMA optimize;
