# Zygo RBAC Contract

**Version:** 2.2
**Last Updated:** February 1, 2026
**Total Permissions:** 114
**System Roles:** 6 (owner, admin, billing_admin, developer, member, viewer)
**Custom Roles:** Unlimited per tenant

---

## Granular RBAC Architecture

### Overview

Zygo implements a **fully granular Role-Based Access Control (RBAC)** system where:

1. **Tenants can create unlimited custom roles** with any combination of 114 permissions
2. **System roles serve as templates** - predefined roles that cannot be modified or deleted
3. **Each permission is individually assignable** - no permission inheritance or bundling
4. **Role hierarchy** determines privilege level for sorting and display

This architecture enables enterprises to create roles that precisely match their organizational structure, security requirements, and workflow needs.

### System Roles vs Custom Roles

| Aspect | System Roles | Custom Roles |
|--------|-------------|--------------|
| Created by | Platform (built-in) | Tenant administrators |
| Modifiable | No | Yes |
| Deletable | No | Yes (if no members assigned) |
| Count | 6 fixed | Unlimited per tenant |
| Purpose | Default templates | Tenant-specific needs |
| Duplicatable | Yes (as template) | Yes |

### Role Data Structure

```typescript
interface Role {
  id: string;                    // UUID
  tenant_id: string;             // UUID - tenant ownership
  name: string;                  // Unique within tenant
  display_name: string;          // Human-readable name
  description: string;           // Role purpose description
  is_system: boolean;            // true = system role, false = custom
  hierarchy: number;             // Lower number = higher privilege (1-100)
  permissions: string[];         // Array of granted permission keys
  members_count: number;         // Users assigned to this role
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
  created_by: string;            // User ID who created (null for system)
}
```

### Role Hierarchy

Hierarchy determines the privilege level of a role:

| Hierarchy Level | Meaning | Example Roles |
|-----------------|---------|---------------|
| 1-10 | Executive / Owner level | Owner (1), Admin (10) |
| 11-30 | Management level | Developer (20), Support (30) |
| 31-60 | Standard users | Billing Admin (50), Member (60) |
| 61-100 | Limited access | Viewer (90) |

**Rules:**
- Lower hierarchy number = more privileged
- Users can only assign roles with equal or higher hierarchy number than their own
- Custom roles can be assigned any hierarchy level (1-100)
- Hierarchy is used for sorting in UI, not for permission inheritance

---

## Custom Role Management

### Creating Custom Roles

Tenants can create custom roles with any combination of the 114 available permissions.

**API Endpoint:** `POST /roles`

```typescript
// Request
{
  "name": "security_auditor",
  "display_name": "Security Auditor",
  "description": "Read-only access for security compliance auditing",
  "hierarchy": 45,
  "permissions": [
    "canViewAuditLogs",
    "canViewLogs",
    "canViewSecurityLogs",
    "canViewUsers",
    "canViewRoles",
    "canViewFirewalls",
    // ... any combination of 114 permissions
  ]
}

// Response
{
  "id": "role_abc123",
  "tenant_id": "tenant_xyz",
  "name": "security_auditor",
  "display_name": "Security Auditor",
  "description": "Read-only access for security compliance auditing",
  "is_system": false,
  "hierarchy": 45,
  "permissions": ["canViewAuditLogs", ...],
  "members_count": 0,
  "created_at": "2026-01-26T12:00:00Z",
  "updated_at": "2026-01-26T12:00:00Z",
  "created_by": "user_123"
}
```

### Editing Custom Roles

Custom roles can be fully edited - name, description, hierarchy, and permissions.

**API Endpoint:** `PATCH /roles/{roleId}`

```typescript
// Request - update permissions
{
  "permissions": [
    "canViewAuditLogs",
    "canViewLogs",
    "canExportLogs",        // Added
    "canViewSecurityLogs",
    // ... updated permission set
  ]
}

// Request - update role details
{
  "display_name": "Senior Security Auditor",
  "description": "Enhanced auditor with export capabilities",
  "hierarchy": 40
}
```

