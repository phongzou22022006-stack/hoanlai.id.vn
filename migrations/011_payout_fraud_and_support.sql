ALTER TABLE payment_profiles ADD COLUMN account_fingerprint TEXT;
ALTER TABLE payment_profiles ADD COLUMN payout_available_at TEXT;

ALTER TABLE payout_requests ADD COLUMN payment_account_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_profiles_unique_destination
ON payment_profiles(account_fingerprint)
WHERE account_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_cases (
  id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('missing_order','wrong_status','payout','account','other')),
  order_reference TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','rejected')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_cases_member_created
ON support_cases(member_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_cases_status_created
ON support_cases(status, created_at DESC);
