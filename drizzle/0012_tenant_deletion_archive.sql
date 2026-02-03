-- Migration: 0012_tenant_deletion_archive.sql
-- Description: Add tenant deletion workflow fields and create tenant_archives table
-- Purpose: Support soft delete, encryption, and archiving for legal compliance
-- Per DATA_PROTECTION.md: GDPR, CCPA/CPRA, SOC2 requirements

-- ============================================================================
-- Add Deletion Tracking Fields to Tenants
-- ============================================================================

-- Update status enum comment (now includes 'pending_deletion')
COMMENT ON COLUMN tenants.status IS 'Tenant status: active, suspended, pending_deletion, deleted';

-- Deletion tracking fields
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_cancelable_until TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Index for finding tenants pending deletion
CREATE INDEX IF NOT EXISTS idx_tenants_deletion_scheduled
  ON tenants(deletion_scheduled_at)
  WHERE status = 'pending_deletion';

-- ============================================================================
-- Tenant Archives Table
-- Stores encrypted archives of deleted tenant data for legal retention
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Original tenant info (no FK - tenant record may be deleted)
  tenant_id UUID NOT NULL,
  tenant_name VARCHAR(100) NOT NULL,
  tenant_slug VARCHAR(50) NOT NULL,

  -- Archive storage details
  archive_path TEXT NOT NULL,                    -- S3/storage path to encrypted archive
  archive_size_bytes INTEGER,                    -- Size for storage tracking
  encryption_key_id VARCHAR(100),                -- KMS/encryption key reference
  checksum_sha256 VARCHAR(64),                   -- For integrity verification

  -- Archive contents summary
  archived_data JSONB DEFAULT '{}',              -- { users: N, workflows: N, servers: N, ... }

  -- Deletion details
  deleted_by UUID,                               -- User who initiated deletion
  deletion_reason TEXT,

  -- Legal hold (prevents automatic purge)
  legal_hold BOOLEAN DEFAULT FALSE,
  legal_hold_reason TEXT,
  legal_hold_by UUID,
  legal_hold_at TIMESTAMPTZ,
  legal_hold_until TIMESTAMPTZ,

  -- Retention timeline
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_expires_at TIMESTAMPTZ NOT NULL,     -- Default: 7 years from archived_at
  purged_at TIMESTAMPTZ,                         -- When archive was permanently deleted

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tenant_archives_tenant ON tenant_archives(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_archives_retention ON tenant_archives(retention_expires_at)
  WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_archives_legal_hold ON tenant_archives(legal_hold)
  WHERE legal_hold = TRUE;

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE tenant_archives ENABLE ROW LEVEL SECURITY;

-- Archives are admin-only (service role access)
-- No direct user access - archives managed via API with proper authorization
CREATE POLICY tenant_archives_service_only ON tenant_archives
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE tenant_archives IS 'Encrypted archives of deleted tenant data for legal retention (7 years per DATA_PROTECTION.md)';

COMMENT ON COLUMN tenant_archives.tenant_id IS 'Original tenant ID - no FK as tenant record may be deleted';
COMMENT ON COLUMN tenant_archives.archive_path IS 'Path to encrypted archive in S3/storage (e.g., archives/{tenant_id}/{timestamp}.enc)';
COMMENT ON COLUMN tenant_archives.encryption_key_id IS 'Reference to KMS/encryption key used to encrypt archive';
COMMENT ON COLUMN tenant_archives.checksum_sha256 IS 'SHA-256 checksum for integrity verification';
COMMENT ON COLUMN tenant_archives.archived_data IS 'Summary of archived data: { users: count, workflows: count, ... }';
COMMENT ON COLUMN tenant_archives.legal_hold IS 'When true, archive cannot be automatically purged';
COMMENT ON COLUMN tenant_archives.retention_expires_at IS 'Date when archive can be purged (default: 7 years from archived_at)';
COMMENT ON COLUMN tenant_archives.purged_at IS 'Date when archive was permanently deleted from storage';

COMMENT ON COLUMN tenants.deletion_requested_at IS 'When deletion was first requested';
COMMENT ON COLUMN tenants.deletion_scheduled_at IS 'When deletion will be executed (after grace period)';
COMMENT ON COLUMN tenants.deletion_cancelable_until IS 'Deadline to cancel deletion request (14 days from request)';
COMMENT ON COLUMN tenants.deleted_by IS 'User ID who initiated the deletion';
COMMENT ON COLUMN tenants.deletion_reason IS 'Optional reason provided for deletion';
