ALTER TABLE members ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE members ADD COLUMN terms_version TEXT;
ALTER TABLE members ADD COLUMN privacy_version TEXT;
ALTER TABLE members ADD COLUMN consented_at TEXT;

CREATE TABLE IF NOT EXISTS data_requests (
  id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('correction','deletion')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','completed','rejected')),
  message TEXT NOT NULL,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (member_code) REFERENCES members(member_code)
);

CREATE INDEX IF NOT EXISTS idx_data_requests_member_created
ON data_requests(member_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_requests_status_created
ON data_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_data_request
ON data_requests(member_code, request_type)
WHERE status IN ('open','reviewing');

-- Không giữ nguyên payload đối tác vì có thể chứa trường dữ liệu cá nhân không cần thiết.
UPDATE transactions
SET raw_json = json_object('redacted', 1, 'reason', 'data_minimization_012');

UPDATE link_requests
SET at_response_json = NULL
WHERE at_response_json IS NOT NULL;
