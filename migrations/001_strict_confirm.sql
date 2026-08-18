ALTER TABLE transactions ADD COLUMN is_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN approval_time TEXT;
