# Supabase Migration Plan

**Version:** 2.0
**Last Updated:** January 26, 2026
**Database:** PostgreSQL 14+ via Supabase
**Purpose:** Ordered migration steps with RLS enforcement

---

## Table of Contents

1. [Migration Strategy](#migration-strategy)
2. [Prerequisites](#prerequisites)
3. [Migration 001: Extensions and Core Functions](#migration-001-extensions-and-core-functions)
4. [Migration 002: Tenants and Users](#migration-002-tenants-and-users)
5. [Migration 003: RBAC System](#migration-003-rbac-system)
6. [Migration 004: Infrastructure - Servers and Storage](#migration-004-infrastructure---servers-and-storage)
7. [Migration 005: Infrastructure - Networking](#migration-005-infrastructure---networking)
8. [Migration 006: Infrastructure - Security](#migration-006-infrastructure---security)
9. [Migration 007: Secrets and Variables](#migration-007-secrets-and-variables)
10. [Migration 008: Webhooks](#migration-008-webhooks)
11. [Migration 009: Billing](#migration-009-billing)
12. [Migration 010: Compliance (GDPR/CCPA)](#migration-010-compliance-gdprccpa)
13. [Migration 011: Audit Logging](#migration-011-audit-logging)
14. [Migration 012: Workflows and Nodes](#migration-012-workflows-and-nodes)
15. [Migration 013: Provider Resource Mapping](#migration-013-provider-resource-mapping)
16. [Post-Migration Tasks](#post-migration-tasks)
17. [Testing Checklist](#testing-checklist)

---

## Migration Strategy

### Approach

1. **Sequential Execution** - Each migration builds on previous
2. **Idempotent** - Safe to re-run migrations (IF NOT EXISTS)
3. **RLS-First** - Security policies created with tables
4. **Tested** - Each migration tested in isolation
5. **Rollback Support** - Each migration has a down script

### Execution Order

Migrations MUST be executed in numerical order to satisfy foreign key dependencies.

```bash
# Execute migrations in order
psql $DATABASE_URL -f migrations/001_extensions.sql
psql $DATABASE_URL -f migrations/002_tenants_users.sql
# ... and so on
```

---

## Prerequisites

### Required Supabase Setup

```sql
-- ============================================
-- Prerequisites: Extensions and Helper Functions
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create audit schema
CREATE SCHEMA IF NOT EXISTS audit;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA audit TO authenticated;
GRANT USAGE ON SCHEMA audit TO service_role;
```

---

## Migration 001: Extensions and Core Functions

### Purpose
Set up core PostgreSQL extensions and helper functions for tenant context.

### Migration Script

```sql
-- ============================================
-- Migration 001: Extensions and Core Functions
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create audit schema
CREATE SCHEMA IF NOT EXISTS audit;

-- Helper function: Get current tenant ID from JWT claims
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
  -- Extract tenant_id from Supabase auth.jwt() claims
  RETURN (auth.jwt() ->> 'tenant_id')::UUID;
EXCEPTION
  WHEN OTHERS THEN
    -- Fallback to session setting for service role
    RETURN (current_setting('app.current_tenant_id', true))::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Set tenant context (for service role)
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Check if current user is global admin
CREATE OR REPLACE FUNCTION is_global_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE((auth.jwt() ->> 'is_global_admin')::BOOLEAN, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Automatically update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Rollback Script

```sql
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS is_global_admin();
DROP FUNCTION IF EXISTS set_tenant_context(UUID);
DROP FUNCTION IF EXISTS current_tenant_id();
DROP SCHEMA IF EXISTS audit CASCADE;
```

---

## Migration 002: Tenants and Users

### Purpose
Create core tenant and user tables with RLS.

### Migration Script

```sql
-- ============================================
-- Migration 002: Tenants and Users
-- ============================================

-- Table: tenants
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT UNIQUE,

  -- Company Info
  company_name TEXT,
  company_logo TEXT,
  industry TEXT,
  website TEXT,

  -- Address
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  phone TEXT,

  -- Legal Information
  legal_company_name TEXT,
  business_type TEXT,
  incorporation_date DATE,
  country_of_incorporation TEXT,
  registration_number TEXT,
  tax_number TEXT,
  vat_number TEXT,

  -- Billing Contact
  billing_email TEXT,
  billing_phone TEXT,
  use_different_billing_address BOOLEAN DEFAULT FALSE,

  -- Branding
  logo_url TEXT,
  primary_color TEXT DEFAULT '#3B82F6',

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),

  -- Plan
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  plan_expires_at TIMESTAMPTZ,

  -- Settings
  settings JSONB DEFAULT '{}',
  feature_flags JSONB DEFAULT '{}',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_company_name ON tenants(company_name);

-- No RLS on tenants - access controlled via session context

-- Table: tenant_config
CREATE TABLE IF NOT EXISTS tenant_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Authentication
  auth_providers JSONB DEFAULT '["email"]',
  mfa_required BOOLEAN DEFAULT FALSE,
  session_timeout_minutes INTEGER DEFAULT 1440,

  -- Feature Flags
  feature_flags JSONB DEFAULT '{}',

  -- Limits
  max_users INTEGER DEFAULT 5,
  max_servers INTEGER DEFAULT 10,
  max_workflows INTEGER DEFAULT 100,
  max_storage_gb INTEGER DEFAULT 10,

  -- Notifications
  notification_settings JSONB DEFAULT '{}',

  -- Demo Mode
  is_demo BOOLEAN DEFAULT FALSE,
  demo_expires_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_tenant_config UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_tenant ON tenant_config(tenant_id);

-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Profile
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,

  -- Authentication (for standalone, or reference auth.users)
  password_hash TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'deleted')),

  -- Auth Details
  email_verified BOOLEAN DEFAULT FALSE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,

  -- Preferences
  preferences JSONB DEFAULT '{}',

  -- Global Admin Flag
  is_global_admin BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_global_admin ON users(is_global_admin) WHERE is_global_admin = TRUE;

-- Enable RLS on users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can see themselves
CREATE POLICY users_self_access ON users
  FOR SELECT
  USING (id = auth.uid());

-- Table: user_sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Session
  token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT,

  -- Device
  device_id TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,

  -- Location
  ip_address INET NOT NULL,
  geo_country TEXT,
  geo_city TEXT,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON user_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(is_active, expires_at);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_tenant_isolation ON user_sessions
  FOR ALL
  USING (tenant_id = current_tenant_id() OR user_id = auth.uid());

-- Triggers
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_config_updated_at BEFORE UPDATE ON tenant_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Rollback Script

```sql
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenant_config CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
```

---

## Migration 003: RBAC System

### Purpose
Create roles, permissions, and membership tables.

### Migration Script

```sql
-- ============================================
-- Migration 003: RBAC System
-- ============================================

-- Table: permissions (global catalog)
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  is_critical BOOLEAN DEFAULT FALSE,
  requires_mfa BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permissions_key ON permissions(key);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

-- No RLS on permissions - global read-only catalog

-- Seed default permissions (114 permissions)
INSERT INTO permissions (key, name, description, category, is_critical, requires_mfa) VALUES
  -- Billing & Subscription
  ('canViewBilling', 'View Billing', 'View billing information and invoices', 'Billing & Subscription', FALSE, FALSE),
  ('canManageBilling', 'Manage Billing', 'Manage billing settings and payment methods', 'Billing & Subscription', TRUE, TRUE),
  ('canManageSubscription', 'Manage Subscription', 'Change subscription plan', 'Billing & Subscription', FALSE, FALSE),
  ('canDownloadInvoices', 'Download Invoices', 'Download billing invoices', 'Billing & Subscription', FALSE, FALSE),
  ('canViewPaymentMethods', 'View Payment Methods', 'View saved payment methods', 'Billing & Subscription', FALSE, FALSE),
  ('canAddPaymentMethod', 'Add Payment Method', 'Add new payment methods', 'Billing & Subscription', FALSE, FALSE),
  ('canRemovePaymentMethod', 'Remove Payment Method', 'Remove payment methods', 'Billing & Subscription', FALSE, FALSE),
  ('canSetDefaultPayment', 'Set Default Payment', 'Set default payment method', 'Billing & Subscription', FALSE, FALSE),
  ('canCancelSubscription', 'Cancel Subscription', 'Cancel the subscription', 'Billing & Subscription', TRUE, FALSE),

  -- User Management
  ('canViewUsers', 'View Users', 'View user list', 'User Management', FALSE, FALSE),
  ('canInviteUsers', 'Invite Users', 'Invite new users', 'User Management', FALSE, FALSE),
  ('canManageUsers', 'Manage Users', 'Edit and manage users', 'User Management', TRUE, FALSE),
  ('canDeleteUsers', 'Delete Users', 'Remove users from organization', 'User Management', FALSE, FALSE),

  -- Roles & Permissions
  ('canViewRoles', 'View Roles', 'View roles list', 'Roles & Permissions', FALSE, FALSE),
  ('canManageRoles', 'Manage Roles', 'Create, edit, and delete roles', 'Roles & Permissions', FALSE, FALSE),
  ('canAssignRoles', 'Assign Roles', 'Assign roles to users', 'Roles & Permissions', FALSE, FALSE),

  -- Organization Settings
  ('canViewOrgSettings', 'View Settings', 'View organization settings', 'Organization Settings', FALSE, FALSE),
  ('canManageOrgSettings', 'Manage Settings', 'Manage organization settings', 'Organization Settings', TRUE, TRUE),
  ('canDeleteOrganization', 'Delete Organization', 'Delete the organization', 'Organization Settings', TRUE, FALSE),

  -- Secrets & Environment
  ('canViewSecrets', 'View Secrets', 'View secret names', 'Secrets & Environment', FALSE, FALSE),
  ('canViewSecretValues', 'View Secret Values', 'View actual secret values', 'Secrets & Environment', TRUE, TRUE),
  ('canManageSecrets', 'Manage Secrets', 'Create and edit secrets', 'Secrets & Environment', FALSE, FALSE),
  ('canDeleteSecrets', 'Delete Secrets', 'Delete secrets', 'Secrets & Environment', FALSE, FALSE),
  ('canManageEnvVars', 'Manage Env Vars', 'Manage environment variables', 'Secrets & Environment', FALSE, FALSE),

  -- Webhooks
  ('canViewWebhooks', 'View Webhooks', 'View webhooks', 'Webhooks', FALSE, FALSE),
  ('canManageWebhooks', 'Manage Webhooks', 'Create and edit webhooks', 'Webhooks', FALSE, FALSE),
  ('canDeleteWebhooks', 'Delete Webhooks', 'Delete webhooks', 'Webhooks', FALSE, FALSE),
  ('canTestWebhooks', 'Test Webhooks', 'Send test webhook', 'Webhooks', FALSE, FALSE),

  -- Servers & Compute
  ('canViewServers', 'View Servers', 'View server list', 'Servers & Compute', FALSE, FALSE),
  ('canCreateServers', 'Create Servers', 'Create new servers', 'Servers & Compute', FALSE, FALSE),
  ('canManageServers', 'Manage Servers', 'Manage server settings', 'Servers & Compute', FALSE, FALSE),
  ('canDeleteServers', 'Delete Servers', 'Delete servers', 'Servers & Compute', TRUE, FALSE),
  ('canStartStopServers', 'Start/Stop Servers', 'Control server power', 'Servers & Compute', FALSE, FALSE),
  ('canRebootServers', 'Reboot Servers', 'Reboot servers', 'Servers & Compute', FALSE, FALSE),
  ('canAccessServerConsole', 'Access Console', 'Access server console', 'Servers & Compute', FALSE, FALSE),
  ('canResizeServers', 'Resize Servers', 'Change server size', 'Servers & Compute', FALSE, FALSE),
  ('canRebuildServers', 'Rebuild Servers', 'Rebuild servers', 'Servers & Compute', TRUE, FALSE),
  ('canViewServerMetrics', 'View Metrics', 'View server metrics', 'Servers & Compute', FALSE, FALSE),

  -- Volumes & Storage
  ('canViewVolumes', 'View Volumes', 'View volume list', 'Volumes & Storage', FALSE, FALSE),
  ('canCreateVolumes', 'Create Volumes', 'Create new volumes', 'Volumes & Storage', FALSE, FALSE),
  ('canManageVolumes', 'Manage Volumes', 'Manage volume settings', 'Volumes & Storage', FALSE, FALSE),
  ('canDeleteVolumes', 'Delete Volumes', 'Delete volumes', 'Volumes & Storage', TRUE, FALSE),
  ('canAttachVolumes', 'Attach Volumes', 'Attach volumes to servers', 'Volumes & Storage', FALSE, FALSE),
  ('canDetachVolumes', 'Detach Volumes', 'Detach volumes', 'Volumes & Storage', FALSE, FALSE),
  ('canResizeVolumes', 'Resize Volumes', 'Resize volumes', 'Volumes & Storage', FALSE, FALSE),

  -- Networks
  ('canViewNetworks', 'View Networks', 'View network list', 'Networks', FALSE, FALSE),
  ('canCreateNetworks', 'Create Networks', 'Create new networks', 'Networks', FALSE, FALSE),
  ('canManageNetworks', 'Manage Networks', 'Manage network settings', 'Networks', FALSE, FALSE),
  ('canDeleteNetworks', 'Delete Networks', 'Delete networks', 'Networks', TRUE, FALSE),
  ('canAttachToNetwork', 'Attach to Network', 'Attach servers to networks', 'Networks', FALSE, FALSE),
  ('canDetachFromNetwork', 'Detach from Network', 'Detach from networks', 'Networks', FALSE, FALSE),

  -- Firewalls
  ('canViewFirewalls', 'View Firewalls', 'View firewall list', 'Firewalls', FALSE, FALSE),
  ('canCreateFirewalls', 'Create Firewalls', 'Create new firewalls', 'Firewalls', FALSE, FALSE),
  ('canManageFirewalls', 'Manage Firewalls', 'Manage firewall rules', 'Firewalls', FALSE, FALSE),
  ('canDeleteFirewalls', 'Delete Firewalls', 'Delete firewalls', 'Firewalls', TRUE, FALSE),
  ('canApplyFirewalls', 'Apply Firewalls', 'Apply firewalls to servers', 'Firewalls', FALSE, FALSE),
  ('canRemoveFirewalls', 'Remove Firewalls', 'Remove firewalls from servers', 'Firewalls', FALSE, FALSE),

  -- Load Balancers
  ('canViewLoadBalancers', 'View Load Balancers', 'View load balancer list', 'Load Balancers', FALSE, FALSE),
  ('canCreateLoadBalancers', 'Create Load Balancers', 'Create new load balancers', 'Load Balancers', FALSE, FALSE),
  ('canManageLoadBalancers', 'Manage Load Balancers', 'Manage load balancer settings', 'Load Balancers', FALSE, FALSE),
  ('canDeleteLoadBalancers', 'Delete Load Balancers', 'Delete load balancers', 'Load Balancers', TRUE, FALSE),
  ('canAddLBTargets', 'Add LB Targets', 'Add targets to load balancers', 'Load Balancers', FALSE, FALSE),
  ('canRemoveLBTargets', 'Remove LB Targets', 'Remove targets from load balancers', 'Load Balancers', FALSE, FALSE),
  ('canManageLBCertificates', 'Manage LB Certificates', 'Manage SSL certificates', 'Load Balancers', FALSE, FALSE),

  -- DNS Management
  ('canViewDNS', 'View DNS', 'View DNS zones and records', 'DNS Management', FALSE, FALSE),
  ('canCreateDNSZones', 'Create DNS Zones', 'Create new DNS zones', 'DNS Management', FALSE, FALSE),
  ('canManageDNS', 'Manage DNS', 'Manage DNS records', 'DNS Management', FALSE, FALSE),
  ('canDeleteDNSZones', 'Delete DNS Zones', 'Delete DNS zones', 'DNS Management', TRUE, FALSE),
  ('canAddDNSRecords', 'Add DNS Records', 'Add DNS records', 'DNS Management', FALSE, FALSE),
  ('canDeleteDNSRecords', 'Delete DNS Records', 'Delete DNS records', 'DNS Management', FALSE, FALSE),

  -- Snapshots & Backups
  ('canViewSnapshots', 'View Snapshots', 'View snapshot list', 'Snapshots & Backups', FALSE, FALSE),
  ('canCreateSnapshots', 'Create Snapshots', 'Create new snapshots', 'Snapshots & Backups', FALSE, FALSE),
  ('canRestoreSnapshots', 'Restore Snapshots', 'Restore from snapshots', 'Snapshots & Backups', FALSE, FALSE),
  ('canDeleteSnapshots', 'Delete Snapshots', 'Delete snapshots', 'Snapshots & Backups', FALSE, FALSE),
  ('canScheduleBackups', 'Schedule Backups', 'Schedule automatic backups', 'Snapshots & Backups', FALSE, FALSE),
  ('canManageBackupPolicies', 'Manage Backup Policies', 'Manage backup policies', 'Snapshots & Backups', FALSE, FALSE),

  -- Floating IPs
  ('canViewFloatingIPs', 'View Floating IPs', 'View floating IP list', 'Floating IPs', FALSE, FALSE),
  ('canCreateFloatingIPs', 'Create Floating IPs', 'Reserve new floating IPs', 'Floating IPs', FALSE, FALSE),
  ('canAssignFloatingIPs', 'Assign Floating IPs', 'Assign floating IPs to servers', 'Floating IPs', FALSE, FALSE),
  ('canReleaseFloatingIPs', 'Release Floating IPs', 'Release floating IPs', 'Floating IPs', FALSE, FALSE),

  -- AI Components
  ('canViewNodes', 'View Nodes', 'View AI node list', 'AI Components', FALSE, FALSE),
  ('canCreateNodes', 'Create Nodes', 'Create new AI nodes', 'AI Components', FALSE, FALSE),
  ('canManageNodes', 'Manage Nodes', 'Manage AI nodes', 'AI Components', FALSE, FALSE),
  ('canDeleteNodes', 'Delete Nodes', 'Delete AI nodes', 'AI Components', TRUE, FALSE),
  ('canTestNodes', 'Test Nodes', 'Test AI nodes', 'AI Components', FALSE, FALSE),
  ('canPublishNodes', 'Publish Nodes', 'Publish nodes to registry', 'AI Components', FALSE, FALSE),
  ('canViewTemplates', 'View Templates', 'View node templates', 'AI Components', FALSE, FALSE),
  ('canCreateTemplates', 'Create Templates', 'Create node templates', 'AI Components', FALSE, FALSE),
  ('canManageTemplates', 'Manage Templates', 'Manage templates', 'AI Components', FALSE, FALSE),
  ('canDeleteTemplates', 'Delete Templates', 'Delete templates', 'AI Components', FALSE, FALSE),
  ('canViewRegistry', 'View Registry', 'View node registry', 'AI Components', FALSE, FALSE),
  ('canManageRegistry', 'Manage Registry', 'Manage node registry', 'AI Components', FALSE, FALSE),

  -- Workflows
  ('canViewWorkflows', 'View Workflows', 'View workflow list', 'Workflows', FALSE, FALSE),
  ('canCreateWorkflows', 'Create Workflows', 'Create new workflows', 'Workflows', FALSE, FALSE),
  ('canManageWorkflows', 'Manage Workflows', 'Manage workflows', 'Workflows', FALSE, FALSE),
  ('canDeleteWorkflows', 'Delete Workflows', 'Delete workflows', 'Workflows', FALSE, FALSE),
  ('canExecuteWorkflows', 'Execute Workflows', 'Run workflows', 'Workflows', FALSE, FALSE),
  ('canViewWorkflowLogs', 'View Workflow Logs', 'View execution logs', 'Workflows', FALSE, FALSE),

  -- Monitoring
  ('canViewMetrics', 'View Metrics', 'View system metrics', 'Monitoring', FALSE, FALSE),
  ('canViewAlerts', 'View Alerts', 'View alerts', 'Monitoring', FALSE, FALSE),
  ('canManageAlerts', 'Manage Alerts', 'Manage alert rules', 'Monitoring', FALSE, FALSE),
  ('canViewLogs', 'View Logs', 'View system logs', 'Monitoring', FALSE, FALSE),
  ('canExportMetrics', 'Export Metrics', 'Export metrics data', 'Monitoring', FALSE, FALSE),
  ('canManageDashboards', 'Manage Dashboards', 'Manage monitoring dashboards', 'Monitoring', FALSE, FALSE),

  -- Documentation
  ('canViewDocs', 'View Docs', 'View documentation', 'Documentation', FALSE, FALSE),
  ('canEditDocs', 'Edit Docs', 'Edit documentation', 'Documentation', FALSE, FALSE),
  ('canManageDocs', 'Manage Docs', 'Manage documentation', 'Documentation', FALSE, FALSE),
  ('canPublishDocs', 'Publish Docs', 'Publish documentation', 'Documentation', FALSE, FALSE),

  -- Cloud Providers
  ('canViewCloudProviders', 'View Cloud Providers', 'View connected cloud providers', 'Cloud Providers', FALSE, FALSE),
  ('canManageCloudProviders', 'Manage Cloud Providers', 'Connect and manage cloud providers', 'Cloud Providers', FALSE, FALSE)
ON CONFLICT (key) DO NOTHING;

-- Table: roles
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  hierarchy_level INTEGER NOT NULL DEFAULT 100,
  is_system BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT unique_role_per_tenant UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_slug ON roles(tenant_id, slug);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY roles_tenant_isolation ON roles
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: role_permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID,
  CONSTRAINT unique_role_permission UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_tenant_isolation ON role_permissions
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: tenant_members
CREATE TABLE IF NOT EXISTS tenant_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended')),
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_tenant_member UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_role ON tenant_members(role_id);

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_members_tenant_isolation ON tenant_members
  FOR ALL
  USING (tenant_id = current_tenant_id() OR user_id = auth.uid() OR is_global_admin());

-- Triggers
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_members_updated_at BEFORE UPDATE ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Rollback Script

```sql
DROP TABLE IF EXISTS tenant_members CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
```

---

## Migration 004: Infrastructure - Servers and Storage

### Migration Script

```sql
-- ============================================
-- Migration 004: Servers, Volumes, Snapshots
-- ============================================

-- Table: cloud_providers
CREATE TABLE IF NOT EXISTS cloud_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('digitalocean', 'aws', 'gcp', 'azure', 'hetzner', 'linode', 'vultr')),
  name TEXT NOT NULL,
  credentials_encrypted JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'syncing', 'error', 'disconnected')),
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT unique_provider_per_tenant UNIQUE (tenant_id, provider, name)
);

CREATE INDEX IF NOT EXISTS idx_cloud_providers_tenant ON cloud_providers(tenant_id);

ALTER TABLE cloud_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY cloud_providers_tenant_isolation ON cloud_providers
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: servers
CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  region TEXT NOT NULL,
  size TEXT NOT NULL,
  vcpus INTEGER,
  memory_mb INTEGER,
  disk_gb INTEGER,
  ip_address INET,
  private_ip INET,
  ipv6_address INET,
  image TEXT,
  os TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'creating', 'running', 'stopped', 'rebooting',
    'rebuilding', 'migrating', 'error', 'deleted'
  )),
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_servers_tenant ON servers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_servers_provider ON servers(cloud_provider_id);
CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
CREATE INDEX IF NOT EXISTS idx_servers_tenant_status ON servers(tenant_id, status);

ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY servers_tenant_isolation ON servers
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: volumes
CREATE TABLE IF NOT EXISTS volumes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  region TEXT NOT NULL,
  size_gb INTEGER NOT NULL CHECK (size_gb >= 10 AND size_gb <= 10240),
  filesystem_type TEXT DEFAULT 'ext4',
  attached_to_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  mount_path TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
    'creating', 'available', 'attaching', 'attached', 'detaching', 'error', 'deleted'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_volumes_tenant ON volumes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_volumes_server ON volumes(attached_to_server_id);
CREATE INDEX IF NOT EXISTS idx_volumes_status ON volumes(status);

ALTER TABLE volumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY volumes_tenant_isolation ON volumes
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: snapshots
CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('server', 'volume')),
  source_id UUID NOT NULL,
  external_id TEXT,
  name TEXT NOT NULL,
  size_gb INTEGER,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'creating', 'available', 'error', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_tenant ON snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_source ON snapshots(source_type, source_id);

ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY snapshots_tenant_isolation ON snapshots
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Triggers
CREATE TRIGGER update_cloud_providers_updated_at BEFORE UPDATE ON cloud_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_servers_updated_at BEFORE UPDATE ON servers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_volumes_updated_at BEFORE UPDATE ON volumes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Rollback Script

```sql
DROP TABLE IF EXISTS snapshots CASCADE;
DROP TABLE IF EXISTS volumes CASCADE;
DROP TABLE IF EXISTS servers CASCADE;
DROP TABLE IF EXISTS cloud_providers CASCADE;
```

---

## Migration 005: Infrastructure - Networking

### Migration Script

```sql
-- ============================================
-- Migration 005: Networks, Floating IPs
-- ============================================

-- Table: networks
CREATE TABLE IF NOT EXISTS networks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  region TEXT NOT NULL,
  cidr_block TEXT NOT NULL,
  ip_range TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_networks_tenant ON networks(tenant_id);

ALTER TABLE networks ENABLE ROW LEVEL SECURITY;

CREATE POLICY networks_tenant_isolation ON networks
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: network_servers (junction)
CREATE TABLE IF NOT EXISTS network_servers (
  network_id UUID NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (network_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_network_servers_tenant ON network_servers(tenant_id);

ALTER TABLE network_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY network_servers_tenant_isolation ON network_servers
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: floating_ips
CREATE TABLE IF NOT EXISTS floating_ips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  ip_address INET NOT NULL,
  region TEXT NOT NULL,
  external_id TEXT,
  assigned_to_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floating_ips_tenant ON floating_ips(tenant_id);

ALTER TABLE floating_ips ENABLE ROW LEVEL SECURITY;

CREATE POLICY floating_ips_tenant_isolation ON floating_ips
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Triggers
CREATE TRIGGER update_networks_updated_at BEFORE UPDATE ON networks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Rollback Script

```sql
DROP TABLE IF EXISTS floating_ips CASCADE;
DROP TABLE IF EXISTS network_servers CASCADE;
DROP TABLE IF EXISTS networks CASCADE;
```

---

## Migration 006: Infrastructure - Security

### Migration Script

```sql
-- ============================================
-- Migration 006: Firewalls, Load Balancers, DNS
-- ============================================

-- Table: firewalls
CREATE TABLE IF NOT EXISTS firewalls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firewalls_tenant ON firewalls(tenant_id);

ALTER TABLE firewalls ENABLE ROW LEVEL SECURITY;

CREATE POLICY firewalls_tenant_isolation ON firewalls
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: firewall_rules
CREATE TABLE IF NOT EXISTS firewall_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  protocol TEXT NOT NULL CHECK (protocol IN ('tcp', 'udp', 'icmp', 'all')),
  port_range TEXT,
  sources TEXT[] DEFAULT '{}',
  destinations TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firewall_rules_firewall ON firewall_rules(firewall_id);

ALTER TABLE firewall_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY firewall_rules_tenant_isolation ON firewall_rules
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: firewall_servers (junction)
CREATE TABLE IF NOT EXISTS firewall_servers (
  firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (firewall_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_firewall_servers_tenant ON firewall_servers(tenant_id);

ALTER TABLE firewall_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY firewall_servers_tenant_isolation ON firewall_servers
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: load_balancers
CREATE TABLE IF NOT EXISTS load_balancers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  region TEXT NOT NULL,
  algorithm TEXT DEFAULT 'round_robin' CHECK (algorithm IN ('round_robin', 'least_connections', 'ip_hash')),
  ip_address INET,
  health_check_protocol TEXT DEFAULT 'http',
  health_check_port INTEGER DEFAULT 80,
  health_check_path TEXT DEFAULT '/',
  health_check_interval_seconds INTEGER DEFAULT 10,
  ssl_enabled BOOLEAN DEFAULT FALSE,
  ssl_certificate_id UUID,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_load_balancers_tenant ON load_balancers(tenant_id);

ALTER TABLE load_balancers ENABLE ROW LEVEL SECURITY;

CREATE POLICY load_balancers_tenant_isolation ON load_balancers
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: load_balancer_targets
CREATE TABLE IF NOT EXISTS load_balancer_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  load_balancer_id UUID NOT NULL REFERENCES load_balancers(id) ON DELETE CASCADE,
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ip_address INET,
  port INTEGER NOT NULL DEFAULT 80,
  is_healthy BOOLEAN DEFAULT TRUE,
  last_health_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lb_targets_lb ON load_balancer_targets(load_balancer_id);

ALTER TABLE load_balancer_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY lb_targets_tenant_isolation ON load_balancer_targets
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: dns_zones
CREATE TABLE IF NOT EXISTS dns_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dns_zones_tenant ON dns_zones(tenant_id);

ALTER TABLE dns_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY dns_zones_tenant_isolation ON dns_zones
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Table: dns_records
CREATE TABLE IF NOT EXISTS dns_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dns_zone_id UUID NOT NULL REFERENCES dns_zones(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA')),
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  ttl INTEGER DEFAULT 3600,
  priority INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dns_records_zone ON dns_records(dns_zone_id);

ALTER TABLE dns_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY dns_records_tenant_isolation ON dns_records
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Triggers
CREATE TRIGGER update_firewalls_updated_at BEFORE UPDATE ON firewalls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_load_balancers_updated_at BEFORE UPDATE ON load_balancers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dns_zones_updated_at BEFORE UPDATE ON dns_zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dns_records_updated_at BEFORE UPDATE ON dns_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Rollback Script

```sql
DROP TABLE IF EXISTS dns_records CASCADE;
DROP TABLE IF EXISTS dns_zones CASCADE;
DROP TABLE IF EXISTS load_balancer_targets CASCADE;
DROP TABLE IF EXISTS load_balancers CASCADE;
DROP TABLE IF EXISTS firewall_servers CASCADE;
DROP TABLE IF EXISTS firewall_rules CASCADE;
DROP TABLE IF EXISTS firewalls CASCADE;
```

---

## Migration 007 - 013

> **Note:** For brevity, migrations 007-013 follow the same pattern as above.
> See `db_contract.md` for complete table definitions for:
> - Migration 007: Secrets and Variables
> - Migration 008: Webhooks
> - Migration 009: Billing
> - Migration 010: Compliance (GDPR/CCPA)
> - Migration 011: Audit Logging (see BACKEND_DATABASE_MIGRATIONS.sql)
> - Migration 012: Workflows and Nodes
> - Migration 013: Provider Resource Mapping

---

## Migration 013: Provider Resource Mapping

### Purpose
Enable multi-cloud provider resource mapping.

### Migration Script

```sql
-- ============================================
-- Migration 013: Provider Resource Mapping
-- ============================================

CREATE TABLE IF NOT EXISTS provider_resource_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_region TEXT,
  provider_project_id TEXT,
  resource_type TEXT NOT NULL,
  internal_resource_id UUID NOT NULL,
  provider_resource_id TEXT NOT NULL,
  metadata JSONB,
  sync_status TEXT DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'error')),
  last_synced_at TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_resource_map_tenant ON provider_resource_map(tenant_id);
CREATE INDEX IF NOT EXISTS idx_provider_resource_map_internal ON provider_resource_map(internal_resource_id);
CREATE INDEX IF NOT EXISTS idx_provider_resource_map_provider ON provider_resource_map(provider, provider_resource_id);
CREATE INDEX IF NOT EXISTS idx_provider_resource_map_lookup ON provider_resource_map(tenant_id, provider, resource_type, internal_resource_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_resource_map_internal ON provider_resource_map(tenant_id, resource_type, internal_resource_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_resource_map_external ON provider_resource_map(provider, provider_resource_id);

ALTER TABLE provider_resource_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_resource_map_tenant_isolation ON provider_resource_map
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_global_admin());

CREATE TRIGGER update_provider_resource_map_updated_at BEFORE UPDATE ON provider_resource_map
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Rollback Script

```sql
DROP TABLE IF EXISTS provider_resource_map CASCADE;
```

---

## Post-Migration Tasks

### 1. Verify RLS is Enabled

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

### 2. Create Session Cleanup Job

```sql
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron or external cron
-- SELECT cron.schedule('cleanup-sessions', '0 * * * *', 'SELECT cleanup_expired_sessions()');
```

### 3. Seed Default Roles for New Tenants

```sql
CREATE OR REPLACE FUNCTION seed_default_roles(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO roles (tenant_id, name, slug, hierarchy_level, is_system)
  VALUES
    (p_tenant_id, 'Owner', 'owner', 0, TRUE),
    (p_tenant_id, 'Admin', 'admin', 10, TRUE),
    (p_tenant_id, 'Billing Admin', 'billing_admin', 20, TRUE),
    (p_tenant_id, 'Developer', 'developer', 30, TRUE),
    (p_tenant_id, 'Member', 'member', 50, TRUE),
    (p_tenant_id, 'Viewer', 'viewer', 100, TRUE);
END;
$$ LANGUAGE plpgsql;
```

---

## Testing Checklist

### Per-Migration Tests
- [ ] Migration executes without errors
- [ ] All tables created successfully
- [ ] All indexes created successfully
- [ ] RLS policies applied correctly
- [ ] Foreign key constraints working
- [ ] Check constraints enforced
- [ ] Rollback script works correctly

### Integration Tests
- [ ] Can create tenant and users
- [ ] Can assign roles to users
- [ ] Can create infrastructure resources
- [ ] RLS prevents cross-tenant data access
- [ ] Session management works correctly
- [ ] Cascade deletes work as expected

### Security Tests
- [ ] Cannot access other tenant's data
- [ ] Cannot bypass RLS policies
- [ ] Permission checks enforced
- [ ] Audit logs captured correctly

---

## Notes

1. **Tenant Isolation**: All tenant-scoped tables have RLS enabled
2. **Session Context**: `current_tenant_id()` must be set via application layer
3. **System Roles**: Cannot be deleted (is_system = TRUE)
4. **Soft Deletes**: Use deleted_at for user retention requirements
5. **Cascade Behavior**: Most FKs use ON DELETE CASCADE
6. **Idempotency**: All migrations use IF NOT EXISTS

---

## Changelog

### v2.0.0 (January 26, 2026)

- Complete rewrite based on UI implementation
- Added 114 permissions (up from 30)
- Added GDPR/CCPA compliance tables
- Added billing tables
- Added workflow/node tables
- Added provider resource mapping
- Standardized RLS patterns