### Deleting Custom Roles

Custom roles can be deleted only if they have no assigned members.

**API Endpoint:** `DELETE /roles/{roleId}`

**Validation Rules:**
- Cannot delete system roles (400 error)
- Cannot delete roles with assigned members (400 error)
- Requires `canManageRoles` permission

```typescript
// Error response if role has members
{
  "error": "role_has_members",
  "message": "Cannot delete role with 5 assigned members. Reassign members first.",
  "members_count": 5
}
```

### Duplicating Roles

Create a new role based on an existing role's permissions (useful for creating variations).

**API Endpoint:** `POST /roles/{roleId}/duplicate`

```typescript
// Request
{
  "name": "senior_developer",
  "display_name": "Senior Developer",
  "description": "Developer with additional deployment permissions"
}

// Response - new role with copied permissions
{
  "id": "role_new123",
  "is_system": false,
  "permissions": [...], // Copied from source role
  // ... other fields
}
```

---

## Role Assignment

### Assigning Roles to Users

**API Endpoint:** `POST /users/{userId}/roles`

```typescript
// Request
{
  "role_id": "role_abc123"
}

// Validation:
// - Assigner must have canAssignRoles permission
// - Target role hierarchy must be >= assigner's role hierarchy
// - User must belong to same tenant
```

### Removing Roles from Users

**API Endpoint:** `DELETE /users/{userId}/roles/{roleId}`

**Rules:**
- Cannot remove the last role from a user (must have at least one)
- Cannot remove owner role from tenant owner
- Requires `canAssignRoles` permission

### Bulk Role Assignment

**API Endpoint:** `POST /roles/{roleId}/members`

```typescript
// Request - assign multiple users
{
  "user_ids": ["user_1", "user_2", "user_3"]
}
```

---

## Use Cases for Custom Roles

### Example 1: Compliance Officer

```typescript
{
  "name": "compliance_officer",
  "hierarchy": 35,
  "permissions": [
    // Audit & Logs
    "canViewAuditLogs",
    "canViewLogs",
    "canExportLogs",

    // User oversight
    "canViewUsers",
    "canViewRoles",

    // Data protection
    "canViewTenantSettings",

    // Documentation
    "canViewDocumentation"
  ]
}
```

### Example 2: Infrastructure Operator

```typescript
{
  "name": "infra_operator",
  "hierarchy": 25,
  "permissions": [
    // Full server operations
    "canViewServers",
    "canStartStopServers",
    "canAccessConsole",
    "canViewServerMetrics",

    // Limited volume ops
    "canViewVolumes",
    "canAttachVolumes",

    // Monitoring
    "canViewDashboards",
    "canViewLogs"

    // NO create/delete permissions
  ]
}
```

### Example 3: AI Team Lead

```typescript
{
  "name": "ai_team_lead",
  "hierarchy": 30,
  "permissions": [
    // Full AI access
    "canViewAIComponents",
    "canCreateAIComponents",
    "canEditAIComponents",
    "canDeleteAIComponents",
    "canDeployAIComponents",
    "canTrainModels",
    "canAccessAIAPI",
    "canViewAIMetrics",

    // Workflows
    "canManageWorkflows",
    "canExecuteWorkflows",

    // Team viewing
    "canViewUsers",

    // Monitoring
    "canViewDashboards",
    "canViewLogs"
  ]
}
```

### Example 4: Billing Viewer (Read-Only)

```typescript
{
  "name": "billing_viewer",
  "hierarchy": 70,
  "permissions": [
    "canViewInvoices",
    "canViewBillingOverview",
    "canViewTeamResources",
    "canViewPaymentBilling"
    // No management permissions
  ]
}
```

---

## Permission Categories

### 1. Billing & Subscription (9 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canChangePlans` | Change subscription plan | No | No |
| `canManageLicenses` | Manage license seats | No | No |
| `canManagePayment` | Manage payment methods | No | No |
| `canViewInvoices` | View billing invoices | No | No |
| `canCancelSubscription` | Cancel subscription | Yes | Yes |
| `canUpdateBillingInfo` | Update billing information | No | No |
| `canViewBillingOverview` | View billing overview | No | No |
| `canViewTeamResources` | View team resource usage | No | No |
| `canViewPaymentBilling` | View payment and billing | No | No |

