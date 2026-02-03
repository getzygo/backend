-- Migration: 0010_reminder_logs.sql
-- Description: Create reminder_logs table for tracking automated reminder notifications
-- Used for: MFA enablement, phone verification, and trial expiration reminders

-- ============================================================================
-- Reminder Logs Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Reminder type: 'mfa_enablement' | 'phone_verification' | 'trial_expiration'
  reminder_type VARCHAR(50) NOT NULL,
  -- Stage: 'first' | 'final'
  stage VARCHAR(20) NOT NULL,

  -- Email delivery status
  email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,

  -- In-app notification status
  in_app_sent BOOLEAN NOT NULL DEFAULT FALSE,
  in_app_sent_at TIMESTAMPTZ,

  -- Deadline tracking
  deadline_at TIMESTAMPTZ,

  -- Additional metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint to prevent duplicate reminders
-- This ensures we only send one reminder per (user, tenant, type, stage) combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_logs_unique
  ON reminder_logs(user_id, tenant_id, reminder_type, stage);

-- Query by user
CREATE INDEX IF NOT EXISTS idx_reminder_logs_user ON reminder_logs(user_id);

-- Query by tenant
CREATE INDEX IF NOT EXISTS idx_reminder_logs_tenant ON reminder_logs(tenant_id);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

-- Reminder logs: System access only (no direct user access needed)
-- The worker will bypass RLS using service role
CREATE POLICY reminder_logs_service_only ON reminder_logs
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE reminder_logs IS 'Tracks automated reminder notifications sent to users';
COMMENT ON COLUMN reminder_logs.reminder_type IS 'Type of reminder: mfa_enablement, phone_verification, trial_expiration';
COMMENT ON COLUMN reminder_logs.stage IS 'Reminder stage: first (early warning) or final (last chance)';
COMMENT ON COLUMN reminder_logs.email_sent IS 'Whether the email notification was sent successfully';
COMMENT ON COLUMN reminder_logs.in_app_sent IS 'Whether the in-app notification was created successfully';
COMMENT ON COLUMN reminder_logs.deadline_at IS 'The deadline date the reminder is warning about';
