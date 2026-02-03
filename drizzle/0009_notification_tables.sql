-- Migration: 0009_notification_tables.sql
-- Description: Create notification system tables
-- - notifications: In-app notifications for users
-- - notification_preferences: Per-user, per-tenant notification settings
-- - security_alert_log: Deduplication tracking for security alerts

-- ============================================================================
-- Notifications Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Notification content
  type VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,

  -- Action (SECURITY: Store internal route only, NOT full URL to prevent open redirect)
  action_route VARCHAR(255),
  action_label VARCHAR(100),

  -- Severity: 'info', 'warning', 'danger', 'success'
  severity VARCHAR(20) NOT NULL DEFAULT 'info',

  -- Read status
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,

  -- Additional metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

-- Composite index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_tenant ON notifications(user_id, tenant_id);

-- Partial index for unread notifications (most common query)
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, tenant_id, is_read);

-- For cleanup job
CREATE INDEX IF NOT EXISTS idx_notifications_expires ON notifications(expires_at);

-- For chronological listing
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ============================================================================
-- Notification Preferences Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Global toggles
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sound_volume INTEGER NOT NULL DEFAULT 50 CHECK (sound_volume >= 0 AND sound_volume <= 100),

  -- Do Not Disturb settings
  dnd_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dnd_start_time TIME,
  dnd_end_time TIME,

  -- Per-category preferences (for user-disableable categories only)
  -- Format: { "login_alert": { "email": true, "in_app": true }, ... }
  category_preferences JSONB DEFAULT '{}',

  -- Temporary pause (until this timestamp)
  paused_until TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Per-tenant unique constraint
  UNIQUE(user_id, tenant_id)
);

-- Unique index already created by UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_tenant ON notification_preferences(user_id, tenant_id);

-- ============================================================================
-- Security Alert Log Table (for deduplication)
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_alert_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  alert_type VARCHAR(50) NOT NULL,
  -- Fingerprint: hash of device+ip+browser for deduplication
  fingerprint VARCHAR(255) NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Auto-cleanup after 24 hours
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Deduplication index
CREATE INDEX IF NOT EXISTS idx_security_alert_dedup ON security_alert_log(user_id, alert_type, fingerprint);

-- For cleanup job
CREATE INDEX IF NOT EXISTS idx_security_alert_expires ON security_alert_log(expires_at);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alert_log ENABLE ROW LEVEL SECURITY;

-- Notifications: Users can only see their own notifications within their tenant
CREATE POLICY notifications_user_isolation ON notifications
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Notification Preferences: Users can only access their own preferences
CREATE POLICY notification_preferences_user_isolation ON notification_preferences
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Security Alert Log: Users can only see their own alert logs
CREATE POLICY security_alert_log_user_isolation ON security_alert_log
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
  );

-- ============================================================================
-- Cleanup Function (call periodically via cron)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete expired notifications
  DELETE FROM notifications WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Delete expired security alert logs
  DELETE FROM security_alert_log WHERE expires_at < NOW();

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comment on function
COMMENT ON FUNCTION cleanup_expired_notifications() IS 'Cleanup expired notifications and security alert logs. Run daily via cron.';