### 2. User Management (4 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageUsers` | Full user management | No | No |
| `canInviteUsers` | Invite new users | No | No |
| `canDeleteUsers` | Delete users | Yes | No |
| `canViewUsers` | View user list | No | No |

### 3. Roles & Permissions (3 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageRoles` | Create/edit/delete roles | No | No |
| `canViewRoles` | View roles | No | No |
| `canAssignRoles` | Assign roles to users | No | No |

### 4. Organization Settings (3 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageTenantSettings` | Manage org settings | No | No |
| `canViewTenantSettings` | View org settings | No | No |
| `canDeleteTenant` | Delete organization | Yes | Yes |

### 5. Secrets & Environment Variables (5 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageSecrets` | Create/edit secrets | No | No |
| `canViewSecrets` | View secret values | No | No |
| `canManageTemplates` | Manage env templates | No | No |
| `canRotateSecrets` | Rotate secrets | No | No |
| `canExportSecrets` | Export secrets | Yes | Yes |

### 6. Webhooks (4 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageWebhooks` | Create/edit/delete webhooks | No | No |
| `canViewWebhooks` | View webhooks | No | No |
| `canTestWebhooks` | Test webhook delivery | No | No |
| `canViewWebhookLogs` | View webhook logs | No | No |

### 7. Cloud Provider Accounts (2 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageCloudProviders` | Manage provider accounts | No | No |
| `canViewCloudProviders` | View provider accounts | No | No |

### 8. Notifications (1 permission)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageNotifications` | Manage notification settings | No | No |

### 9. Servers & Compute (10 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewServers` | View server list | No | No |
| `canCreateServers` | Create new servers | No | No |
| `canManageServers` | Manage server settings | No | No |
| `canDeleteServers` | Delete servers | Yes | No |
| `canStartStopServers` | Start/stop servers | No | No |
| `canResizeServers` | Resize servers | No | No |
| `canRebuildServers` | Rebuild servers | Yes | No |
| `canAccessConsole` | Access server console | No | No |
| `canManageSSHKeys` | Manage SSH keys | No | No |
| `canViewServerMetrics` | View server metrics | No | No |

### 10. Volumes & Storage (7 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewVolumes` | View volumes | No | No |
| `canCreateVolumes` | Create volumes | No | No |
| `canManageVolumes` | Manage volumes | No | No |
| `canDeleteVolumes` | Delete volumes | Yes | No |
| `canAttachVolumes` | Attach/detach volumes | No | No |
| `canResizeVolumes` | Resize volumes | No | No |
| `canSnapshotVolumes` | Create snapshots | No | No |

### 11. Networks (6 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewNetworks` | View networks | No | No |
| `canCreateNetworks` | Create networks | No | No |
| `canManageNetworks` | Manage networks | No | No |
| `canDeleteNetworks` | Delete networks | Yes | No |
| `canAttachNetworks` | Attach to servers | No | No |
| `canConfigureVPN` | Configure VPN | No | No |

### 12. Firewalls & Security (6 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewFirewalls` | View firewalls | No | No |
| `canCreateFirewalls` | Create firewalls | No | No |
| `canManageFirewalls` | Manage firewall rules | No | No |
| `canDeleteFirewalls` | Delete firewalls | Yes | No |
| `canApplyFirewalls` | Apply to servers | No | No |
| `canViewSecurityLogs` | View security logs | No | No |

### 13. Load Balancers (7 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewLoadBalancers` | View load balancers | No | No |
| `canCreateLoadBalancers` | Create load balancers | No | No |
| `canManageLoadBalancers` | Manage load balancers | No | No |
| `canDeleteLoadBalancers` | Delete load balancers | Yes | No |
| `canConfigureHealthChecks` | Configure health checks | No | No |
| `canManageBackends` | Manage backends | No | No |
| `canConfigureSSL` | Configure SSL | No | No |

