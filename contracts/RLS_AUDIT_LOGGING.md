# RLS Audit Logging Specification

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**Addendum To:** db_contract.md

---

## Table of Contents

1. [Overview](#overview)
2. [RLS Enforcement Model](#rls-enforcement-model)
3. [Audit Tables](#audit-tables)
4. [Violation Detection](#violation-detection)
5. [Global Admin Override Logging](#global-admin-override-logging)
6. [API Endpoints](#api-endpoints)
7. [Alerting](#alerting)

---

## Overview

This document specifies the audit logging requirements for Row-Level Security (RLS) enforcement, including violation detection, cross-tenant access logging, and global admin override tracking.

### Security Objectives

| Objective | Implementation |
|-----------|----------------|
| Detect cross-tenant access attempts | RLS violation logging |
| Audit all data access | Query logging for sensitive tables |
| Track admin overrides | Global admin action audit trail |
| Enable forensic investigation | Immutable audit records |
| Compliance reporting | GDPR/SOC2 audit trail |

---

## RLS Enforcement Model

### How RLS is Evaluated

```
┌─────────────────────────────────────────────────────────────┐
│                     Query Execution Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Request arrives with JWT token                           │
│     ↓                                                        │
│  2. Extract tenant_id from JWT claims                        │
│     ↓                                                        │
│  3. SET app.current_tenant_id = <tenant_id>                  │
│     ↓                                                        │
│  4. Execute query                                            │
│     ↓                                                        │
│  5. RLS policy evaluated:                                    │
│     WHERE tenant_id = current_setting('app.current_tenant_id')│
│     ↓                                                        │
│  6. If policy FAILS → Log violation → Return empty/error     │
│     If policy PASSES → Return filtered rows                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Tenant Context Setting

```sql
-- Called at beginning of each request
CREATE OR REPLACE FUNCTION set_tenant_context(
  p_tenant_id UUID,
  p_user_id UUID,
  p_is_global_admin BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
BEGIN
  -- Set tenant context
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);
  PERFORM set_config('app.is_global_admin', p_is_global_admin::TEXT, TRUE);

  -- Log context setting for audit
  INSERT INTO security_context_log (
    tenant_id,
    user_id,
    is_global_admin,
    session_id,
    ip_address,
    created_at
  ) VALUES (
    p_tenant_id,
    p_user_id,
    p_is_global_admin,
    current_setting('app.session_id', TRUE),
    current_setting('app.client_ip', TRUE),
    NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Audit Tables

### security_context_log

Tracks all tenant context changes (session establishment).

```sql
CREATE TABLE security_context_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  is_global_admin BOOLEAN NOT NULL DEFAULT FALSE,
  session_id VARCHAR(100),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for security investigations
CREATE INDEX idx_security_context_tenant ON security_context_log(tenant_id, created_at DESC);
CREATE INDEX idx_security_context_user ON security_context_log(user_id, created_at DESC);
CREATE INDEX idx_security_context_ip ON security_context_log(ip_address, created_at DESC);

-- No RLS - security team needs full access
ALTER TABLE security_context_log ENABLE ROW LEVEL SECURITY;

-- Only global admins and security team can read
CREATE POLICY security_context_read ON security_context_log
  FOR SELECT USING (
    current_setting('app.is_global_admin', TRUE)::BOOLEAN = TRUE
    OR current_setting('app.has_security_access', TRUE)::BOOLEAN = TRUE
  );

-- System can always insert
CREATE POLICY security_context_insert ON security_context_log
  FOR INSERT WITH CHECK (TRUE);
```

### rls_violation_log

Tracks RLS policy violation attempts.

```sql
CREATE TABLE rls_violation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who attempted
  user_id UUID REFERENCES users(id),
  session_tenant_id UUID REFERENCES tenants(id),

  -- What was attempted
  target_tenant_id UUID REFERENCES tenants(id),
  target_table TEXT NOT NULL,
  operation TEXT NOT NULL,  -- SELECT, INSERT, UPDATE, DELETE
  query_fingerprint TEXT,   -- Sanitized query pattern

  -- Context
  ip_address INET,
  user_agent TEXT,
  request_path TEXT,
  request_id VARCHAR(100),

  -- Metadata
  severity VARCHAR(20) NOT NULL DEFAULT 'warning',
  blocked BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_operation CHECK (operation IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

-- Indexes for investigation
CREATE INDEX idx_rls_violation_user ON rls_violation_log(user_id, created_at DESC);
CREATE INDEX idx_rls_violation_target ON rls_violation_log(target_tenant_id, created_at DESC);
CREATE INDEX idx_rls_violation_severity ON rls_violation_log(severity, created_at DESC);
CREATE INDEX idx_rls_violation_ip ON rls_violation_log(ip_address, created_at DESC);

-- No tenant RLS - security team access only
ALTER TABLE rls_violation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_violation_read ON rls_violation_log
  FOR SELECT USING (
    current_setting('app.is_global_admin', TRUE)::BOOLEAN = TRUE
    OR current_setting('app.has_security_access', TRUE)::BOOLEAN = TRUE
  );

CREATE POLICY rls_violation_insert ON rls_violation_log
  FOR INSERT WITH CHECK (TRUE);
```

### global_admin_audit_log

Tracks all global admin actions, especially cross-tenant access.

```sql
CREATE TABLE global_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who (admin)
  admin_user_id UUID NOT NULL REFERENCES users(id),
  admin_email TEXT NOT NULL,

  -- What
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,

  -- Cross-tenant context
  target_tenant_id UUID REFERENCES tenants(id),
  target_tenant_name TEXT,

  -- Request context
  ip_address INET,
  user_agent TEXT,
  request_path TEXT,
  request_method TEXT,
  request_id VARCHAR(100),

  -- Changes
  old_values JSONB,
  new_values JSONB,

  -- Metadata
  reason TEXT,  -- Admin must provide reason for sensitive actions
  approved_by UUID REFERENCES users(id),  -- For high-risk actions
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Immutability
  hash TEXT NOT NULL,  -- SHA256 of record for tamper detection
  previous_hash TEXT   -- Chain hash for integrity
);

-- Indexes
CREATE INDEX idx_admin_audit_admin ON global_admin_audit_log(admin_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_tenant ON global_admin_audit_log(target_tenant_id, created_at DESC);
CREATE INDEX idx_admin_audit_action ON global_admin_audit_log(action, created_at DESC);
CREATE INDEX idx_admin_audit_resource ON global_admin_audit_log(resource_type, resource_id);

-- Trigger for hash chain
CREATE OR REPLACE FUNCTION set_admin_audit_hash()
RETURNS TRIGGER AS $$
DECLARE
  v_previous_hash TEXT;
  v_record_data TEXT;
BEGIN
  -- Get previous hash
  SELECT hash INTO v_previous_hash
  FROM global_admin_audit_log
  ORDER BY created_at DESC
  LIMIT 1;

  -- Create record data string
  v_record_data := NEW.admin_user_id::TEXT || NEW.action || NEW.resource_type ||
                   COALESCE(NEW.resource_id::TEXT, '') || NEW.created_at::TEXT;

  -- Set hashes
  NEW.previous_hash := v_previous_hash;
  NEW.hash := encode(sha256((v_record_data || COALESCE(v_previous_hash, ''))::bytea), 'hex');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_hash_trigger
  BEFORE INSERT ON global_admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION set_admin_audit_hash();

-- Immutable - no updates or deletes
CREATE POLICY admin_audit_immutable ON global_admin_audit_log
  FOR ALL USING (FALSE)
  WITH CHECK (TRUE);
```

### sensitive_data_access_log

Tracks access to sensitive data (PII, secrets, etc.).

```sql
CREATE TABLE sensitive_data_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),

  -- What
  data_type TEXT NOT NULL,  -- 'pii', 'secret', 'credential', 'billing'
  table_name TEXT NOT NULL,
  record_id UUID,
  field_names TEXT[],       -- Which sensitive fields were accessed

  -- Operation
  operation TEXT NOT NULL,  -- 'view', 'export', 'modify', 'delete'

  -- Context
  ip_address INET,
  user_agent TEXT,
  request_path TEXT,
  request_id VARCHAR(100),

  -- Compliance
  purpose TEXT,             -- Why was data accessed (for GDPR)
  legal_basis TEXT,         -- Legal basis for processing

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensitive_access_tenant ON sensitive_data_access_log(tenant_id, created_at DESC);
CREATE INDEX idx_sensitive_access_user ON sensitive_data_access_log(user_id, created_at DESC);
CREATE INDEX idx_sensitive_access_type ON sensitive_data_access_log(data_type, created_at DESC);

-- RLS for tenant isolation
ALTER TABLE sensitive_data_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY sensitive_access_tenant_isolation ON sensitive_data_access_log
  FOR ALL USING (
    tenant_id = current_setting('app.current_tenant_id')::UUID
    OR current_setting('app.is_global_admin', TRUE)::BOOLEAN = TRUE
  );
```

---

## Violation Detection

### RLS Policy with Logging

Modify RLS policies to log violations:

```sql
-- Example: servers table with violation logging
CREATE OR REPLACE FUNCTION check_rls_with_logging(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_operation TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_tenant UUID;
  v_matches BOOLEAN;
BEGIN
  v_current_tenant := current_setting('app.current_tenant_id', TRUE)::UUID;
  v_matches := (p_tenant_id = v_current_tenant);

  -- Log violation if mismatch
  IF NOT v_matches AND v_current_tenant IS NOT NULL THEN
    INSERT INTO rls_violation_log (
      user_id,
      session_tenant_id,
      target_tenant_id,
      target_table,
      operation,
      ip_address,
      request_id,
      severity,
      blocked
    ) VALUES (
      current_setting('app.current_user_id', TRUE)::UUID,
      v_current_tenant,
      p_tenant_id,
      p_table_name,
      p_operation,
      current_setting('app.client_ip', TRUE)::INET,
      current_setting('app.request_id', TRUE),
      CASE
        WHEN p_operation IN ('UPDATE', 'DELETE') THEN 'critical'
        WHEN p_operation = 'INSERT' THEN 'warning'
        ELSE 'info'
      END,
      TRUE
    );
  END IF;

  RETURN v_matches;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to RLS policy
CREATE POLICY servers_tenant_isolation ON servers
  FOR ALL USING (
    check_rls_with_logging(tenant_id, 'servers', TG_OP)
  );
```

### Violation Severity Levels

| Severity | Criteria | Response |
|----------|----------|----------|
| `info` | Read attempt on non-sensitive data | Log only |
| `warning` | Read attempt on sensitive data | Log + alert |
| `critical` | Write attempt to another tenant | Log + alert + block |

---

## Global Admin Override Logging

### Admin Access Function

```sql
CREATE OR REPLACE FUNCTION admin_access_tenant(
  p_admin_user_id UUID,
  p_target_tenant_id UUID,
  p_reason TEXT
) RETURNS VOID AS $$
BEGIN
  -- Verify caller is global admin
  IF NOT current_setting('app.is_global_admin', TRUE)::BOOLEAN THEN
    RAISE EXCEPTION 'Only global admins can use admin_access_tenant';
  END IF;

  -- Log the admin access
  INSERT INTO global_admin_audit_log (
    admin_user_id,
    admin_email,
    action,
    resource_type,
    target_tenant_id,
    target_tenant_name,
    ip_address,
    request_path,
    request_id,
    reason
  ) VALUES (
    p_admin_user_id,
    (SELECT email FROM users WHERE id = p_admin_user_id),
    'TENANT_ACCESS',
    'tenant',
    p_target_tenant_id,
    (SELECT name FROM tenants WHERE id = p_target_tenant_id),
    current_setting('app.client_ip', TRUE)::INET,
    current_setting('app.request_path', TRUE),
    current_setting('app.request_id', TRUE),
    p_reason
  );

  -- Set tenant context for admin
  PERFORM set_config('app.current_tenant_id', p_target_tenant_id::TEXT, TRUE);
  PERFORM set_config('app.admin_override', 'true', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### High-Risk Actions Requiring Approval

```sql
CREATE TABLE admin_action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request
  requestor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_tenant_id UUID REFERENCES tenants(id),
  target_resource_type TEXT,
  target_resource_id UUID,
  reason TEXT NOT NULL,
  risk_level VARCHAR(20) NOT NULL,

  -- Approval
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approver_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Metadata
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT valid_risk CHECK (risk_level IN ('medium', 'high', 'critical'))
);

-- Actions requiring approval
-- risk_level: critical
--   - Delete tenant
--   - Access tenant billing data
--   - Export tenant data
--   - Modify tenant owner
-- risk_level: high
--   - Suspend tenant
--   - Reset user password
--   - Access secrets
-- risk_level: medium
--   - View tenant audit logs
--   - Modify tenant settings
```

---

## API Endpoints

### Get RLS Violations (Admin Only)

```
GET /api/v1/admin/security/rls-violations
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `tenantId` | UUID | Filter by target tenant |
| `userId` | UUID | Filter by user |
| `severity` | string | Filter by severity |
| `since` | ISO8601 | Violations after date |
| `limit` | number | Results per page |

**Response:**
```json
{
  "violations": [
    {
      "id": "viol_123",
      "userId": "user_abc",
      "userEmail": "user@example.com",
      "sessionTenantId": "tenant_a",
      "targetTenantId": "tenant_b",
      "targetTable": "servers",
      "operation": "SELECT",
      "severity": "warning",
      "blocked": true,
      "ipAddress": "192.168.1.1",
      "createdAt": "2026-01-26T12:00:00Z"
    }
  ],
  "total": 15,
  "pagination": {...}
}
```

### Get Admin Audit Log

```
GET /api/v1/admin/security/admin-audit
```

**Response:**
```json
{
  "entries": [
    {
      "id": "audit_123",
      "adminUserId": "admin_abc",
      "adminEmail": "admin@zygo.io",
      "action": "TENANT_ACCESS",
      "resourceType": "tenant",
      "targetTenantId": "tenant_xyz",
      "targetTenantName": "Acme Corp",
      "reason": "Support ticket #12345",
      "ipAddress": "10.0.0.1",
      "createdAt": "2026-01-26T12:00:00Z",
      "hashValid": true
    }
  ]
}
```

### Verify Audit Log Integrity

```
GET /api/v1/admin/security/audit-integrity
```

Verifies hash chain integrity.

**Response:**
```json
{
  "status": "valid",
  "recordsChecked": 15420,
  "firstRecord": "2025-01-01T00:00:00Z",
  "lastRecord": "2026-01-26T12:00:00Z",
  "brokenChainAt": null
}
```

---

## Alerting

### Alert Triggers

| Event | Condition | Severity | Notification |
|-------|-----------|----------|--------------|
| RLS Violation | Any write attempt | Critical | Immediate |
| RLS Violation | 5+ read attempts/hour | Warning | Email |
| Admin Access | Any tenant access | Info | Log |
| Admin Access | Billing/secrets access | Warning | Slack + Email |
| Failed Auth | 10+ failures/user/hour | Warning | Email |
| Suspicious IP | Known bad IP access | Critical | Immediate |

### Alert Schema

```sql
CREATE TABLE security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alert type
  alert_type TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL,

  -- Context
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  source_log_id UUID,
  source_log_type TEXT,

  -- Alert details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT valid_status CHECK (status IN ('new', 'acknowledged', 'investigating', 'resolved', 'false_positive'))
);
```

---

## Integration with Existing Audit System

This specification extends the audit logging defined in `MONITORING_ACTIVITY.md`:

| Document | Focus |
|----------|-------|
| MONITORING_ACTIVITY.md | User activity audit (65+ event types) |
| RLS_AUDIT_LOGGING.md | Security/access control audit |

### Cross-Reference

- Security context logs → correlate with user sessions
- RLS violations → correlate with audit.logs
- Admin actions → correlate with admin_activity events

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial RLS audit specification
- Security context logging
- Violation detection and logging
- Global admin override tracking
- Hash chain integrity for immutable audit
