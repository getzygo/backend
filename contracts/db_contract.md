# Zygo Database Contract

**Version:** 2.0
**Last Updated:** January 26, 2026
**Database:** PostgreSQL 14+ with Supabase
**Compliance:** GDPR, CCPA, CPRA, APPI, SOC2, ISO 27001

---

## Table of Contents

1. [Overview](#overview)
2. [Extensions & Configuration](#extensions--configuration)
3. [Core Schemas](#core-schemas)
4. [Table Definitions](#table-definitions)
   - [Tenancy Tables](#1-tenancy-tables)
   - [RBAC Tables](#2-rbac-tables)
   - [User Tables](#3-user-tables)
   - [Infrastructure Tables](#4-infrastructure-tables)
   - [Secrets & Variables Tables](#5-secrets--variables-tables)
   - [Webhook Tables](#6-webhook-tables)
   - [Billing Tables](#7-billing-tables)
   - [Compliance Tables](#8-compliance-tables)
   - [Audit Tables](#9-audit-tables)
   - [Node/Workflow Tables](#10-nodeworkflow-tables)
5. [Row-Level Security (RLS)](#row-level-security-rls)
6. [Indexes](#indexes)
7. [Triggers](#triggers)
8. [Functions](#functions)
9. [Views](#views)
10. [Migration Order](#migration-order)

---

## Overview

### Database Statistics

| Category | Table Count | RLS Enabled |
|----------|-------------|-------------|
| Tenancy | 4 | ✅ |
| RBAC | 4 | ✅ |
| Users | 4 | ✅ |
| Infrastructure | 12 | ✅ |
| Secrets/Variables | 4 | ✅ |
| Webhooks | 2 | ✅ |
| Billing | 5 | ✅ |
| Compliance | 6 | ✅ |
| Audit | 5 | ✅ |
| Node/Workflows | 8 | ✅ |
| **Total** | **54** | **✅** |

### Multi-Tenant Architecture

All tables follow strict tenant isolation:
- Every table has `tenant_id UUID NOT NULL` column
- Row-Level Security (RLS) enforced on all tables
- Tenant context extracted from JWT claims
- Cross-tenant queries prevented at database level

---

## Extensions & Configuration

```sql
-- Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- Cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- Full-text search
CREATE EXTENSION IF NOT EXISTS "postgis";         -- Geospatial (optional)

-- Configuration
ALTER DATABASE zygo SET timezone TO 'UTC';
ALTER DATABASE zygo SET statement_timeout TO '30s';
```

---

## Core Schemas

```sql
-- Main application schema (default: public)
-- CREATE SCHEMA IF NOT EXISTS public;

-- Audit logging schema (isolated)
CREATE SCHEMA IF NOT EXISTS audit;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA audit TO authenticated;
```

---

## Table Definitions

### 1. Tenancy Tables

#### tenants

Primary tenant/organization table.

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT UNIQUE,                    -- Custom domain (tenant.example.com)

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
  billing_address_line_1 TEXT,
  billing_address_line_2 TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_postal_code TEXT,
  billing_country TEXT,
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

CREATE UNIQUE INDEX idx_tenants_slug ON tenants(slug);
CREATE UNIQUE INDEX idx_tenants_domain ON tenants(domain) WHERE domain IS NOT NULL;
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_company_name ON tenants(company_name);
```

#### tenant_config

Extended tenant configuration.

```sql
CREATE TABLE tenant_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Authentication Settings
  auth_providers JSONB DEFAULT '["email"]',     -- ["email", "google", "github", "saml"]
  mfa_required BOOLEAN DEFAULT FALSE,
  session_timeout_minutes INTEGER DEFAULT 1440,  -- 24 hours

  -- Feature Flags
  feature_flags JSONB DEFAULT '{
    "aiWorkflows": true,
    "advancedAnalytics": false,
    "customBranding": false,
    "sso": false,
    "multiCloud": false
  }',

  -- Limits
  max_users INTEGER DEFAULT 5,
  max_servers INTEGER DEFAULT 10,
  max_workflows INTEGER DEFAULT 100,
  max_storage_gb INTEGER DEFAULT 10,

  -- Notifications
  notification_settings JSONB DEFAULT '{
    "email": true,
    "slack": false,
    "webhook": false
  }',

  -- Demo Mode
  is_demo BOOLEAN DEFAULT FALSE,
  demo_expires_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_tenant_config UNIQUE (tenant_id)
);

CREATE INDEX idx_tenant_config_tenant ON tenant_config(tenant_id);
```

#### tenant_members

Maps users to tenants with their role.

```sql
CREATE TABLE tenant_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended')),

  -- Invitation
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_tenant_member UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_tenant_members_tenant ON tenant_members(tenant_id);
CREATE INDEX idx_tenant_members_user ON tenant_members(user_id);
```

#### tenant_invitations

Pending invitations to join a tenant.

```sql
CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Invitation Details
  email TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id),
  token TEXT NOT NULL UNIQUE,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),

  -- Tracking
  invited_by UUID NOT NULL REFERENCES users(id),
  accepted_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_pending_invitation UNIQUE (tenant_id, email, status)
);

CREATE INDEX idx_tenant_invitations_tenant ON tenant_invitations(tenant_id);
CREATE INDEX idx_tenant_invitations_email ON tenant_invitations(email);
CREATE INDEX idx_tenant_invitations_token ON tenant_invitations(token);
```

---

### 2. RBAC Tables

> **Granular RBAC Architecture:** Zygo implements a fully granular RBAC system where tenants can create unlimited custom roles with any combination of 114 permissions. System roles (owner, admin, billing_admin, developer, member, viewer) are predefined and cannot be modified, serving as templates for common access patterns.

#### roles

Role definitions per tenant. Supports both system (predefined) and custom roles.

- **System Roles:** `is_system = true` - Cannot be modified or deleted. Seeded on tenant creation.
- **Custom Roles:** `is_system = false` - Fully editable by tenant administrators.

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Role Identity
  name TEXT NOT NULL,                 -- Display name (e.g., 'Security Auditor')
  slug TEXT NOT NULL,                 -- Unique identifier (e.g., 'security_auditor')
  description TEXT,

  -- Hierarchy (lower = more privileged)
  -- Owner=1, Admin=10, Developer=20, Support=30, Billing Admin=50, Member=60, Viewer=90
  hierarchy_level INTEGER NOT NULL DEFAULT 100,

  -- Flags
  is_system BOOLEAN DEFAULT FALSE,    -- System roles cannot be modified/deleted
  is_default BOOLEAN DEFAULT FALSE,   -- Assigned to new users automatically

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,                    -- NULL for system roles

  CONSTRAINT unique_role_per_tenant UNIQUE (tenant_id, slug),
  CONSTRAINT valid_hierarchy CHECK (hierarchy_level BETWEEN 1 AND 100)
);

CREATE INDEX idx_roles_tenant ON roles(tenant_id);
CREATE INDEX idx_roles_slug ON roles(tenant_id, slug);
CREATE INDEX idx_roles_hierarchy ON roles(tenant_id, hierarchy_level);

-- System roles are seeded on tenant creation:
-- INSERT INTO roles (tenant_id, name, slug, hierarchy_level, is_system) VALUES
--   (tenant_id, 'Owner', 'owner', 1, true),
--   (tenant_id, 'Admin', 'admin', 10, true),
--   (tenant_id, 'Developer', 'developer', 20, true),
--   (tenant_id, 'Support', 'support', 30, true),
--   (tenant_id, 'Billing Admin', 'billing_admin', 50, true),
--   (tenant_id, 'Member', 'member', 60, true),
--   (tenant_id, 'Viewer', 'viewer', 90, true);
```

#### permissions

Permission definitions (global, seeded once).

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Permission Identity
  key TEXT NOT NULL UNIQUE,           -- e.g., 'canManageUsers'
  name TEXT NOT NULL,                 -- e.g., 'Manage Users'
  description TEXT,

  -- Categorization
  category TEXT NOT NULL,             -- e.g., 'User Management'
  subcategory TEXT,

  -- Risk Level
  is_critical BOOLEAN DEFAULT FALSE,
  requires_mfa BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_permissions_key ON permissions(key);
CREATE INDEX idx_permissions_category ON permissions(category);
```

#### role_permissions

Maps roles to permissions.

```sql
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,

  -- Optional: Tenant-specific (for custom roles)
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Metadata
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID,

  CONSTRAINT unique_role_permission UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);
```

#### user_permissions

Direct user permissions (override or addition to role).

```sql
CREATE TABLE user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Grant Type
  grant_type TEXT NOT NULL DEFAULT 'grant' CHECK (grant_type IN ('grant', 'deny')),

  -- Expiration (optional time-limited permissions)
  expires_at TIMESTAMPTZ,

  -- Metadata
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID,

  CONSTRAINT unique_user_permission UNIQUE (user_id, permission_id, tenant_id)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id, tenant_id);
```

---

### 3. User Tables

#### users

Core user table (extends Supabase auth.users).

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Profile
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  avatar_url TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'deleted')),

  -- Authentication
  email_verified BOOLEAN DEFAULT FALSE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,

  -- Preferences
  preferences JSONB DEFAULT '{
    "theme": "system",
    "language": "en",
    "timezone": "UTC",
    "notifications": {
      "email": true,
      "push": true
    }
  }',

  -- Global Admin (not tenant-specific)
  is_global_admin BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_global_admin ON users(is_global_admin) WHERE is_global_admin = TRUE;
```

#### user_sessions

Active user sessions.

```sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Session Details
  token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT,

  -- Device Info
  device_id TEXT,
  device_type TEXT,                   -- 'desktop', 'mobile', 'tablet'
  browser TEXT,
  os TEXT,

  -- Location
  ip_address INET NOT NULL,
  geo_country TEXT,
  geo_city TEXT,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),

  -- Expiration
  expires_at TIMESTAMPTZ NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_tenant ON user_sessions(tenant_id);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active, expires_at);
```

#### user_mfa

MFA configuration per user.

```sql
CREATE TABLE user_mfa (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- MFA Type
  type TEXT NOT NULL CHECK (type IN ('totp', 'sms', 'email', 'webauthn')),

  -- Secret (encrypted)
  secret_encrypted TEXT NOT NULL,

  -- Backup Codes (hashed)
  backup_codes_hashed TEXT[],
  backup_codes_used INTEGER DEFAULT 0,

  -- Status
  is_verified BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,

  CONSTRAINT unique_user_mfa_type UNIQUE (user_id, type)
);

CREATE INDEX idx_user_mfa_user ON user_mfa(user_id);
```

#### user_api_keys (Deprecated)

> **Note**: This table has been superseded by the `api_keys` table in the Secrets & Variables section.
> The new table includes enhanced features: usage tracking, IP logging, revocation audit trail, and RLS policies.
> See [api_keys](#api_keys) in section 5 for the current implementation.

```sql
-- DEPRECATED: Use api_keys table instead
-- See Section 5: Secrets & Variables Tables for the comprehensive api_keys table
-- with tenant isolation, RLS policies, and enhanced audit fields.
```

---

### 4. Infrastructure Tables

#### cloud_providers

Connected cloud provider accounts.

```sql
CREATE TABLE cloud_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Provider Info
  provider TEXT NOT NULL CHECK (provider IN ('digitalocean', 'aws', 'gcp', 'azure', 'hetzner', 'linode', 'vultr')),
  name TEXT NOT NULL,

  -- Credentials (encrypted)
  credentials_encrypted JSONB NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'syncing', 'error', 'disconnected')),
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,

  CONSTRAINT unique_provider_per_tenant UNIQUE (tenant_id, provider, name)
);

CREATE INDEX idx_cloud_providers_tenant ON cloud_providers(tenant_id);
```

#### servers

Compute instances/servers.

```sql
CREATE TABLE servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- Identity
  name TEXT NOT NULL,
  external_id TEXT,                   -- Provider's server ID

  -- Specifications
  region TEXT NOT NULL,
  size TEXT NOT NULL,                 -- e.g., 's-1vcpu-1gb'
  vcpus INTEGER,
  memory_mb INTEGER,
  disk_gb INTEGER,

  -- Network
  ip_address INET,
  private_ip INET,
  ipv6_address INET,

  -- Image
  image TEXT,
  os TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'creating', 'running', 'stopped', 'rebooting',
    'rebuilding', 'migrating', 'error', 'deleted'
  )),

  -- Tags
  tags JSONB DEFAULT '[]',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_servers_tenant ON servers(tenant_id);
CREATE INDEX idx_servers_provider ON servers(cloud_provider_id);
CREATE INDEX idx_servers_status ON servers(status);
```

#### volumes

Block storage volumes.

```sql
CREATE TABLE volumes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- Identity
  name TEXT NOT NULL,
  external_id TEXT,

  -- Specifications
  region TEXT NOT NULL,
  size_gb INTEGER NOT NULL,
  filesystem_type TEXT DEFAULT 'ext4',

  -- Attachment
  attached_to_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  mount_path TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
    'creating', 'available', 'attaching', 'attached', 'detaching', 'error', 'deleted'
  )),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_volumes_tenant ON volumes(tenant_id);
CREATE INDEX idx_volumes_server ON volumes(attached_to_server_id);
```

#### networks

VPC/Private networks.

```sql
CREATE TABLE networks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- Identity
  name TEXT NOT NULL,
  external_id TEXT,

  -- Configuration
  region TEXT NOT NULL,
  cidr_block TEXT NOT NULL,           -- e.g., '10.0.0.0/16'
  ip_range TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'available',
  is_default BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_networks_tenant ON networks(tenant_id);
```

#### firewalls

Firewall rules/security groups.

```sql
CREATE TABLE firewalls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- Identity
  name TEXT NOT NULL,
  external_id TEXT,
  description TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE firewall_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Rule Definition
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  protocol TEXT NOT NULL CHECK (protocol IN ('tcp', 'udp', 'icmp', 'all')),
  port_range TEXT,                    -- e.g., '80', '8000-9000', 'all'

  -- Source/Destination
  sources TEXT[] DEFAULT '{}',        -- CIDR blocks or 'any'
  destinations TEXT[] DEFAULT '{}',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_firewalls_tenant ON firewalls(tenant_id);
CREATE INDEX idx_firewall_rules_firewall ON firewall_rules(firewall_id);
```

#### load_balancers

Load balancer configurations.

```sql
CREATE TABLE load_balancers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- Identity
  name TEXT NOT NULL,
  external_id TEXT,

  -- Configuration
  region TEXT NOT NULL,
  algorithm TEXT DEFAULT 'round_robin' CHECK (algorithm IN ('round_robin', 'least_connections', 'ip_hash')),

  -- Network
  ip_address INET,

  -- Health Check
  health_check_protocol TEXT DEFAULT 'http',
  health_check_port INTEGER DEFAULT 80,
  health_check_path TEXT DEFAULT '/',
  health_check_interval_seconds INTEGER DEFAULT 10,

  -- SSL
  ssl_enabled BOOLEAN DEFAULT FALSE,
  ssl_certificate_id UUID,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE load_balancer_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  load_balancer_id UUID NOT NULL REFERENCES load_balancers(id) ON DELETE CASCADE,
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Target
  ip_address INET,
  port INTEGER NOT NULL DEFAULT 80,

  -- Health
  is_healthy BOOLEAN DEFAULT TRUE,
  last_health_check TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_load_balancers_tenant ON load_balancers(tenant_id);
CREATE INDEX idx_lb_targets_lb ON load_balancer_targets(load_balancer_id);
```

#### dns_zones

DNS zone management.

```sql
CREATE TABLE dns_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- Zone Info
  name TEXT NOT NULL,                 -- e.g., 'example.com'
  external_id TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dns_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dns_zone_id UUID NOT NULL REFERENCES dns_zones(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Record
  type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA')),
  name TEXT NOT NULL,                 -- e.g., 'www', '@'
  value TEXT NOT NULL,
  ttl INTEGER DEFAULT 3600,
  priority INTEGER,                   -- For MX records

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dns_zones_tenant ON dns_zones(tenant_id);
CREATE INDEX idx_dns_records_zone ON dns_records(dns_zone_id);
```

#### snapshots

Server/volume snapshots.

```sql
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Source
  source_type TEXT NOT NULL CHECK (source_type IN ('server', 'volume')),
  source_id UUID NOT NULL,
  external_id TEXT,

  -- Details
  name TEXT NOT NULL,
  size_gb INTEGER,
  region TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'creating', 'available', 'error', 'deleted')),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_tenant ON snapshots(tenant_id);
CREATE INDEX idx_snapshots_source ON snapshots(source_type, source_id);
```

#### floating_ips

Reserved/floating IP addresses.

```sql
CREATE TABLE floating_ips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloud_provider_id UUID REFERENCES cloud_providers(id) ON DELETE SET NULL,

  -- IP Details
  ip_address INET NOT NULL,
  region TEXT NOT NULL,
  external_id TEXT,

  -- Assignment
  assigned_to_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'available',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_floating_ips_tenant ON floating_ips(tenant_id);
```

#### ssl_certificates

SSL/TLS certificates.

```sql
CREATE TABLE ssl_certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Certificate Info
  name TEXT NOT NULL,
  domain TEXT NOT NULL,

  -- Certificate Data (encrypted)
  certificate_pem_encrypted TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  chain_pem_encrypted TEXT,

  -- Validity
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,

  -- Type
  type TEXT DEFAULT 'custom' CHECK (type IN ('custom', 'lets_encrypt', 'managed')),
  auto_renew BOOLEAN DEFAULT FALSE,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ssl_certs_tenant ON ssl_certificates(tenant_id);
CREATE INDEX idx_ssl_certs_expires ON ssl_certificates(expires_at);
```

---

### 5. Secrets & Variables Tables

#### environment_variables

User-managed environment variables and secrets with encryption and three-level scoping.

> **Important**: This is the primary table for user-managed secrets and credentials.
> See [SECRETS_AND_ENVIRONMENT.md](./SECRETS_AND_ENVIRONMENT.md) for complete feature documentation.

```sql
CREATE TABLE environment_variables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,                 -- Variable name (e.g., OPENAI_API_KEY)
  display_name TEXT,                  -- Human-readable name
  description TEXT,

  -- Classification
  service TEXT NOT NULL DEFAULT 'custom',  -- Service identifier (openai, stripe, etc.)
  type TEXT NOT NULL DEFAULT 'secret' CHECK (type IN ('text', 'secret', 'multiline', 'url', 'number', 'json')),
  category TEXT NOT NULL DEFAULT 'Custom', -- UI category (LLM, Cloud, etc.)

  -- Scope (three-level: workspace > project > runtime)
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'project', 'runtime')),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Security (NO plaintext value stored!)
  value_encrypted TEXT NOT NULL,       -- AES-256-GCM encrypted value
  value_prefix TEXT NOT NULL,          -- First 6 chars for identification
  value_suffix TEXT NOT NULL,          -- Last 4 chars for identification
  value_hash TEXT NOT NULL,            -- SHA-256 hash for verification
  encryption_key_id UUID NOT NULL REFERENCES encryption_keys(id),

  -- Flags
  is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  can_rotate BOOLEAN NOT NULL DEFAULT TRUE,

  -- Template Reference
  template_id TEXT,                    -- If created from template

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id),
  last_accessed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT unique_name_per_scope UNIQUE (tenant_id, name, scope, project_id),
  CONSTRAINT project_required_for_project_scope
    CHECK (scope != 'project' OR project_id IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_env_vars_tenant ON environment_variables(tenant_id);
CREATE INDEX idx_env_vars_scope ON environment_variables(tenant_id, scope);
CREATE INDEX idx_env_vars_project ON environment_variables(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_env_vars_service ON environment_variables(tenant_id, service);
CREATE INDEX idx_env_vars_name ON environment_variables(tenant_id, name);

-- RLS (tenant isolation is MANDATORY)
ALTER TABLE environment_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY env_vars_tenant_isolation ON environment_variables
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

#### api_keys

Tenant-scoped API keys for programmatic access.

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Key (hash only, NEVER store plaintext)
  key_prefix TEXT NOT NULL,            -- e.g., "zygo_live_sk_12345..."
  key_hash TEXT NOT NULL UNIQUE,       -- SHA-256 hash for verification

  -- Permissions
  permissions TEXT[] NOT NULL DEFAULT '{}',  -- e.g., ['servers:read', 'workflows:execute']

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),

  -- Expiration
  expires_at TIMESTAMPTZ,

  -- Usage Tracking
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),

  -- Constraints
  CONSTRAINT unique_key_name_per_tenant UNIQUE (tenant_id, name)
);

-- Indexes
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(tenant_id, status);

-- RLS (tenant isolation is MANDATORY)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_tenant_isolation ON api_keys
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

#### secret_access_log

Audit trail for secret and API key access.

```sql
CREATE TABLE secret_access_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Target (polymorphic: env var or API key)
  target_type TEXT NOT NULL CHECK (target_type IN ('environment_variable', 'api_key')),
  target_id UUID NOT NULL,

  -- Actor
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'api_key', 'workflow')),
  actor_id UUID NOT NULL,
  actor_email TEXT,

  -- Access Details
  access_type TEXT NOT NULL CHECK (access_type IN ('view', 'copy', 'use', 'export', 'rotate', 'create', 'delete')),
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  -- Context
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',         -- Additional context (scope, fields_changed, etc.)

  -- Metadata
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_secret_access_tenant ON secret_access_log(tenant_id);
CREATE INDEX idx_secret_access_target ON secret_access_log(target_type, target_id);
CREATE INDEX idx_secret_access_actor ON secret_access_log(actor_type, actor_id);
CREATE INDEX idx_secret_access_time ON secret_access_log(tenant_id, accessed_at DESC);

-- RLS
ALTER TABLE secret_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY secret_access_tenant_isolation ON secret_access_log
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

#### encryption_keys

Per-tenant encryption key management for secrets.

```sql
CREATE TABLE encryption_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Key Info
  key_id TEXT NOT NULL UNIQUE,        -- External key ID (e.g., AWS KMS, Vault)
  algorithm TEXT DEFAULT 'AES-256-GCM',

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'retired')),

  -- Rotation
  rotated_at TIMESTAMPTZ,
  next_rotation_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_encryption_keys_tenant ON encryption_keys(tenant_id);
CREATE INDEX idx_encryption_keys_status ON encryption_keys(tenant_id, status);

-- RLS
ALTER TABLE encryption_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY encryption_keys_tenant_isolation ON encryption_keys
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

#### env_var_templates

Pre-configured templates for popular services (102+ templates).

```sql
CREATE TABLE env_var_templates (
  id TEXT PRIMARY KEY,                 -- e.g., 'openai', 'stripe'
  name TEXT NOT NULL,                  -- Service name
  slug TEXT NOT NULL UNIQUE,           -- URL-safe identifier
  category TEXT NOT NULL,              -- Category (llm, cloud, payments, etc.)
  category_label TEXT NOT NULL,        -- Human-readable category
  icon TEXT,                           -- Icon URL or component name

  -- Configuration (stored as JSONB)
  credential_fields JSONB NOT NULL DEFAULT '[]',
  additional_fields JSONB DEFAULT '[]',

  -- Documentation
  documentation JSONB DEFAULT '[]',    -- Array of setup instructions
  documentation_url TEXT,
  setup_guide_url TEXT,
  credentials_url TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: Templates are GLOBAL (not tenant-scoped) - read-only for tenants
CREATE INDEX idx_templates_category ON env_var_templates(category);
CREATE INDEX idx_templates_slug ON env_var_templates(slug);
```

---

### 6. Webhook Tables

#### webhooks

Webhook endpoint configurations.

```sql
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Configuration
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,

  -- Events
  events TEXT[] NOT NULL,             -- Array of event types to subscribe

  -- Security
  secret_hash TEXT NOT NULL,          -- Hashed webhook secret

  -- Headers
  custom_headers JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Retry Configuration
  max_retries INTEGER DEFAULT 3,
  retry_interval_seconds INTEGER DEFAULT 60,

  -- Stats
  last_triggered_at TIMESTAMPTZ,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);
CREATE INDEX idx_webhooks_active ON webhooks(is_active, tenant_id);
```

#### webhook_deliveries

Webhook delivery attempts and history.

```sql
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Event
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,

  -- Delivery
  attempt_number INTEGER DEFAULT 1,

  -- Response
  response_status INTEGER,
  response_body TEXT,
  response_headers JSONB,

  -- Timing
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_received_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  error_message TEXT,

  -- Next Retry
  next_retry_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status, next_retry_at);
```

---

### 7. Billing Tables

#### subscriptions

Tenant subscription details.

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Plan
  plan TEXT NOT NULL CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled', 'paused', 'trialing')),

  -- Stripe
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,

  -- Billing
  billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Trial
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,

  -- Cancellation
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_tenant_subscription UNIQUE (tenant_id)
);

CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_customer_id);
```

#### payment_methods

Saved payment methods.

```sql
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Stripe
  stripe_payment_method_id TEXT NOT NULL UNIQUE,

  -- Card Details (non-sensitive)
  type TEXT NOT NULL DEFAULT 'card',
  card_brand TEXT,                    -- 'visa', 'mastercard', etc.
  card_last4 TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,

  -- Billing Address
  billing_name TEXT,
  billing_email TEXT,
  billing_address JSONB,

  -- Status
  is_default BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_tenant ON payment_methods(tenant_id);
```

#### invoices

Billing invoices.

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),

  -- Stripe
  stripe_invoice_id TEXT UNIQUE,

  -- Invoice Details
  number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),

  -- Amounts (in cents)
  subtotal INTEGER NOT NULL,
  tax INTEGER DEFAULT 0,
  total INTEGER NOT NULL,
  amount_paid INTEGER DEFAULT 0,
  amount_due INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',

  -- Period
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,

  -- Dates
  invoice_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,

  -- PDF
  invoice_pdf_url TEXT,
  hosted_invoice_url TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_invoices_stripe ON invoices(stripe_invoice_id);
```

#### usage_records

Usage-based billing records.

```sql
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),

  -- Usage Type
  metric TEXT NOT NULL,               -- e.g., 'compute_hours', 'storage_gb', 'api_calls'

  -- Usage
  quantity DECIMAL NOT NULL,
  unit TEXT NOT NULL,

  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Stripe
  stripe_usage_record_id TEXT,

  -- Metadata
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_records_tenant ON usage_records(tenant_id, period_start);
CREATE INDEX idx_usage_records_metric ON usage_records(metric, period_start);
```

#### billing_alerts

Billing threshold alerts.

```sql
CREATE TABLE billing_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Alert Configuration
  metric TEXT NOT NULL,
  threshold DECIMAL NOT NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('gt', 'gte', 'lt', 'lte')),

  -- Notification
  notify_email BOOLEAN DEFAULT TRUE,
  notify_webhook BOOLEAN DEFAULT FALSE,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_alerts_tenant ON billing_alerts(tenant_id);
```

#### licenses

Individual license assignments to users.

```sql
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,

  -- License Details
  tier TEXT NOT NULL CHECK (tier IN ('free', 'basic', 'business', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'active', 'inactive', 'pending')),

  -- Assignment
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id),

  -- Billing
  price_per_month INTEGER,              -- Price in cents

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_licenses_tenant ON licenses(tenant_id);
CREATE INDEX idx_licenses_user ON licenses(assigned_to_user_id);
CREATE INDEX idx_licenses_status ON licenses(tenant_id, status);
```

#### token_packages

Available token packages for purchase.

```sql
CREATE TABLE token_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Package Details
  name TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  price INTEGER NOT NULL,               -- Price in cents
  price_per_thousand DECIMAL(10, 2),
  savings_percentage DECIMAL(5, 2),

  -- Availability
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### token_purchases

One-time token package purchases.

```sql
CREATE TABLE token_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  -- Purchase Details
  package_id UUID REFERENCES token_packages(id),
  tokens_purchased INTEGER NOT NULL,
  price_paid INTEGER NOT NULL,          -- Price in cents
  currency TEXT DEFAULT 'usd',

  -- Payment
  stripe_payment_intent_id TEXT,
  payment_method_id UUID REFERENCES payment_methods(id),

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),

  -- Metadata
  purchased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_purchases_tenant ON token_purchases(tenant_id);
CREATE INDEX idx_token_purchases_status ON token_purchases(status);
```

#### token_balances

Current token balances per tenant.

```sql
CREATE TABLE token_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Monthly Allocation
  monthly_included INTEGER NOT NULL DEFAULT 0,
  monthly_used INTEGER NOT NULL DEFAULT 0,
  monthly_reset_date DATE NOT NULL,

  -- Purchased Tokens
  purchased_balance INTEGER NOT NULL DEFAULT 0,
  purchased_used INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_tenant_balance UNIQUE (tenant_id)
);

CREATE INDEX idx_token_balances_tenant ON token_balances(tenant_id);
```

#### password_reset_tokens

Tokens for password reset flow.

```sql
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Token
  token_hash TEXT NOT NULL UNIQUE,
  verification_code TEXT,               -- 6-digit code (hashed)

  -- Status
  code_verified BOOLEAN DEFAULT FALSE,
  is_used BOOLEAN DEFAULT FALSE,

  -- Expiration
  expires_at TIMESTAMPTZ NOT NULL,

  -- Security
  ip_address INET,
  user_agent TEXT,
  attempts INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_token ON password_reset_tokens(token_hash);
```

#### verification_codes

Generic verification codes for email/phone verification.

```sql
CREATE TABLE verification_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Verification Type
  type TEXT NOT NULL CHECK (type IN ('email', 'phone', 'mfa_setup')),
  target TEXT NOT NULL,                 -- Email address or phone number

  -- Code
  code_hash TEXT NOT NULL,              -- SHA-256 hash of 6-digit code

  -- Status
  is_verified BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,

  -- Expiration
  expires_at TIMESTAMPTZ NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

CREATE INDEX idx_verification_codes_user ON verification_codes(user_id);
CREATE INDEX idx_verification_codes_type ON verification_codes(type, target);
```

#### oauth_connections

OAuth provider connections for users.

```sql
CREATE TABLE oauth_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Provider Details
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'microsoft', 'apple')),
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,

  -- Tokens (encrypted)
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,

  -- Profile
  profile_data JSONB,                   -- Provider-specific profile info

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,

  CONSTRAINT unique_user_provider UNIQUE (user_id, provider),
  CONSTRAINT unique_provider_user_id UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_connections_user ON oauth_connections(user_id);
CREATE INDEX idx_oauth_connections_provider ON oauth_connections(provider, provider_user_id);
```

#### team_invitations

Enhanced invitation tracking for billing/licensing.

```sql
CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Invitation Details
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  license_tier TEXT CHECK (license_tier IN ('free', 'basic', 'business')),

  -- Token
  token_hash TEXT NOT NULL UNIQUE,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),

  -- Metadata
  invited_by UUID NOT NULL REFERENCES users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),

  CONSTRAINT unique_tenant_email_invite UNIQUE (tenant_id, email, status)
);

CREATE INDEX idx_team_invitations_tenant ON team_invitations(tenant_id);
CREATE INDEX idx_team_invitations_email ON team_invitations(email);
CREATE INDEX idx_team_invitations_token ON team_invitations(token_hash);
```

---

### 8. Compliance Tables

#### consent_records

GDPR consent tracking.

```sql
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Consent Type
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'terms_of_service',
    'privacy_policy',
    'marketing_emails',
    'analytics',
    'third_party_sharing',
    'cookies_essential',
    'cookies_analytics',
    'cookies_marketing'
  )),

  -- Consent Details
  granted BOOLEAN NOT NULL,
  version TEXT NOT NULL,              -- Version of policy consented to

  -- Collection Context
  ip_address INET,
  user_agent TEXT,
  collection_method TEXT,             -- 'explicit', 'implicit', 'checkbox'

  -- Timestamps
  granted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consent_records_user ON consent_records(user_id, tenant_id);
CREATE INDEX idx_consent_records_type ON consent_records(consent_type, granted);
```

#### data_export_requests

GDPR data export (portability) requests.

```sql
CREATE TABLE data_export_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Request Details
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  format TEXT DEFAULT 'json' CHECK (format IN ('json', 'csv', 'xml')),

  -- Scope
  include_categories TEXT[] DEFAULT '{"profile", "activity", "preferences"}',

  -- Result
  file_url TEXT,
  file_size_bytes BIGINT,
  download_expires_at TIMESTAMPTZ,
  download_count INTEGER DEFAULT 0,

  -- Processing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  -- Verification
  verification_token_hash TEXT,
  verified_at TIMESTAMPTZ,

  -- Metadata
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_export_requests_user ON data_export_requests(user_id, tenant_id);
CREATE INDEX idx_export_requests_status ON data_export_requests(status);
```

#### data_deletion_requests

GDPR right to erasure requests.

```sql
CREATE TABLE data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  -- Request Details
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'processing', 'completed', 'rejected', 'cancelled'
  )),

  -- Scope
  deletion_type TEXT NOT NULL CHECK (deletion_type IN ('full', 'partial')),
  categories_to_delete TEXT[],        -- For partial deletion

  -- Grace Period
  grace_period_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  can_cancel_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),

  -- Approval
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Processing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Verification
  email TEXT NOT NULL,
  verification_token_hash TEXT,
  verified_at TIMESTAMPTZ,

  -- Metadata
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET
);

CREATE INDEX idx_deletion_requests_user ON data_deletion_requests(user_id, tenant_id);
CREATE INDEX idx_deletion_requests_status ON data_deletion_requests(status);
CREATE INDEX idx_deletion_requests_grace ON data_deletion_requests(grace_period_ends_at)
  WHERE status IN ('pending', 'approved');
```

#### data_correction_requests

GDPR right to rectification.

```sql
CREATE TABLE data_correction_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Request Details
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),

  -- Correction Details
  field_name TEXT NOT NULL,
  current_value TEXT,
  requested_value TEXT NOT NULL,
  reason TEXT,

  -- Approval
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Metadata
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_correction_requests_user ON data_correction_requests(user_id, tenant_id);
```

#### privacy_settings

CCPA/CPRA privacy preferences.

```sql
CREATE TABLE privacy_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- CCPA Rights
  do_not_sell BOOLEAN DEFAULT FALSE,
  do_not_share BOOLEAN DEFAULT FALSE,
  limit_sensitive_data BOOLEAN DEFAULT FALSE,

  -- Communication Preferences
  opt_out_marketing BOOLEAN DEFAULT FALSE,
  opt_out_analytics BOOLEAN DEFAULT FALSE,
  opt_out_profiling BOOLEAN DEFAULT FALSE,

  -- Global Privacy Control
  gpc_enabled BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_privacy_settings UNIQUE (user_id, tenant_id)
);

CREATE INDEX idx_privacy_settings_user ON privacy_settings(user_id, tenant_id);
```

#### compliance_documents

Policy documents with version tracking.

```sql
CREATE TABLE compliance_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for global docs

  -- Document Info
  type TEXT NOT NULL CHECK (type IN ('terms_of_service', 'privacy_policy', 'cookie_policy', 'dpa', 'sla')),
  version TEXT NOT NULL,

  -- Content
  title TEXT NOT NULL,
  content TEXT NOT NULL,              -- Markdown or HTML
  summary TEXT,                       -- Plain text summary

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),

  -- Dates
  effective_date TIMESTAMPTZ,
  published_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,

  CONSTRAINT unique_active_document UNIQUE (tenant_id, type, status)
);

CREATE INDEX idx_compliance_docs_tenant ON compliance_documents(tenant_id);
CREATE INDEX idx_compliance_docs_type ON compliance_documents(type, status);
```

---

### 9. Audit Tables

> **Note:** Full audit schema is defined in `BACKEND_DATABASE_MIGRATIONS.sql`.
> Summary included here for completeness.

#### audit.logs

Immutable audit log entries.

```sql
-- See BACKEND_DATABASE_MIGRATIONS.sql for full definition
-- Key fields:
--   id, timestamp, event_type, severity
--   actor_user_id, actor_email, actor_role, actor_ip_address
--   resource_type, resource_id, action, description, status
--   legal_basis, purpose, data_subject_id
--   organization_id, tenant_id
--   entry_hash, previous_hash, signature (integrity)
```

#### audit.archives

Archived log index.

```sql
-- Archives old logs to S3 Glacier
-- Tracks: s3_bucket, s3_key, log_count, file_checksum
```

#### audit.archive_retrievals

Glacier retrieval requests.

```sql
-- Tracks retrieval jobs from S3 Glacier
```

#### audit.alert_rules

Audit alert configurations.

```sql
-- Alert rules for specific event types/severities
-- Supports email, Slack, webhook, SMS notifications
```

#### audit.gdpr_exports

GDPR audit log exports.

```sql
-- Tracks data subject audit log export requests
```

---

### 10. Node/Workflow Tables

> **Important**: For comprehensive documentation on the workflow engine architecture, node types,
> AI Agent orchestration, and configuration schemas, see [NODE_WORKFLOW_ENGINE.md](./NODE_WORKFLOW_ENGINE.md).

#### node_types

AI workflow node type definitions (20 types: ai_agent, trigger, planner, llm, memory_store, etc.).

```sql
CREATE TABLE node_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identity
  type TEXT NOT NULL UNIQUE,          -- e.g., 'trigger/http', 'action/transform'
  name TEXT NOT NULL,
  description TEXT,

  -- Categorization
  category TEXT NOT NULL,             -- 'trigger', 'action', 'condition', 'output'
  subcategory TEXT,

  -- Configuration Schema
  config_schema JSONB NOT NULL,       -- JSON Schema for node config
  input_schema JSONB,                 -- Expected input data schema
  output_schema JSONB,                -- Output data schema

  -- UI
  icon TEXT,
  color TEXT,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_beta BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_node_types_category ON node_types(category);
CREATE INDEX idx_node_types_type ON node_types(type);
```

#### workflows

Workflow definitions.

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Definition
  definition JSONB NOT NULL,          -- Full workflow graph
  version INTEGER DEFAULT 1,

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),

  -- Schedule (for scheduled workflows)
  schedule_cron TEXT,
  schedule_timezone TEXT DEFAULT 'UTC',
  next_scheduled_at TIMESTAMPTZ,

  -- Stats
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_schedule ON workflows(next_scheduled_at) WHERE status = 'active';
```

#### workflow_nodes

Individual nodes within workflows.

```sql
CREATE TABLE workflow_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Node Identity
  node_type_id UUID NOT NULL REFERENCES node_types(id),
  name TEXT NOT NULL,

  -- Position (for UI)
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,

  -- Configuration
  config JSONB DEFAULT '{}',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_nodes_workflow ON workflow_nodes(workflow_id);
```

#### workflow_edges

Connections between workflow nodes.

```sql
CREATE TABLE workflow_edges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Connection
  source_node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  source_handle TEXT,                 -- Output port name
  target_handle TEXT,                 -- Input port name

  -- Condition (for conditional edges)
  condition JSONB,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_edges_workflow ON workflow_edges(workflow_id);
CREATE INDEX idx_workflow_edges_source ON workflow_edges(source_node_id);
```

#### workflow_executions

Workflow execution history.

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Execution Details
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'cancelled', 'timeout'
  )),

  -- Trigger
  trigger_type TEXT NOT NULL,         -- 'manual', 'schedule', 'webhook', 'api'
  triggered_by UUID REFERENCES users(id),

  -- Input/Output
  input_data JSONB,
  output_data JSONB,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Error
  error_message TEXT,
  error_node_id UUID,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_executions_time ON workflow_executions(created_at DESC);
```

#### workflow_node_executions

Individual node execution within a workflow run.

```sql
CREATE TABLE workflow_node_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  workflow_node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Execution
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'skipped'
  )),

  -- Input/Output
  input_data JSONB,
  output_data JSONB,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Error
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_node_executions_execution ON workflow_node_executions(workflow_execution_id);
CREATE INDEX idx_node_executions_node ON workflow_node_executions(workflow_node_id);
```

#### workflow_templates

Pre-built workflow templates.

```sql
CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for global templates

  -- Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Template
  definition JSONB NOT NULL,

  -- Categorization
  category TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Stats
  use_count INTEGER DEFAULT 0,

  -- Status
  is_public BOOLEAN DEFAULT FALSE,    -- Visible to other tenants
  is_featured BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_workflow_templates_tenant ON workflow_templates(tenant_id);
CREATE INDEX idx_workflow_templates_public ON workflow_templates(is_public) WHERE is_public = TRUE;
```

#### ai_models

AI model configurations for workflow nodes.

```sql
CREATE TABLE ai_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for global models

  -- Model Info
  provider TEXT NOT NULL,             -- 'openai', 'anthropic', 'cohere', etc.
  model_id TEXT NOT NULL,             -- 'gpt-4', 'claude-3-opus', etc.
  name TEXT NOT NULL,

  -- Configuration
  default_config JSONB DEFAULT '{}',  -- temperature, max_tokens, etc.

  -- Capabilities
  capabilities TEXT[] DEFAULT '{}',   -- 'text', 'code', 'vision', 'embedding'

  -- Pricing (per 1K tokens)
  input_price_per_1k DECIMAL,
  output_price_per_1k DECIMAL,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_models_provider ON ai_models(provider);
```

#### documentation_pages

Platform documentation pages (40 pages, accessible from dashboard and publicly).

```sql
CREATE TABLE documentation_pages (
  id TEXT PRIMARY KEY,                  -- Slug-based ID

  -- Content
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,               -- 'getting-started', 'api', 'security', etc.
  content TEXT NOT NULL,                -- Markdown content

  -- Metadata
  read_time INTEGER,                    -- Estimated minutes to read
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_public BOOLEAN DEFAULT TRUE,       -- Accessible without auth

  -- SEO
  meta_description TEXT,
  keywords TEXT[],

  -- Order
  sort_order INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: Global table (not tenant-scoped)
CREATE INDEX idx_docs_category ON documentation_pages(category);
CREATE INDEX idx_docs_public ON documentation_pages(is_public) WHERE is_public = TRUE;
CREATE INDEX idx_docs_sort ON documentation_pages(category, sort_order);
```

**Documentation Categories (40 pages):**
- Getting Started (3 pages)
- Node Creation (3 pages)
- Workflow & Agents (3 pages)
- API & Development (4 pages)
- Operations & Infrastructure (6 pages)
- Security & Compliance (4 pages)
- Performance & Scaling (2 pages)
- Reliability & Quality (4 pages)
- Testing & CI/CD (3 pages)
- Advanced Topics (4 pages)
- Reference & Learning (4 pages)

#### provider_resource_map

Maps internal Zygo resources to external cloud provider resource IDs (multi-cloud support).

```sql
CREATE TABLE provider_resource_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Provider Info
  provider TEXT NOT NULL,               -- 'hetzner', 'aws', 'gcp', 'azure', 'digitalocean'
  provider_region TEXT,                 -- Provider-specific region/datacenter
  provider_project_id TEXT,             -- Provider account/project ID

  -- Resource Mapping
  resource_type TEXT NOT NULL,          -- 'servers', 'volumes', 'networks', 'firewalls', etc.
  internal_resource_id UUID NOT NULL,   -- Zygo resource UUID
  provider_resource_id TEXT NOT NULL,   -- Provider's resource ID (e.g., Hetzner server ID "12345678")

  -- Additional Metadata
  metadata JSONB,                       -- Provider-specific data

  -- Sync Status
  sync_status TEXT DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'error')),
  last_synced_at TIMESTAMPTZ,
  sync_error TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_provider_resource_map_tenant ON provider_resource_map(tenant_id);
CREATE INDEX idx_provider_resource_map_internal ON provider_resource_map(internal_resource_id);
CREATE INDEX idx_provider_resource_map_provider ON provider_resource_map(provider, provider_resource_id);
CREATE INDEX idx_provider_resource_map_lookup ON provider_resource_map(tenant_id, provider, resource_type, internal_resource_id);

-- Unique constraints for bidirectional uniqueness
CREATE UNIQUE INDEX uq_provider_resource_map_internal ON provider_resource_map(tenant_id, resource_type, internal_resource_id, provider);
CREATE UNIQUE INDEX uq_provider_resource_map_external ON provider_resource_map(provider, provider_resource_id);
```

**Usage Notes:**
- This table enables multi-cloud provider support without adding provider-specific columns to resource tables
- The `provider` field is TEXT to support future providers without schema changes
- The `resource_type` field matches the table name of the internal resource (e.g., 'servers', 'volumes')
- Composite unique constraints ensure bidirectional uniqueness

---

## Row-Level Security (RLS)

All tables have RLS enabled with tenant isolation.

### Standard RLS Policy Pattern

```sql
-- Enable RLS
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

-- Select: Users can only see their tenant's data
CREATE POLICY "{table}_select_policy" ON {table_name}
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
    OR
    -- Global admin can see all
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND is_global_admin = TRUE
    )
  );

-- Insert: Users can only insert into their tenant
CREATE POLICY "{table}_insert_policy" ON {table_name}
  FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
  );

-- Update: Users can only update their tenant's data
CREATE POLICY "{table}_update_policy" ON {table_name}
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
  );

-- Delete: Users can only delete their tenant's data
CREATE POLICY "{table}_delete_policy" ON {table_name}
  FOR DELETE
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
  );
```

### Special RLS Policies

#### Users Table (Cross-Tenant Access)

```sql
-- Users can see their own profile across tenants
CREATE POLICY "users_self_access" ON users
  FOR SELECT
  USING (id = auth.uid());

-- Users can see other users in same tenant
CREATE POLICY "users_tenant_access" ON users
  FOR SELECT
  USING (
    id IN (
      SELECT tm.user_id FROM tenant_members tm
      WHERE tm.tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
    )
  );
```

#### Audit Logs (Immutable)

```sql
-- No updates allowed
CREATE POLICY "audit_logs_no_update" ON audit.logs
  FOR UPDATE
  USING (FALSE);

-- No deletes allowed
CREATE POLICY "audit_logs_no_delete" ON audit.logs
  FOR DELETE
  USING (FALSE);
```

---

## Indexes

### Performance Indexes

```sql
-- Composite indexes for common queries
CREATE INDEX idx_servers_tenant_status ON servers(tenant_id, status);
CREATE INDEX idx_workflows_tenant_status ON workflows(tenant_id, status);
CREATE INDEX idx_audit_logs_org_time ON audit.logs(organization_id, timestamp DESC);

-- Partial indexes for active records
CREATE INDEX idx_active_webhooks ON webhooks(tenant_id) WHERE is_active = TRUE;
CREATE INDEX idx_pending_exports ON data_export_requests(tenant_id) WHERE status = 'pending';

-- GIN indexes for JSONB
CREATE INDEX idx_tenant_config_features ON tenant_config USING GIN(feature_flags);
CREATE INDEX idx_workflow_definition ON workflows USING GIN(definition);
```

---

## Triggers

### Updated At Trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at column
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Repeat for other tables...
```

### Soft Delete Trigger

```sql
CREATE OR REPLACE FUNCTION soft_delete_cascade()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    -- Cascade soft delete to related records
    UPDATE tenant_members SET status = 'suspended' WHERE tenant_id = NEW.id;
    UPDATE servers SET status = 'deleted', deleted_at = NOW() WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_soft_delete
  AFTER UPDATE ON tenants
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION soft_delete_cascade();
```

---

## Functions

### Permission Check Function

```sql
CREATE OR REPLACE FUNCTION check_permission(
  p_user_id UUID,
  p_tenant_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN;
BEGIN
  -- Check direct user permission (grant)
  SELECT EXISTS (
    SELECT 1 FROM user_permissions up
    JOIN permissions p ON up.permission_id = p.id
    WHERE up.user_id = p_user_id
      AND up.tenant_id = p_tenant_id
      AND p.key = p_permission_key
      AND up.grant_type = 'grant'
      AND (up.expires_at IS NULL OR up.expires_at > NOW())
  ) INTO v_has_permission;

  IF v_has_permission THEN RETURN TRUE; END IF;

  -- Check direct user permission (deny)
  SELECT EXISTS (
    SELECT 1 FROM user_permissions up
    JOIN permissions p ON up.permission_id = p.id
    WHERE up.user_id = p_user_id
      AND up.tenant_id = p_tenant_id
      AND p.key = p_permission_key
      AND up.grant_type = 'deny'
  ) INTO v_has_permission;

  IF v_has_permission THEN RETURN FALSE; END IF;

  -- Check role permission
  SELECT EXISTS (
    SELECT 1 FROM tenant_members tm
    JOIN role_permissions rp ON tm.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_tenant_id
      AND p.key = p_permission_key
      AND tm.status = 'active'
  ) INTO v_has_permission;

  RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Tenant Slug Generation

```sql
CREATE OR REPLACE FUNCTION generate_tenant_slug(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_slug TEXT;
  v_counter INTEGER := 0;
BEGIN
  -- Generate base slug
  v_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);

  -- Ensure uniqueness
  WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = v_slug || CASE WHEN v_counter > 0 THEN '-' || v_counter ELSE '' END) LOOP
    v_counter := v_counter + 1;
  END LOOP;

  IF v_counter > 0 THEN
    v_slug := v_slug || '-' || v_counter;
  END IF;

  RETURN v_slug;
END;
$$ LANGUAGE plpgsql;
```

---

## Views

### Active Users View

```sql
CREATE VIEW active_users_by_tenant AS
SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  COUNT(DISTINCT tm.user_id) AS total_users,
  COUNT(DISTINCT CASE WHEN u.last_active_at > NOW() - INTERVAL '30 days' THEN tm.user_id END) AS active_users_30d
FROM tenants t
LEFT JOIN tenant_members tm ON t.id = tm.tenant_id AND tm.status = 'active'
LEFT JOIN users u ON tm.user_id = u.id
WHERE t.status = 'active'
GROUP BY t.id, t.name;
```

### Infrastructure Summary View

```sql
CREATE VIEW infrastructure_summary AS
SELECT
  tenant_id,
  COUNT(DISTINCT CASE WHEN status != 'deleted' THEN id END) AS server_count,
  SUM(CASE WHEN status = 'running' THEN vcpus ELSE 0 END) AS total_vcpus,
  SUM(CASE WHEN status = 'running' THEN memory_mb ELSE 0 END) AS total_memory_mb
FROM servers
GROUP BY tenant_id;
```

---

## Migration Order

Execute migrations in this order to respect foreign key dependencies:

1. **Extensions & Schemas**
2. **Core Tables**
   - `tenants`
   - `users`
   - `permissions` (seed data)
   - `roles`
3. **Relationship Tables**
   - `tenant_config`
   - `tenant_members`
   - `tenant_invitations`
   - `role_permissions`
   - `user_permissions`
4. **User Tables**
   - `user_sessions`
   - `user_mfa`
   - `user_api_keys`
5. **Infrastructure Tables**
   - `cloud_providers`
   - `servers`
   - `volumes`
   - `networks`
   - `firewalls`, `firewall_rules`
   - `load_balancers`, `load_balancer_targets`
   - `dns_zones`, `dns_records`
   - `snapshots`
   - `floating_ips`
   - `ssl_certificates`
6. **Secrets Tables**
   - `encryption_keys`
   - `secrets`
   - `environment_variables`
   - `secret_access_log`
7. **Webhook Tables**
   - `webhooks`
   - `webhook_deliveries`
8. **Billing Tables**
   - `subscriptions`
   - `payment_methods`
   - `invoices`
   - `usage_records`
   - `billing_alerts`
9. **Compliance Tables**
   - `consent_records`
   - `data_export_requests`
   - `data_deletion_requests`
   - `data_correction_requests`
   - `privacy_settings`
   - `compliance_documents`
10. **Audit Tables** (separate schema)
    - Run `BACKEND_DATABASE_MIGRATIONS.sql`
11. **Node/Workflow Tables**
    - `node_types` (seed data)
    - `workflows`
    - `workflow_nodes`
    - `workflow_edges`
    - `workflow_executions`
    - `workflow_node_executions`
    - `workflow_templates`
    - `ai_models`
12. **Indexes**
13. **Triggers**
14. **Functions**
15. **Views**
16. **RLS Policies**

---

## Changelog

### v2.0.0 (January 26, 2026)

- Complete rewrite based on UI domain models
- Added 54 tables with RLS
- Added GDPR/CCPA compliance tables
- Added billing tables
- Added workflow/node tables
- Standardized tenant_id across all tables
