-- Migration: Add tenant-scoped profile fields to tenant_members
-- job_title and reporting_manager_id are now tenant-scoped (user can have different values per tenant)

-- Add columns to tenant_members table
ALTER TABLE tenant_members
ADD COLUMN IF NOT EXISTS job_title VARCHAR(100),
ADD COLUMN IF NOT EXISTS reporting_manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Create index for reporting_manager lookups
CREATE INDEX IF NOT EXISTS idx_tenant_members_reporting_manager ON tenant_members(reporting_manager_id);

-- Migrate existing data from users table to tenant_members
-- This copies job_title and reporting_manager_id from users to their tenant memberships
UPDATE tenant_members tm
SET
  job_title = u.job_title,
  reporting_manager_id = u.reporting_manager_id
FROM users u
WHERE tm.user_id = u.id
  AND (u.job_title IS NOT NULL OR u.reporting_manager_id IS NOT NULL);

-- Note: The columns in the users table are kept for backward compatibility
-- They can be removed in a future migration after confirming everything works
