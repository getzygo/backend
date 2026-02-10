-- Migration: Groups/Teams tables
-- Adds groups, group_members, group_resources tables
-- Seeds 8 group permissions and grants to default roles

-- ============================================================================
-- 1. Create tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS "groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "slug" varchar(50) NOT NULL,
  "description" text,
  "type" varchar(20) NOT NULL DEFAULT 'team',
  "visibility" varchar(20) NOT NULL DEFAULT 'internal',
  "avatar_url" text,
  "color" varchar(7) NOT NULL DEFAULT '#6366f1',
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "archived_at" timestamptz,
  "archived_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "group_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL DEFAULT 'member',
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "added_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "removed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "group_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "resource_type" varchar(50) NOT NULL,
  "resource_id" varchar(255) NOT NULL,
  "assigned_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. Create indexes
-- ============================================================================

-- Groups indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_groups_tenant_slug" ON "groups" ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "idx_groups_tenant" ON "groups" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_groups_tenant_status" ON "groups" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_groups_tenant_type" ON "groups" ("tenant_id", "type");
CREATE INDEX IF NOT EXISTS "idx_groups_tenant_visibility" ON "groups" ("tenant_id", "visibility");

-- Group members indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_group_members_group_user" ON "group_members" ("group_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_group_members_group" ON "group_members" ("group_id");
CREATE INDEX IF NOT EXISTS "idx_group_members_user" ON "group_members" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_group_members_tenant" ON "group_members" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_group_members_tenant_user" ON "group_members" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_group_members_group_status" ON "group_members" ("group_id", "status");
CREATE INDEX IF NOT EXISTS "idx_group_members_group_role" ON "group_members" ("group_id", "role");

-- Group resources indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_group_resources_unique" ON "group_resources" ("group_id", "resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "idx_group_resources_group" ON "group_resources" ("group_id");
CREATE INDEX IF NOT EXISTS "idx_group_resources_tenant" ON "group_resources" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_group_resources_resource" ON "group_resources" ("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "idx_group_resources_tenant_resource" ON "group_resources" ("tenant_id", "resource_type", "resource_id");

-- ============================================================================
-- 3. Seed 8 group permissions
-- ============================================================================

INSERT INTO "permissions" ("key", "name", "description", "category", "requires_mfa", "is_critical")
VALUES
  ('canViewGroups', 'View Groups', 'View groups and teams', 'groups', false, false),
  ('canCreateGroups', 'Create Groups', 'Create new groups and teams', 'groups', false, false),
  ('canManageGroups', 'Manage Groups', 'Edit group settings and details', 'groups', false, false),
  ('canDeleteGroups', 'Delete Groups', 'Delete groups permanently', 'groups', false, true),
  ('canManageGroupMembers', 'Manage Group Members', 'Add and remove group members', 'groups', false, false),
  ('canAssignGroupResources', 'Assign Group Resources', 'Assign resources to groups', 'groups', false, false),
  ('canViewGroupResources', 'View Group Resources', 'View resources assigned to groups', 'groups', false, false),
  ('canManageGroupSettings', 'Manage Group Settings', 'Manage group configuration and settings', 'groups', false, false)
ON CONFLICT ("key") DO NOTHING;

-- ============================================================================
-- 4. Grant permissions to default roles across all tenants
-- ============================================================================

-- Grant ALL 8 group permissions to Owner role (hierarchy_level = 1)
INSERT INTO "role_permissions" ("role_id", "permission_id", "tenant_id")
SELECT r.id, p.id, r.tenant_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.hierarchy_level = 1
  AND r.is_system = true
  AND p.category = 'groups'
ON CONFLICT DO NOTHING;

-- Grant ALL 8 group permissions to Admin role (hierarchy_level = 10)
INSERT INTO "role_permissions" ("role_id", "permission_id", "tenant_id")
SELECT r.id, p.id, r.tenant_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.hierarchy_level = 10
  AND r.is_system = true
  AND p.category = 'groups'
ON CONFLICT DO NOTHING;

-- Grant view + create + assign to Developer role (hierarchy_level = 30)
INSERT INTO "role_permissions" ("role_id", "permission_id", "tenant_id")
SELECT r.id, p.id, r.tenant_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.hierarchy_level = 30
  AND r.is_system = true
  AND p.key IN ('canViewGroups', 'canCreateGroups', 'canAssignGroupResources', 'canViewGroupResources')
ON CONFLICT DO NOTHING;

-- Grant view permissions to Member role (hierarchy_level = 40)
INSERT INTO "role_permissions" ("role_id", "permission_id", "tenant_id")
SELECT r.id, p.id, r.tenant_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.hierarchy_level = 40
  AND r.is_system = true
  AND p.key IN ('canViewGroups', 'canViewGroupResources')
ON CONFLICT DO NOTHING;

-- Grant view permissions to Viewer role (hierarchy_level = 50)
INSERT INTO "role_permissions" ("role_id", "permission_id", "tenant_id")
SELECT r.id, p.id, r.tenant_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.hierarchy_level = 50
  AND r.is_system = true
  AND p.key IN ('canViewGroups', 'canViewGroupResources')
ON CONFLICT DO NOTHING;
