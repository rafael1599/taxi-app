-- 0007_push_tokens.sql
-- Add push notification token columns for drivers and riders

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS push_token TEXT;
