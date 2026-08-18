CREATE TABLE IF NOT EXISTS savings_goals (
  member_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_vnd INTEGER NOT NULL CHECK (target_vnd BETWEEN 50000 AND 1000000000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

PRAGMA optimize;
