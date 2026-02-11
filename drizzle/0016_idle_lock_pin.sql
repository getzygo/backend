-- Idle Lock & PIN Migration
-- Adds PIN columns to users table and idle lock policy columns to tenant_security_config

-- Users: PIN fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_length INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_changed_at TIMESTAMPTZ;

-- Tenant Security Config: Idle lock & PIN policy
ALTER TABLE tenant_security_config ADD COLUMN IF NOT EXISTS idle_lock_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenant_security_config ADD COLUMN IF NOT EXISTS idle_lock_timeout_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE tenant_security_config ADD COLUMN IF NOT EXISTS pin_length_requirement INTEGER NOT NULL DEFAULT 4;
ALTER TABLE tenant_security_config ADD COLUMN IF NOT EXISTS require_pin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenant_security_config ADD COLUMN IF NOT EXISTS pin_deadline_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE tenant_security_config ADD COLUMN IF NOT EXISTS pin_max_attempts INTEGER NOT NULL DEFAULT 5;