### 14. DNS Management (6 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewDNSZones` | View DNS zones | No | No |
| `canCreateDNSZones` | Create DNS zones | No | No |
| `canManageDNSRecords` | Manage DNS records | No | No |
| `canDeleteDNSZones` | Delete DNS zones | Yes | No |
| `canImportDNSZones` | Import DNS zones | No | No |
| `canExportDNSZones` | Export DNS zones | No | No |

### 15. Snapshots & Backups (6 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewSnapshots` | View snapshots | No | No |
| `canCreateSnapshots` | Create snapshots | No | No |
| `canDeleteSnapshots` | Delete snapshots | No | No |
| `canRestoreSnapshots` | Restore from snapshot | No | No |
| `canTransferSnapshots` | Transfer snapshots | No | No |
| `canScheduleBackups` | Schedule backups | No | No |

### 16. Floating IPs (4 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewFloatingIPs` | View floating IPs | No | No |
| `canCreateFloatingIPs` | Create floating IPs | No | No |
| `canDeleteFloatingIPs` | Delete floating IPs | No | No |
| `canAssignFloatingIPs` | Assign floating IPs | No | No |

### 17. AI Components (12 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewAIComponents` | View AI components | No | No |
| `canViewAIAgents` | View AI agents | No | No |
| `canViewNodes` | View nodes | No | No |
| `canViewTemplates` | View templates | No | No |
| `canCreateAIComponents` | Create AI components | No | No |
| `canEditAIComponents` | Edit AI components | No | No |
| `canDeleteAIComponents` | Delete AI components | Yes | No |
| `canDeployAIComponents` | Deploy AI components | No | No |
| `canTrainModels` | Train models | No | No |
| `canAccessAIAPI` | Access AI API | No | No |
| `canViewAIMetrics` | View AI metrics | No | No |

### 18. Workflows & Automation (6 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canManageWorkflows` | Manage workflows | No | No |
| `canViewWorkflows` | View workflows | No | No |
| `canExecuteWorkflows` | Execute workflows | No | No |
| `canScheduleWorkflows` | Schedule workflows | No | No |
| `canViewWorkflowLogs` | View workflow logs | No | No |
| `canDebugWorkflows` | Debug workflows | No | No |

### 19. Monitoring & Observability (6 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewDashboards` | View dashboards | No | No |
| `canCreateDashboards` | Create dashboards | No | No |
| `canViewLogs` | View logs | No | No |
| `canExportLogs` | Export logs | No | No |
| `canConfigureAlerts` | Configure alerts | No | No |
| `canViewAuditLogs` | View audit logs | No | No |

### 20. Documentation (4 permissions)

| Permission | Description | Critical | MFA |
|------------|-------------|----------|-----|
| `canViewDocumentation` | View documentation | No | No |
| `canEditDocumentation` | Edit documentation | No | No |
| `canPublishDocumentation` | Publish documentation | No | No |
| `canManageDocVersions` | Manage doc versions | No | No |

---

## System Role Definitions (Templates)

System roles are predefined, immutable roles that serve as templates for common organizational patterns. Tenants can use these as-is or duplicate them to create custom variations.

> **Note:** System roles cannot be modified or deleted. They provide consistent baseline access patterns across all tenants.

### Owner (114/114 permissions - 100%) — Hierarchy: 1

Full access to all tenant features. The tenant owner always has this role.

**Characteristics:**
- Cannot be deleted or demoted
- Only one user per tenant can be owner
- Has all 114 permissions including destructive operations

**Exclusive permissions:**
- `canCancelSubscription` (MFA required)
- `canDeleteTenant` (MFA required)

### Admin (112/114 permissions - 98%) — Hierarchy: 10

Full administrative access except tenant-level destructive actions.

**Denied permissions:**
- `canCancelSubscription`
- `canDeleteTenant`

**Use case:** Day-to-day administrators who manage the platform.

### Developer (73/114 permissions - 64%) — Hierarchy: 20

