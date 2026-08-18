ALTER TABLE members ADD COLUMN email TEXT;
ALTER TABLE members ADD COLUMN password_hash TEXT;
ALTER TABLE members ADD COLUMN password_salt TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email
ON members(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_member_expires
ON sessions(member_code, expires_at);

PRAGMA optimize;
