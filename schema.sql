PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  member_code TEXT PRIMARY KEY,
  display_name TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  account_status TEXT NOT NULL DEFAULT 'active',
  terms_version TEXT,
  privacy_version TEXT,
  consented_at TEXT,
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_member_expires
ON sessions(member_code, expires_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_profiles (
  member_code TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('bank','momo')),
  bank_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_ciphertext TEXT NOT NULL,
  account_iv TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_fingerprint TEXT,
  payout_available_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('cron','manual')),
  status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  total_fetched INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started
ON sync_runs(started_at DESC);

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

CREATE TABLE IF NOT EXISTS link_requests (
  request_id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopee','tiktok')),
  source_url TEXT NOT NULL,
  resolved_url TEXT,
  affiliate_url TEXT,
  at_response_json TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code)
);

CREATE INDEX IF NOT EXISTS idx_link_requests_member
ON link_requests(member_code, created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  member_code TEXT,
  platform TEXT,
  merchant TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  is_confirmed INTEGER NOT NULL DEFAULT 0,
  approval_time TEXT,
  commission_vnd REAL NOT NULL DEFAULT 0,
  order_value_vnd REAL NOT NULL DEFAULT 0,
  cashback_vnd INTEGER NOT NULL DEFAULT 0,
  transaction_time TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_json TEXT NOT NULL,
  FOREIGN KEY (member_code) REFERENCES members(member_code)
);

CREATE INDEX IF NOT EXISTS idx_transactions_member
ON transactions(member_code, status, transaction_time DESC);

CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL,
  amount_vnd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','paid','rejected')),
  note TEXT,
  payment_method TEXT,
  payment_bank_code TEXT,
  payment_account_name TEXT,
  payment_account_ciphertext TEXT,
  payment_account_iv TEXT,
  payment_account_last4 TEXT,
  payment_account_fingerprint TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code)
);

CREATE INDEX IF NOT EXISTS idx_payout_member
ON payout_requests(member_code, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_requested_payout_per_member
ON payout_requests(member_code) WHERE status='requested';

CREATE TABLE IF NOT EXISTS savings_goals (
  member_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_vnd INTEGER NOT NULL CHECK (target_vnd BETWEEN 50000 AND 1000000000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_code) REFERENCES members(member_code) ON DELETE CASCADE
);