Technical access for infrastructure and development work.

**Granted categories:**
- All Servers & Compute (10)
- All Volumes & Storage (7)
- All Networks (6)
- All Firewalls (6)
- All Load Balancers (7)
- All DNS Management (6)
- All Snapshots (6)
- All Floating IPs (4)
- All Secrets (except export)
- All Webhooks
- All Workflows
- All AI Components
- All Monitoring

**Denied:**
- Billing management
- User/role management
- Tenant deletion
- Secret export (MFA-protected)

**Use case:** Engineers who build and deploy applications.

### Support (50/114 permissions - 44%) — Hierarchy: 30

View and monitor access for customer support teams.

**Granted:**
- View all infrastructure and resources
- View logs and monitoring
- View users (not manage)
- View workflows and executions

**Denied:**
- Create/edit/delete operations
- Billing management
- Secrets management

**Use case:** Support staff who troubleshoot issues.

### Billing Admin (23/114 permissions - 20%) — Hierarchy: 50

Focused on billing, subscriptions, and financial oversight.

**Granted:**
- All Billing & Subscription (9)
- `canViewUsers`
- `canViewRoles`
- `canViewTenantSettings`
- `canManageNotifications`
- `canViewDashboards`
- `canViewDocumentation`
- Limited view permissions across other categories

**Use case:** Finance team members managing subscriptions and payments.

### Member (38/114 permissions - 33%) — Hierarchy: 60

Standard user with view access and limited editing capabilities.

**Granted:**
- View all infrastructure
- Create/edit AI components
- Execute workflows
- View monitoring
- View documentation

**Denied:**
- Infrastructure management (create/delete)
- User management
- Billing
- Secrets management

**Use case:** Team members who use the platform but don't manage infrastructure.

### Viewer (27/114 permissions - 24%) — Hierarchy: 90

Read-only access across the platform.

**Granted:**
- View all infrastructure
- View monitoring
- View webhooks
- View documentation
- Notification management

**Denied:**
- All create/edit/delete operations
- Secrets access
- Billing access

**Use case:** Stakeholders who need visibility without modification rights.

---

## Permission → Page Mapping

| Page | Required Permission(s) |
|------|----------------------|
| Dashboard | `canViewDashboards` |
| AI Components | `canViewAIComponents` |
| Create Node/AI | `canCreateAIComponents` |
| Environment Templates | `canManageTemplates` |
| Workflow Builder | `canManageWorkflows` |
| Cloud Infrastructure | `canViewServers` |
| Create Server | `canCreateServers` |
| Create Volume | `canCreateVolumes` |
| Create Network | `canCreateNetworks` |
| Create Firewall | `canCreateFirewalls` |
| Create DNS Zone | `canCreateDNSZones` |
| Create Load Balancer | `canCreateLoadBalancers` |
| Cloud Providers | `canViewCloudProviders` OR `canManageCloudProviders` |
| Monitoring | `canViewDashboards` |
| Settings - Notifications | `canManageNotifications` |
| Settings - Users | `canViewUsers` |
| Settings - Roles | `canViewRoles` |
| Settings - Create Role | `canManageRoles` |
| Settings - Tenant | `canViewTenantSettings` OR `canManageTenantSettings` |
| Billing | `canViewInvoices` OR `canManageLicenses` OR `canChangePlans` OR `canManagePayment` |
| Environment Variables | `canViewSecrets` OR `canManageSecrets` |
| Webhooks | `canViewWebhooks` OR `canManageWebhooks` |
| Server Management | `canViewServers` |
| Upgrade Server | `canViewServers` AND `canResizeServers` |
| Documentation | `canViewDocumentation` |

---

## Permission Check Functions

### Backend Middleware

