-- RLS Policies for Tenant Isolation
-- Ensures users can only access data within their tenant
-- Run after rls-functions.sql with: npm run db:rls

-- ============================================
-- Enable RLS on tenant-scoped tables
-- ============================================

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE secondary_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_security_config ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Roles table policies
-- ============================================

-- Allow SELECT for same tenant or global admin
DROP POLICY IF EXISTS roles_tenant_isolation ON roles;
CREATE POLICY roles_tenant_isolation ON roles
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- Allow INSERT only within current tenant
DROP POLICY IF EXISTS roles_insert ON roles;
CREATE POLICY roles_insert ON roles
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

-- Allow UPDATE only within current tenant or global admin
DROP POLICY IF EXISTS roles_update ON roles;
CREATE POLICY roles_update ON roles
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_global_admin())
  WITH CHECK (tenant_id = current_tenant_id());

-- Allow DELETE only within current tenant or global admin
DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_delete ON roles
  FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- ============================================
-- Role permissions table policies
-- ============================================

DROP POLICY IF EXISTS role_permissions_tenant_isolation ON role_permissions;
CREATE POLICY role_permissions_tenant_isolation ON role_permissions
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_global_admin());

DROP POLICY IF EXISTS role_permissions_insert ON role_permissions;
CREATE POLICY role_permissions_insert ON role_permissions
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS role_permissions_update ON role_permissions;
CREATE POLICY role_permissions_update ON role_permissions
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_global_admin())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS role_permissions_delete ON role_permissions;
CREATE POLICY role_permissions_delete ON role_permissions
  FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- ============================================
-- Tenant members table policies
-- ============================================

DROP POLICY IF EXISTS tenant_members_tenant_isolation ON tenant_members;
CREATE POLICY tenant_members_tenant_isolation ON tenant_members
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_global_admin());

DROP POLICY IF EXISTS tenant_members_insert ON tenant_members;
CREATE POLICY tenant_members_insert ON tenant_members
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_members_update ON tenant_members;
CREATE POLICY tenant_members_update ON tenant_members
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_global_admin())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_members_delete ON tenant_members;
CREATE POLICY tenant_members_delete ON tenant_members
  FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- ============================================
-- Secondary role assignments table policies
-- ============================================

DROP POLICY IF EXISTS secondary_roles_tenant_isolation ON secondary_role_assignments;
CREATE POLICY secondary_roles_tenant_isolation ON secondary_role_assignments
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_global_admin());

DROP POLICY IF EXISTS secondary_roles_insert ON secondary_role_assignments;
CREATE POLICY secondary_roles_insert ON secondary_role_assignments
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS secondary_roles_update ON secondary_role_assignments;
CREATE POLICY secondary_roles_update ON secondary_role_assignments
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_global_admin())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS secondary_roles_delete ON secondary_role_assignments;
CREATE POLICY secondary_roles_delete ON secondary_role_assignments
  FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- ============================================
-- Tenant security config table policies
-- ============================================

DROP POLICY IF EXISTS tenant_config_tenant_isolation ON tenant_security_config;
CREATE POLICY tenant_config_tenant_isolation ON tenant_security_config
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_global_admin());

DROP POLICY IF EXISTS tenant_config_insert ON tenant_security_config;
CREATE POLICY tenant_config_insert ON tenant_security_config
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_config_update ON tenant_security_config;
CREATE POLICY tenant_config_update ON tenant_security_config
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_global_admin())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_config_delete ON tenant_security_config;
CREATE POLICY tenant_config_delete ON tenant_security_config
  FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_global_admin());

-- ============================================
-- Grant necessary permissions
-- ============================================

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION is_global_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION set_tenant_context(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION clear_tenant_context() TO service_role;
