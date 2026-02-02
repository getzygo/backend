# Zygo Multi-Tenant Architecture

**Version:** 2.1
**Last Updated:** February 1, 2026
**Status:** Production-Ready

This document defines the multi-tenant architecture for the Zygo platform, including mode detection, tenant isolation, and data segregation strategies.

---

## Table of Contents

1. [Overview](#overview)
2. [Application Modes](#application-modes)
3. [Mode Detection](#mode-detection)
4. [Provider Hierarchy](#provider-hierarchy)
5. [Tenant Isolation](#tenant-isolation)
6. [Storage Isolation](#storage-isolation)
7. [API Request Flow](#api-request-flow)
8. [Database Tenancy](#database-tenancy)
9. [Caching Strategy](#caching-strategy)
10. [Security Considerations](#security-considerations)
11. [Tenant Switching](#tenant-switching)

---

## Overview

### Architecture Principles

1. **Hostname-Based Routing**: Application mode determined by URL pattern
2. **Complete Data Isolation**: Tenant data never leaks across boundaries
3. **Row-Level Security (RLS)**: Database-enforced tenant isolation
4. **JWT Claims**: Tenant context embedded in authentication tokens
5. **Prefixed Storage**: Client-side storage namespaced by tenant

### Domain Structure

Zygo uses three primary domains:

| Domain | Purpose | Content |
|--------|---------|---------|
| **getzygo.com** | Public-facing | Landing page, marketing, auth pages, public docs |
| **zygo.tech** | Application | API, tenant app, admin panel, internal services |
| **zygo.cloud** | Infrastructure | Cloud services, nameservers, node deployments |

### Deployment Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Load Balancer                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  PUBLIC (getzygo.com)        │  APPLICATION (zygo.tech)                     │
│  ┌──────────────────────┐    │  ┌──────────────────────────────────────┐   │
│  │  getzygo.com         │    │  │  admin.zygo.tech                     │   │
│  │  docs.getzygo.com    │    │  │  *.zygo.tech (tenants)               │   │
│  │  (auth on /)         │    │  │  api.zygo.tech                       │   │
│  └──────────────────────┘    │  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │   Admin    │  │   Tenant   │  │    API     │
   │    UI      │  │    UI      │  │   Server   │
   └────────────┘  └────────────┘  └────────────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                          ▼
              ┌────────────────────┐
              │  PostgreSQL + RLS  │
              │   (Multi-Tenant)   │
              └────────────────────┘
```

---

## Application Modes

### Mode Definitions

| Mode | Purpose | URL Pattern | Access |
|------|---------|-------------|--------|
| `global-admin` | Platform administration | `admin.zygo.tech` | Global admins only |
| `tenant` | Tenant workspace | `{slug}.zygo.tech` | Tenant members |
| `demo` | Product demonstration | `demo.zygo.tech` | Public (read-only) |
| `development` | Local development | `localhost:*` | Developers |

### Mode Capabilities

| Capability | Global Admin | Tenant | Demo | Development |
|------------|--------------|--------|------|-------------|
| View all tenants | ✅ | ❌ | ❌ | ❌ |
| Create tenants | ✅ | ❌ | ❌ | ❌ |
| Manage platform settings | ✅ | ❌ | ❌ | ❌ |
| View tenant dashboard | ❌ | ✅ | ✅ (read-only) | ✅ |
| Manage infrastructure | ❌ | ✅ | ❌ | ✅ |
| Manage billing | ❌ | ✅ | ❌ | ✅ |
| Access all features | ✅ | Per plan | Limited | ✅ |

---

## Mode Detection

### Frontend Mode Resolution

The UI determines application mode from the hostname at runtime:

```typescript
// src/contexts/AppModeProvider.tsx

type AppMode = 'global-admin' | 'tenant' | 'demo' | 'development';

interface ModeConfig {
  mode: AppMode;
  tenantSlug: string | null;
  isAdmin: boolean;
  isDemo: boolean;
  isDevelopment: boolean;
}

function resolveAppMode(): ModeConfig {
  const hostname = window.location.hostname;
  const port = window.location.port;

  // Development mode (localhost)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return {
      mode: 'development',
      tenantSlug: localStorage.getItem('dev_tenant_slug') || 'demo',
      isAdmin: false,
      isDemo: false,
      isDevelopment: true,
    };
  }

  // Global admin mode
  if (hostname === 'admin.zygo.tech') {
    return {
      mode: 'global-admin',
      tenantSlug: null,
      isAdmin: true,
      isDemo: false,
      isDevelopment: false,
    };
  }

  // Demo mode
  if (hostname === 'demo.zygo.tech') {
    return {
      mode: 'demo',
      tenantSlug: 'demo',
      isAdmin: false,
      isDemo: true,
      isDevelopment: false,
    };
  }

  // Tenant mode: {slug}.zygo.tech
  const tenantMatch = hostname.match(/^([a-z0-9-]+)\.app\.zygo\.tech$/);
  if (tenantMatch) {
    return {
      mode: 'tenant',
      tenantSlug: tenantMatch[1],
      isAdmin: false,
      isDemo: false,
      isDevelopment: false,
    };
  }

  // Fallback to demo
  return {
    mode: 'demo',
    tenantSlug: 'demo',
    isAdmin: false,
    isDemo: true,
    isDevelopment: false,
  };
}
```

### Backend Mode Resolution

The API extracts tenant context from JWT claims and request headers:

```typescript
// Backend middleware

interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  isGlobalAdmin: boolean;
}

function extractTenantContext(req: Request): TenantContext {
  // Check JWT claims first
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const decoded = verifyJwt(token);
    if (decoded.is_global_admin) {
      // Global admin can access any tenant via X-Tenant-ID header
      const targetTenantId = req.headers['x-tenant-id'];
      return {
        tenantId: targetTenantId || null,
        tenantSlug: null,
        isGlobalAdmin: true,
      };
    }
    return {
      tenantId: decoded.tenant_id,
      tenantSlug: decoded.tenant_slug,
      isGlobalAdmin: false,
    };
  }

  // Extract from hostname for unauthenticated requests
  const host = req.headers.host;
  const tenantMatch = host?.match(/^([a-z0-9-]+)\.app\.zygo\.tech$/);
  if (tenantMatch) {
    const tenant = await getTenantBySlug(tenantMatch[1]);
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      isGlobalAdmin: false,
    };
  }

  throw new UnauthorizedError('Cannot determine tenant context');
}
```

---

## Provider Hierarchy

### React Context Hierarchy

```
<StrictMode>
  └── <AppModeProvider>           // Determines global-admin vs tenant vs demo
        └── <TenantProvider>       // Loads tenant config, manages tenant state
              └── <AuthProvider>   // Authentication, user session
                    └── <PermissionProvider>  // RBAC, permission checks
                          └── <App />
```

### Provider Responsibilities

| Provider | Responsibility | State |
|----------|---------------|-------|
| `AppModeProvider` | Mode detection, routing decisions | `mode`, `tenantSlug`, `isAdmin` |
| `TenantProvider` | Tenant config, branding, limits | `tenant`, `config`, `features` |
| `AuthProvider` | User auth, session, tokens | `user`, `session`, `isAuthenticated` |
| `PermissionProvider` | Permission checks, role info | `permissions`, `role`, `hasPermission()` |

### Context Flow Example

```typescript
// Component consuming all contexts
function Dashboard() {
  const { mode, isDemo } = useAppMode();
  const { tenant, config } = useTenant();
  const { user, session } = useAuth();
  const { hasPermission } = usePermissions();

  if (isDemo) {
    return <DemoNotice />;
  }

  if (!hasPermission('canViewDashboard')) {
    return <AccessDenied />;
  }

  return (
    <div style={{ backgroundColor: tenant.primaryColor }}>
      <h1>Welcome to {tenant.name}</h1>
      <p>Hello, {user.displayName}</p>
    </div>
  );
}
```

---

## Tenant Isolation

### Isolation Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│   - Provider hierarchy enforces context                      │
│   - Route guards check tenant membership                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                        API Layer                             │
│   - JWT validation extracts tenant_id                        │
│   - Middleware injects tenant context                        │
│   - All queries scoped to tenant                            │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                     Database Layer                           │
│   - Row-Level Security (RLS) policies                        │
│   - tenant_id column on all tables                           │
│   - Foreign key constraints                                  │
└─────────────────────────────────────────────────────────────┘
```

### API Middleware

```typescript
// Tenant isolation middleware
async function tenantIsolationMiddleware(req, res, next) {
  const context = extractTenantContext(req);

  // Inject tenant context for all database queries
  req.tenantId = context.tenantId;
  req.isGlobalAdmin = context.isGlobalAdmin;

  // Set RLS context for Supabase
  if (context.tenantId) {
    await supabase.rpc('set_tenant_context', {
      tenant_id: context.tenantId
    });
  }

  next();
}

// Apply to all routes
app.use('/api', tenantIsolationMiddleware);
```

### Database RLS

```sql
-- Set tenant context (called at start of each request)
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policy using context
CREATE POLICY tenant_isolation ON servers
  FOR ALL
  USING (
    tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
  );
```

---

## Storage Isolation

### Client-Side Storage

All localStorage/sessionStorage keys are prefixed with tenant context:

```typescript
// Storage utility with tenant prefixing
class TenantStorage {
  private prefix: string;

  constructor(tenantSlug: string) {
    this.prefix = `zygo:tenant:${tenantSlug}:`;
  }

  getItem(key: string): string | null {
    return localStorage.getItem(this.prefix + key);
  }

  setItem(key: string, value: string): void {
    localStorage.setItem(this.prefix + key, value);
  }

  removeItem(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  clear(): void {
    // Only clear tenant-specific keys
    Object.keys(localStorage)
      .filter(key => key.startsWith(this.prefix))
      .forEach(key => localStorage.removeItem(key));
  }
}

// Usage
const storage = new TenantStorage('acme-corp');
storage.setItem('theme', 'dark');
// Stored as: zygo:tenant:acme-corp:theme = dark
```

### Storage Key Patterns

| Key Pattern | Purpose | Scope |
|-------------|---------|-------|
| `zygo:tenant:{slug}:*` | Tenant-specific data | Per tenant |
| `zygo:session:*` | Session data | Per session |
| `zygo:global:*` | Cross-tenant settings | Global |

### File Storage

Files are stored with tenant-prefixed paths:

```
s3://zygo-files/
├── tenants/
│   ├── {tenant_id}/
│   │   ├── uploads/
│   │   │   ├── avatars/
│   │   │   └── documents/
│   │   ├── exports/
│   │   └── backups/
│   └── {another_tenant_id}/
└── global/
    └── templates/
```

---

## API Request Flow

### Authenticated Request Flow

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Client  │───▶│   CDN   │───▶│   API   │───▶│   DB    │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
     │                              │              │
     │ 1. Request with JWT          │              │
     │    Authorization: Bearer ... │              │
     │                              │              │
     │                    2. Extract tenant_id     │
     │                       from JWT claims       │
     │                              │              │
     │                    3. Set RLS context       │
     │                              │──────────────▶
     │                              │              │
     │                    4. Execute query         │
     │                       (RLS filters data)    │
     │                              │◀─────────────│
     │                              │              │
     │ 5. Return tenant-scoped data │              │
     │◀─────────────────────────────│              │
```

### JWT Token Structure

```json
{
  "sub": "user_123",
  "email": "user@example.com",
  "tenant_id": "tenant_456",
  "tenant_slug": "acme-corp",
  "role": "admin",
  "permissions": ["canManageUsers", "canViewBilling"],
  "is_global_admin": false,
  "iat": 1706313600,
  "exp": 1706400000
}
```

### Global Admin Override

Global admins can access any tenant by specifying `X-Tenant-ID` header:

```http
GET /api/v1/users HTTP/1.1
Authorization: Bearer eyJ... (global admin token)
X-Tenant-ID: tenant_456
```

```typescript
// Backend handling
if (user.is_global_admin && req.headers['x-tenant-id']) {
  // Override tenant context for this request
  req.tenantId = req.headers['x-tenant-id'];
}
```

---

## Database Tenancy

### Schema Design

Every tenant-scoped table includes:

```sql
CREATE TABLE example_table (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- ... other columns
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Always index tenant_id
CREATE INDEX idx_example_tenant ON example_table(tenant_id);
```

### Cross-Tenant Queries (Admin Only)

```sql
-- Admin function to query across tenants
CREATE OR REPLACE FUNCTION admin_get_all_users()
RETURNS TABLE (
  tenant_name TEXT,
  user_count BIGINT
)
SECURITY DEFINER
AS $$
BEGIN
  -- Only callable by global admin service account
  IF NOT is_global_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT t.name, COUNT(tm.user_id)
  FROM tenants t
  LEFT JOIN tenant_members tm ON t.id = tm.tenant_id
  GROUP BY t.name;
END;
$$ LANGUAGE plpgsql;
```

### Tenant Provisioning

```sql
-- Provision new tenant (transaction)
CREATE OR REPLACE FUNCTION provision_tenant(
  p_name TEXT,
  p_slug TEXT,
  p_owner_email TEXT,
  p_plan TEXT DEFAULT 'free'
)
RETURNS UUID AS $$
DECLARE
  v_tenant_id UUID;
  v_owner_id UUID;
  v_owner_role_id UUID;
BEGIN
  -- Create tenant
  INSERT INTO tenants (name, slug, plan)
  VALUES (p_name, p_slug, p_plan)
  RETURNING id INTO v_tenant_id;

  -- Create default config
  INSERT INTO tenant_config (tenant_id)
  VALUES (v_tenant_id);

  -- Create default roles
  INSERT INTO roles (tenant_id, name, slug, hierarchy_level, is_system)
  VALUES
    (v_tenant_id, 'Owner', 'owner', 0, TRUE),
    (v_tenant_id, 'Admin', 'admin', 10, TRUE),
    (v_tenant_id, 'Member', 'member', 50, TRUE),
    (v_tenant_id, 'Viewer', 'viewer', 100, TRUE);

  -- Get owner role ID
  SELECT id INTO v_owner_role_id FROM roles
  WHERE tenant_id = v_tenant_id AND slug = 'owner';

  -- Create or get owner user
  INSERT INTO users (email)
  VALUES (p_owner_email)
  ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_owner_id;

  -- Add owner to tenant
  INSERT INTO tenant_members (tenant_id, user_id, role_id, status)
  VALUES (v_tenant_id, v_owner_id, v_owner_role_id, 'active');

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Caching Strategy

### Cache Key Patterns

```typescript
// Redis cache keys with tenant prefix
const cacheKeys = {
  tenantConfig: (tenantId: string) => `zygo:cache:tenant:${tenantId}:config`,
  userPermissions: (tenantId: string, userId: string) =>
    `zygo:cache:tenant:${tenantId}:user:${userId}:permissions`,
  rolePermissions: (roleId: string) =>
    `zygo:cache:role:${roleId}:permissions`,
};

// TTLs
const cacheTTL = {
  tenantConfig: 300,      // 5 minutes
  userPermissions: 60,    // 1 minute
  rolePermissions: 300,   // 5 minutes
};
```

### Cache Invalidation

```typescript
// Invalidate on permission change
async function onPermissionChange(tenantId: string) {
  // Clear all user permission caches for this tenant
  const pattern = `zygo:cache:tenant:${tenantId}:user:*:permissions`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(keys);
  }
}
```

---

## Security Considerations

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Tenant data leakage | RLS policies, API middleware |
| Cross-tenant authentication | JWT tenant_id validation |
| Privilege escalation | Role hierarchy checks |
| Session hijacking | Tenant-bound sessions |
| Cache poisoning | Tenant-prefixed cache keys |

### Audit Requirements

All cross-tenant operations must be logged:

```typescript
// Log all admin cross-tenant access
if (user.isGlobalAdmin && targetTenantId !== user.tenantId) {
  await auditLog.create({
    eventType: 'admin.cross_tenant_access',
    actorUserId: user.id,
    tenantId: targetTenantId,
    resource: req.path,
    severity: 'medium',
    legalBasis: 'legitimate_interest',
    purpose: 'Platform administration and support',
  });
}
```

### Regular Audits

1. **Monthly**: Review cross-tenant access logs
2. **Quarterly**: Test RLS policy effectiveness
3. **Annually**: Penetration testing for tenant isolation

---

## Tenant Switching

### Multi-Tenant Users

Users can be members of multiple tenants with different roles in each:

```sql
-- Example: User belongs to 3 tenants
SELECT t.name, t.slug, r.name as role, tm.is_owner
FROM tenant_members tm
JOIN tenants t ON tm.tenant_id = t.id
JOIN roles r ON tm.primary_role_id = r.id
WHERE tm.user_id = 'user_123' AND tm.status = 'active';

-- Result:
-- Acme Corp    | acme     | Owner    | true
-- Startup Inc  | startup  | Admin    | false
-- Personal     | personal | Owner    | true
```

### Tenant Selection Flow

When a user with multiple tenants logs in:

```
┌──────────────────────────────────────────────────────────────┐
│                       USER LOGS IN                            │
└─────────────────────────────┬────────────────────────────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
    ┌────────▼────────┐ ┌────▼─────┐ ┌────────▼────────┐
    │   0 Tenants     │ │ 1 Tenant │ │   2+ Tenants    │
    │ → Onboarding    │ │ → Direct │ │ → Select Page   │
    └─────────────────┘ │  Redirect│ └────────┬────────┘
                        └──────────┘          │
                                     ┌────────▼────────┐
                                     │ Select Workspace │
                                     │ /select-workspace│
                                     └────────┬────────┘
                                              │
                                     ┌────────▼────────┐
                                     │ User Selects    │
                                     │ → Auth token    │
                                     │ → Redirect      │
                                     └─────────────────┘
```

### API Response for Multi-Tenant Users

```typescript
// POST /api/v1/auth/signin response for multi-tenant user
{
  "user": {
    "id": "user_123",
    "email": "user@example.com"
  },
  "tenants": [
    {
      "id": "tenant_1",
      "name": "Acme Corp",
      "slug": "acme",
      "logoUrl": "https://...",
      "role": {
        "id": "role_1",
        "name": "Owner",
        "slug": "owner",
        "isOwner": true
      }
    },
    {
      "id": "tenant_2",
      "name": "Startup Inc",
      "slug": "startup",
      "logoUrl": null,
      "role": {
        "id": "role_2",
        "name": "Admin",
        "slug": "admin",
        "isOwner": false
      }
    }
  ],
  "redirect_url": "https://getzygo.com/select-workspace"
}
```

### Switching Between Tenants

Authenticated users can switch to another tenant they belong to:

```typescript
// POST /api/v1/auth/switch-tenant
// Requires: Authentication (must be logged into a tenant)

interface SwitchTenantRequest {
  tenant_slug: string;
}

interface SwitchTenantResponse {
  auth_token: string;
  redirect_url: string;
}

// Flow:
// 1. Verify user is authenticated
// 2. Verify user is member of target tenant
// 3. Fetch user's role in target tenant
// 4. Create opaque auth token with target tenant context
// 5. Return token and redirect URL
```

### Frontend Implementation

```typescript
// Header.tsx - TenantSwitcher component
async function handleTenantSwitch(targetSlug: string) {
  // 1. Call switch-tenant API
  const response = await fetch(`${API_BASE_URL}/auth/switch-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ tenant_slug: targetSlug }),
  });

  if (response.ok) {
    const { redirect_url } = await response.json();
    // 2. Redirect to new tenant (clears current session)
    window.location.href = redirect_url;
  }
}
```

### Session Isolation

Each tenant workspace maintains its own session:

- **localStorage**: Prefixed with `zygo:tenant:{slug}:*`
- **sessionStorage**: Contains `available_tenants` for selection
- **Cookies**: Scoped to subdomain when possible

Switching tenants:
1. Creates new auth token for target tenant
2. Redirects to target tenant's subdomain
3. Target tenant verifies token and creates new session
4. Old tenant's session remains until manually logged out

### Security Considerations

| Concern | Mitigation |
|---------|------------|
| Unauthorized tenant access | Membership verified before token creation |
| Cross-tenant data exposure | Complete session isolation per tenant |
| Token reuse across tenants | Tenant ID embedded in token, verified on use |
| Audit trail | All switches logged with source/target tenant |

---

## Changelog

### v2.1.0 (February 1, 2026)

- **Tenant Switching**
  - Multi-tenant user support documentation
  - Tenant selection flow for users with 2+ tenants
  - Switch-tenant API endpoint documentation
  - Session isolation between tenants
  - Security considerations for tenant switching

- **Cross-Domain Authentication**
  - References to new opaque token system in AUTHENTICATION.md
  - Updated authentication flow diagrams

### v2.0.0 (January 26, 2026)

- Complete rewrite based on UI implementation
- Added provider hierarchy documentation
- Added storage isolation patterns
- Added caching strategy
- Added security considerations