```typescript
// Check single permission
function requirePermission(permission: string) {
  return async (req, res, next) => {
    const userPermissions = await getUserPermissions(req.user.id, req.tenant.id);
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
    }
    next();
  };
}

// Check any of multiple permissions (OR)
function requireAnyPermission(permissions: string[]) {
  return async (req, res, next) => {
    const userPermissions = await getUserPermissions(req.user.id, req.tenant.id);
    const hasAny = permissions.some(p => userPermissions.includes(p));
    if (!hasAny) {
      return res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
    }
    next();
  };
}

// Check all permissions (AND)
function requireAllPermissions(permissions: string[]) {
  return async (req, res, next) => {
    const userPermissions = await getUserPermissions(req.user.id, req.tenant.id);
    const hasAll = permissions.every(p => userPermissions.includes(p));
    if (!hasAll) {
      return res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
    }
    next();
  };
}

// Check MFA for critical operations
function requireMFA(permission: string) {
  return async (req, res, next) => {
    if (MFA_REQUIRED_PERMISSIONS.includes(permission)) {
      if (!req.user.mfaVerifiedAt || Date.now() - req.user.mfaVerifiedAt > 5 * 60 * 1000) {
        return res.status(403).json({
          error: 'mfa_required',
          message: 'MFA verification required for this action'
        });
      }
    }
    next();
  };
}
```

### Frontend Guards

```typescript
// Component-level guard
<PermissionGuard permission="canDeleteServers">
  <DeleteServerButton />
</PermissionGuard>

// Hook-based check
const { hasPermission, loading } = useRequirePermission('canManageUsers');

// Page-level access
if (!hasPageAccess('settings-users', permissions)) {
  return <AccessDenied />;
}
```

---

## Critical Operations

Operations marked as `critical: true` require additional confirmation:

1. `canCancelSubscription` - MFA + Confirmation dialog
2. `canDeleteTenant` - MFA + Type tenant name + Wait period
3. `canExportSecrets` - MFA + Audit log
4. `canDeleteUsers` - Confirmation dialog + Audit log
5. `canDeleteServers` - Confirmation dialog + Grace period option
6. `canRebuildServers` - Confirmation dialog (data loss warning)
7. `canDeleteVolumes` - Confirmation dialog (data loss warning)
8. `canDeleteNetworks` - Check for attached resources first
9. `canDeleteFirewalls` - Check for applied servers first
10. `canDeleteLoadBalancers` - Check for active traffic first
11. `canDeleteDNSZones` - Propagation warning
12. `canDeleteAIComponents` - Check for workflow dependencies

---

## Database Schema

