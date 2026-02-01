-- RLS Helper Functions
-- These functions support Row-Level Security policies for tenant isolation
-- Run with: npm run db:rls

-- Get current tenant from session config
-- Used by RLS policies to determine which rows are visible
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
  -- First try session variable (for service role)
  IF current_setting('app.current_tenant_id', TRUE) IS NOT NULL
     AND current_setting('app.current_tenant_id', TRUE) != '' THEN
    RETURN current_setting('app.current_tenant_id')::UUID;
  END IF;
  -- Then try JWT claim (for Supabase auth)
  IF auth.jwt() IS NOT NULL THEN
    RETURN (auth.jwt() ->> 'tenant_id')::UUID;
  END IF;
  -- Return null if no tenant context (will fail RLS checks)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is global admin
-- Global admins bypass tenant isolation (can see all tenants)
CREATE OR REPLACE FUNCTION is_global_admin()
RETURNS BOOLEAN AS $$
BEGIN
  IF auth.jwt() IS NOT NULL THEN
    RETURN COALESCE((auth.jwt() ->> 'is_global_admin')::BOOLEAN, FALSE);
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Set tenant context for service role operations
-- Call this before queries that need tenant isolation
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Clear tenant context (useful for cleanup)
CREATE OR REPLACE FUNCTION clear_tenant_context()
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', '', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
