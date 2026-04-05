-- 0009_phone_verification.sql
-- Add phone_verified flag to riders for OTP verification tracking

ALTER TABLE riders ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