```sql
-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  hierarchy_level INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- Permissions (seed data)
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  requires_mfa BOOLEAN DEFAULT FALSE,
  critical BOOLEAN DEFAULT FALSE
);

-- Role-Permission mapping
CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- User-Role mapping
CREATE TABLE user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id, tenant_id)
);

-- RLS Policy
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_tenant_isolation ON roles
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

---

## API Endpoints

### Role Management

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `GET /roles` | GET | `canViewRoles` | List all roles (system + custom) |
| `POST /roles` | POST | `canManageRoles` | Create custom role |
| `GET /roles/{id}` | GET | `canViewRoles` | Get role details with permissions |
| `PATCH /roles/{id}` | PATCH | `canManageRoles` | Update custom role (name, description, hierarchy, permissions) |
| `DELETE /roles/{id}` | DELETE | `canManageRoles` | Delete custom role (only if no members) |
| `POST /roles/{id}/duplicate` | POST | `canManageRoles` | Duplicate role as new custom role |

### Role Permissions

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `GET /roles/{id}/permissions` | GET | `canViewRoles` | Get permissions for a role |
| `PUT /roles/{id}/permissions` | PUT | `canManageRoles` | Replace all permissions for custom role |
| `PATCH /roles/{id}/permissions` | PATCH | `canManageRoles` | Add/remove specific permissions |

### Permission Catalog

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `GET /permissions` | GET | `canViewRoles` | List all 114 available permissions |
| `GET /permissions/categories` | GET | `canViewRoles` | List permissions grouped by category |
| `GET /permissions/{key}` | GET | `canViewRoles` | Get permission details (critical, MFA, etc.) |

### Role Assignment

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `POST /users/{userId}/roles` | POST | `canAssignRoles` | Assign role to user |
| `DELETE /users/{userId}/roles/{roleId}` | DELETE | `canAssignRoles` | Remove role from user |
| `GET /roles/{id}/members` | GET | `canViewRoles` | List users with this role |
| `POST /roles/{id}/members` | POST | `canAssignRoles` | Bulk assign users to role |
| `DELETE /roles/{id}/members` | DELETE | `canAssignRoles` | Bulk remove users from role |

### Role Comparison & Export

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `GET /roles/compare` | GET | `canViewRoles` | Compare permissions between roles |
| `POST /roles/export` | POST | `canManageRoles` | Export role configurations as JSON |
| `POST /roles/import` | POST | `canManageRoles` | Import role configurations from JSON |

---

## Role Validation Rules

### Creating Roles

| Rule | Validation |
|------|------------|
| Name uniqueness | Role name must be unique within tenant |
| Name format | Lowercase alphanumeric with underscores, 3-50 chars |
| Permissions | At least 1 permission required |
| Hierarchy | Must be between 1-100 |
| System flag | Always `false` for created roles |

### Updating Roles

| Rule | Validation |
|------|------------|
| System roles | Cannot modify system roles (400 error) |
| Name change | New name must be unique within tenant |
| Permissions | At least 1 permission required |

### Deleting Roles

| Rule | Validation |
|------|------------|
| System roles | Cannot delete system roles (400 error) |
| Has members | Cannot delete role with assigned members (400 error) |

### Assigning Roles

| Rule | Validation |
|------|------------|
| Hierarchy check | Assigner's hierarchy must be ≤ target role's hierarchy |
| Self-assignment | Users cannot assign higher privilege roles to themselves |
| Owner role | Owner role can only be transferred by current owner |
| Minimum role | Users must have at least one role |

---

## Audit Events

All role and permission changes are logged with full audit trail:

### Role Lifecycle Events

| Event | Severity | Description |
|-------|----------|-------------|
| `role.created` | low | New custom role created |
| `role.updated` | medium | Role details updated (name, description, hierarchy) |
| `role.permissions_changed` | medium | Role permissions modified |
| `role.deleted` | high | Custom role deleted |
| `role.duplicated` | low | Role duplicated as new custom role |

### Role Assignment Events

| Event | Severity | Description |
|-------|----------|-------------|
| `role.assigned` | medium | Role assigned to user |
| `role.revoked` | medium | Role removed from user |
| `role.bulk_assigned` | medium | Multiple users assigned to role |
| `role.bulk_revoked` | medium | Multiple users removed from role |

### Permission Check Events

| Event | Severity | Description |
|-------|----------|-------------|
| `permission.check.denied` | medium | User denied access due to missing permission |
| `permission.check.critical_denied` | high | Critical permission check failed |
| `permission.mfa.required` | high | MFA required for critical operation |
| `permission.mfa.verified` | medium | MFA successfully verified |
| `permission.mfa.failed` | high | MFA verification failed |

### Audit Log Schema

```typescript
interface RoleAuditEvent {
  id: string;
  tenant_id: string;
  timestamp: string;
  event_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  actor: {
    user_id: string;
    email: string;
    role: string;
    ip_address: string;
  };
  target: {
    role_id?: string;
    role_name?: string;
    user_id?: string;
    user_email?: string;
  };
  changes?: {
    before: object;
    after: object;
  };
  permissions_added?: string[];
  permissions_removed?: string[];
  mfa_verified: boolean;
  metadata?: object;
}
```

---

## Implementation Checklist

### Backend Requirements

- [ ] Roles table with `is_system` flag and `permissions` JSONB column
- [ ] Role CRUD endpoints with validation
- [ ] Permission catalog endpoint (all 114 permissions)
- [ ] Role assignment with hierarchy checking
- [ ] Audit logging for all role operations
- [ ] RLS policies for tenant isolation
- [ ] Seed system roles on tenant creation

### Frontend Requirements

- [ ] Role management page with create/edit/delete
- [ ] Permission picker with category grouping
- [ ] Role comparison view
- [ ] Role assignment in user management
- [ ] Permission badges (critical, MFA required)
- [ ] Export/import role configurations

### Security Requirements

- [ ] Prevent self-privilege escalation
- [ ] MFA enforcement for critical permissions
- [ ] Audit all permission changes
- [ ] Rate limiting on role operations
- [ ] Validate permission keys against catalog

---

## Authentication Integration

### Role Data in Auth Tokens

When users authenticate (login, OAuth, or tenant switch), their role information is embedded in the opaque auth token:

```typescript
// Auth token payload includes RBAC data
interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  // ... other user fields

  // RBAC data (resolved at token creation)
  roleId: string;      // Primary role UUID
  roleName: string;    // e.g., "Admin", "Developer", "Custom Role"
  roleSlug: string;    // e.g., "admin", "developer", "custom-role"
  isOwner: boolean;    // true if user is tenant owner
}
```

### Permission Resolution

When the tenant app verifies the auth token, the backend resolves the user's complete permission set:

```typescript
// POST /auth/verify-token response
{
  "verified": true,
  "user": { /* user info */ },
  "tenant": { /* tenant info */ },
  "role": {
    "id": "role_123",
    "name": "Developer",
    "slug": "developer",
    "isOwner": false
  },
  "permissions": [
    "canViewServers",
    "canCreateServers",
    "canManageServers",
    "canViewVolumes",
    // ... all permissions the user has
  ]
}
```

**Permission Resolution Process:**

1. Get user's primary role for the tenant
2. Get user's secondary roles (if any)
3. Collect permissions from all roles
4. Return union of all permission keys

```typescript
// services/permission.service.ts
export async function resolvePermissions(
  userId: string,
  tenantId: string
): Promise<string[]> {
  // Get all user's roles in this tenant
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId)
    ),
    with: {
      primaryRole: true,
      secondaryRoles: {
        with: { role: true }
      }
    }
  });

  if (!membership) return [];

  // Collect permissions from all roles
  const allPermissions = new Set<string>();

  // Add primary role permissions
  membership.primaryRole.permissions.forEach(p => allPermissions.add(p));

  // Add secondary role permissions
  membership.secondaryRoles?.forEach(sr => {
    sr.role.permissions.forEach(p => allPermissions.add(p));
  });

  return Array.from(allPermissions);
}
```

### Frontend Permission Storage

The tenant app stores permissions for efficient UI checks:

```typescript
// After token verification
tenantStorage.set('user_role', JSON.stringify({
  id: data.role.id,
  name: data.role.name,
  slug: data.role.slug,
  isOwner: data.role.isOwner,
}));

