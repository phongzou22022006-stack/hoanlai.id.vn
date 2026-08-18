CREATE TABLE IF NOT EXISTS payment_profiles (
  member_code TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('bank','momo')),
  bank_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_ciphertext TEXT NOT NULL,
  account_iv TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

ALTER TABLE payout_requests ADD COLUMN payment_method TEXT;
ALTER TABLE payout_requests ADD COLUMN payment_bank_code TEXT;
ALTER TABLE payout_requests ADD COLUMN payment_account_name TEXT;
ALTER TABLE payout_requests ADD COLUMN payment_account_ciphertext TEXT;
ALTER TABLE payout_requests ADD COLUMN payment_account_iv TEXT;
ALTER TABLE payout_requests ADD COLUMN payment_account_last4 TEXT;
ALTER TABLE payout_requests ADD COLUMN reviewed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_requested_payout_per_member
ON payout_requests(member_code) WHERE status='requested';

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
