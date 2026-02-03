-- Migration: Add security tables for authentication enhancements
-- Tables: passkeys, trusted_devices, user_sessions, magic_links, login_alerts
-- User columns: password_breached_at, login_notification_enabled, webauthn_enabled, preferred_auth_method

-- Add new columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_breached_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS login_notification_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS webauthn_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS preferred_auth_method VARCHAR(20) DEFAULT 'password';

-- Passkeys (WebAuthn credentials)
CREATE TABLE IF NOT EXISTS passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  transports TEXT[], -- Array of transport hints
  device_type VARCHAR(50), -- 'platform', 'cross-platform'
  name VARCHAR(100), -- User-friendly name
  aaguid TEXT, -- Authenticator Attestation GUID
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_passkeys_credential ON passkeys(credential_id);

-- Trusted Devices (MFA Remember)
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  device_name VARCHAR(100),
  browser VARCHAR(50),
  os VARCHAR(50),
  ip_address VARCHAR(45),
  trusted_until TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_hash ON trusted_devices(device_hash);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices(trusted_until);

-- User Sessions (Active Session Management)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  token_hash TEXT UNIQUE NOT NULL,
  device_name VARCHAR(100),
  browser VARCHAR(50),
  os VARCHAR(50),
  ip_address VARCHAR(45),
  location_city VARCHAR(100),
  location_country VARCHAR(100),
  is_current BOOLEAN DEFAULT false,
  last_active_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant ON user_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, revoked_at) WHERE revoked_at IS NULL;

-- Magic Links
CREATE TABLE IF NOT EXISTS magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  redirect_url TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

-- Login Alerts
CREATE TABLE IF NOT EXISTS login_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type VARCHAR(20) NOT NULL, -- 'new_device', 'new_location', 'new_browser'
  ip_address VARCHAR(45),
  device_info JSONB DEFAULT '{}',
  location JSONB DEFAULT '{}',
  email_sent_at TIMESTAMP WITH TIME ZONE,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  is_suspicious BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_alerts_user ON login_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_login_alerts_type ON login_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_login_alerts_created ON login_alerts(created_at);

-- WebAuthn Challenges (temporary storage for registration/authentication)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'registration', 'authentication'
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON webauthn_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);

-- Add comment for documentation
COMMENT ON TABLE passkeys IS 'WebAuthn/Passkey credentials for passwordless authentication';
COMMENT ON TABLE trusted_devices IS 'Devices trusted to skip MFA for 30 days';
COMMENT ON TABLE user_sessions IS 'Active user sessions for session management';
COMMENT ON TABLE magic_links IS 'Magic link tokens for passwordless email authentication';
COMMENT ON TABLE login_alerts IS 'Alerts for suspicious or new device/location logins';
COMMENT ON TABLE webauthn_challenges IS 'Temporary WebAuthn challenges during registration/authentication';