tenantStorage.set('user_permissions', JSON.stringify(data.permissions));

// UserContext loads and provides permissions
const { permissions } = useUser();
if (permissions.canManageUsers) {
  // Show user management
}
```

### Permission Caching

Resolved permissions are cached in Redis for performance:

```typescript
// Cache key pattern
const cacheKey = `zygo:cache:tenant:${tenantId}:user:${userId}:permissions`;

// TTL: 5 minutes (invalidated on role change)
const cacheTTL = 300;

// Invalidation on role/permission change
async function onRoleChanged(tenantId: string, roleId: string) {
  // Get all users with this role
  const usersWithRole = await getUsersWithRole(roleId);

  // Clear their permission caches
  for (const userId of usersWithRole) {
    await redis.del(`zygo:cache:tenant:${tenantId}:user:${userId}:permissions`);
  }
}
```

---

## Changelog

### v2.1 (February 1, 2026)

- **Authentication Integration**
  - Documented role data in auth tokens
  - Added permission resolution process
  - Frontend permission storage patterns
  - Permission caching with Redis

- **Custom Role Management**
  - Clarified unlimited custom roles per tenant
  - Documented role create/edit/delete APIs
  - Role duplication for creating variations
  - Role deletion safeguards (no members required)

### v2.0 (January 26, 2026)

- Initial granular RBAC specification
- 114 permissions across 20 categories
- 6 system role definitions
- Role hierarchy and assignment rules
- Audit logging requirements
