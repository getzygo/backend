/**
 * Permission Service
 *
 * Handles permission resolution and caching.
 * Per UNIFIED_AUTH_STRATEGY.md Section 9.2 and rbac_contract.md.
 */

import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import {
  roles,
  permissions,
  rolePermissions,
  tenantMembers,
  secondaryRoleAssignments,
  type Permission,
} from '../db/schema';

/**
 * All 114 permissions organized by category
 * Per rbac_contract.md
 */
export const ALL_PERMISSIONS: Array<{
  key: string;
  name: string;
  category: string;
  description: string;
  requiresMfa: boolean;
  isCritical: boolean;
}> = [
  // 1. Billing & Subscription (9)
  { key: 'canChangePlans', name: 'Change Plans', category: 'billing', description: 'Change subscription plan', requiresMfa: false, isCritical: false },
  { key: 'canManageLicenses', name: 'Manage Licenses', category: 'billing', description: 'Manage license seats', requiresMfa: false, isCritical: false },
  { key: 'canManagePayment', name: 'Manage Payment', category: 'billing', description: 'Manage payment methods', requiresMfa: false, isCritical: false },
  { key: 'canViewInvoices', name: 'View Invoices', category: 'billing', description: 'View billing invoices', requiresMfa: false, isCritical: false },
  { key: 'canCancelSubscription', name: 'Cancel Subscription', category: 'billing', description: 'Cancel subscription', requiresMfa: true, isCritical: true },
  { key: 'canUpdateBillingInfo', name: 'Update Billing Info', category: 'billing', description: 'Update billing information', requiresMfa: false, isCritical: false },
  { key: 'canViewBillingOverview', name: 'View Billing Overview', category: 'billing', description: 'View billing overview', requiresMfa: false, isCritical: false },
  { key: 'canViewTeamResources', name: 'View Team Resources', category: 'billing', description: 'View team resource usage', requiresMfa: false, isCritical: false },
  { key: 'canViewPaymentBilling', name: 'View Payment Billing', category: 'billing', description: 'View payment and billing', requiresMfa: false, isCritical: false },

  // 2. User Management (4)
  { key: 'canManageUsers', name: 'Manage Users', category: 'users', description: 'Full user management', requiresMfa: false, isCritical: false },
  { key: 'canInviteUsers', name: 'Invite Users', category: 'users', description: 'Invite new users', requiresMfa: false, isCritical: false },
  { key: 'canDeleteUsers', name: 'Delete Users', category: 'users', description: 'Delete users', requiresMfa: false, isCritical: true },
  { key: 'canViewUsers', name: 'View Users', category: 'users', description: 'View user list', requiresMfa: false, isCritical: false },

  // 3. Roles & Permissions (3)
  { key: 'canManageRoles', name: 'Manage Roles', category: 'roles', description: 'Create/edit/delete roles', requiresMfa: false, isCritical: false },
  { key: 'canViewRoles', name: 'View Roles', category: 'roles', description: 'View roles', requiresMfa: false, isCritical: false },
  { key: 'canAssignRoles', name: 'Assign Roles', category: 'roles', description: 'Assign roles to users', requiresMfa: false, isCritical: false },

  // 4. Organization Settings (3)
  { key: 'canManageTenantSettings', name: 'Manage Tenant Settings', category: 'organization', description: 'Manage org settings', requiresMfa: false, isCritical: false },
  { key: 'canViewTenantSettings', name: 'View Tenant Settings', category: 'organization', description: 'View org settings', requiresMfa: false, isCritical: false },
  { key: 'canDeleteTenant', name: 'Delete Tenant', category: 'organization', description: 'Delete organization', requiresMfa: true, isCritical: true },

  // 5. Secrets & Environment Variables (5)
  { key: 'canManageSecrets', name: 'Manage Secrets', category: 'secrets', description: 'Create/edit secrets', requiresMfa: false, isCritical: false },
  { key: 'canViewSecrets', name: 'View Secrets', category: 'secrets', description: 'View secret values', requiresMfa: false, isCritical: false },
  { key: 'canManageTemplates', name: 'Manage Templates', category: 'secrets', description: 'Manage env templates', requiresMfa: false, isCritical: false },
  { key: 'canRotateSecrets', name: 'Rotate Secrets', category: 'secrets', description: 'Rotate secrets', requiresMfa: false, isCritical: false },
  { key: 'canExportSecrets', name: 'Export Secrets', category: 'secrets', description: 'Export secrets', requiresMfa: true, isCritical: true },

  // 6. Webhooks (4)
  { key: 'canManageWebhooks', name: 'Manage Webhooks', category: 'webhooks', description: 'Create/edit/delete webhooks', requiresMfa: false, isCritical: false },
  { key: 'canViewWebhooks', name: 'View Webhooks', category: 'webhooks', description: 'View webhooks', requiresMfa: false, isCritical: false },
  { key: 'canTestWebhooks', name: 'Test Webhooks', category: 'webhooks', description: 'Test webhook delivery', requiresMfa: false, isCritical: false },
  { key: 'canViewWebhookLogs', name: 'View Webhook Logs', category: 'webhooks', description: 'View webhook logs', requiresMfa: false, isCritical: false },

  // 7. Cloud Provider Accounts (2)
  { key: 'canManageCloudProviders', name: 'Manage Cloud Providers', category: 'cloud', description: 'Manage provider accounts', requiresMfa: false, isCritical: false },
  { key: 'canViewCloudProviders', name: 'View Cloud Providers', category: 'cloud', description: 'View provider accounts', requiresMfa: false, isCritical: false },

  // 8. Notifications (1)
  { key: 'canManageNotifications', name: 'Manage Notifications', category: 'notifications', description: 'Manage notification settings', requiresMfa: false, isCritical: false },

  // 9. Servers & Compute (10)
  { key: 'canViewServers', name: 'View Servers', category: 'servers', description: 'View server list', requiresMfa: false, isCritical: false },
  { key: 'canCreateServers', name: 'Create Servers', category: 'servers', description: 'Create new servers', requiresMfa: false, isCritical: false },
  { key: 'canManageServers', name: 'Manage Servers', category: 'servers', description: 'Manage server settings', requiresMfa: false, isCritical: false },
  { key: 'canDeleteServers', name: 'Delete Servers', category: 'servers', description: 'Delete servers', requiresMfa: false, isCritical: true },
  { key: 'canStartStopServers', name: 'Start/Stop Servers', category: 'servers', description: 'Start/stop servers', requiresMfa: false, isCritical: false },
  { key: 'canResizeServers', name: 'Resize Servers', category: 'servers', description: 'Resize servers', requiresMfa: false, isCritical: false },
  { key: 'canRebuildServers', name: 'Rebuild Servers', category: 'servers', description: 'Rebuild servers', requiresMfa: false, isCritical: true },
  { key: 'canAccessConsole', name: 'Access Console', category: 'servers', description: 'Access server console', requiresMfa: false, isCritical: false },
  { key: 'canManageSSHKeys', name: 'Manage SSH Keys', category: 'servers', description: 'Manage SSH keys', requiresMfa: false, isCritical: false },
  { key: 'canViewServerMetrics', name: 'View Server Metrics', category: 'servers', description: 'View server metrics', requiresMfa: false, isCritical: false },

  // 10. Volumes & Storage (7)
  { key: 'canViewVolumes', name: 'View Volumes', category: 'volumes', description: 'View volumes', requiresMfa: false, isCritical: false },
  { key: 'canCreateVolumes', name: 'Create Volumes', category: 'volumes', description: 'Create volumes', requiresMfa: false, isCritical: false },
  { key: 'canManageVolumes', name: 'Manage Volumes', category: 'volumes', description: 'Manage volumes', requiresMfa: false, isCritical: false },
  { key: 'canDeleteVolumes', name: 'Delete Volumes', category: 'volumes', description: 'Delete volumes', requiresMfa: false, isCritical: true },
  { key: 'canAttachVolumes', name: 'Attach Volumes', category: 'volumes', description: 'Attach/detach volumes', requiresMfa: false, isCritical: false },
  { key: 'canResizeVolumes', name: 'Resize Volumes', category: 'volumes', description: 'Resize volumes', requiresMfa: false, isCritical: false },
  { key: 'canSnapshotVolumes', name: 'Snapshot Volumes', category: 'volumes', description: 'Create snapshots', requiresMfa: false, isCritical: false },

  // 11. Networks (6)
  { key: 'canViewNetworks', name: 'View Networks', category: 'networks', description: 'View networks', requiresMfa: false, isCritical: false },
  { key: 'canCreateNetworks', name: 'Create Networks', category: 'networks', description: 'Create networks', requiresMfa: false, isCritical: false },
  { key: 'canManageNetworks', name: 'Manage Networks', category: 'networks', description: 'Manage networks', requiresMfa: false, isCritical: false },
  { key: 'canDeleteNetworks', name: 'Delete Networks', category: 'networks', description: 'Delete networks', requiresMfa: false, isCritical: true },
  { key: 'canAttachNetworks', name: 'Attach Networks', category: 'networks', description: 'Attach to servers', requiresMfa: false, isCritical: false },
  { key: 'canConfigureVPN', name: 'Configure VPN', category: 'networks', description: 'Configure VPN', requiresMfa: false, isCritical: false },

  // 12. Firewalls & Security (6)
  { key: 'canViewFirewalls', name: 'View Firewalls', category: 'firewalls', description: 'View firewalls', requiresMfa: false, isCritical: false },
  { key: 'canCreateFirewalls', name: 'Create Firewalls', category: 'firewalls', description: 'Create firewalls', requiresMfa: false, isCritical: false },
  { key: 'canManageFirewalls', name: 'Manage Firewalls', category: 'firewalls', description: 'Manage firewall rules', requiresMfa: false, isCritical: false },
  { key: 'canDeleteFirewalls', name: 'Delete Firewalls', category: 'firewalls', description: 'Delete firewalls', requiresMfa: false, isCritical: true },
  { key: 'canApplyFirewalls', name: 'Apply Firewalls', category: 'firewalls', description: 'Apply to servers', requiresMfa: false, isCritical: false },
  { key: 'canViewSecurityLogs', name: 'View Security Logs', category: 'firewalls', description: 'View security logs', requiresMfa: false, isCritical: false },

  // 13. Load Balancers (7)
  { key: 'canViewLoadBalancers', name: 'View Load Balancers', category: 'loadbalancers', description: 'View load balancers', requiresMfa: false, isCritical: false },
  { key: 'canCreateLoadBalancers', name: 'Create Load Balancers', category: 'loadbalancers', description: 'Create load balancers', requiresMfa: false, isCritical: false },
  { key: 'canManageLoadBalancers', name: 'Manage Load Balancers', category: 'loadbalancers', description: 'Manage load balancers', requiresMfa: false, isCritical: false },
  { key: 'canDeleteLoadBalancers', name: 'Delete Load Balancers', category: 'loadbalancers', description: 'Delete load balancers', requiresMfa: false, isCritical: true },
  { key: 'canConfigureHealthChecks', name: 'Configure Health Checks', category: 'loadbalancers', description: 'Configure health checks', requiresMfa: false, isCritical: false },
  { key: 'canManageBackends', name: 'Manage Backends', category: 'loadbalancers', description: 'Manage backends', requiresMfa: false, isCritical: false },
  { key: 'canConfigureSSL', name: 'Configure SSL', category: 'loadbalancers', description: 'Configure SSL', requiresMfa: false, isCritical: false },

  // 14. DNS Management (6)
  { key: 'canViewDNSZones', name: 'View DNS Zones', category: 'dns', description: 'View DNS zones', requiresMfa: false, isCritical: false },
  { key: 'canCreateDNSZones', name: 'Create DNS Zones', category: 'dns', description: 'Create DNS zones', requiresMfa: false, isCritical: false },
  { key: 'canManageDNSRecords', name: 'Manage DNS Records', category: 'dns', description: 'Manage DNS records', requiresMfa: false, isCritical: false },
  { key: 'canDeleteDNSZones', name: 'Delete DNS Zones', category: 'dns', description: 'Delete DNS zones', requiresMfa: false, isCritical: true },
  { key: 'canImportDNSZones', name: 'Import DNS Zones', category: 'dns', description: 'Import DNS zones', requiresMfa: false, isCritical: false },
  { key: 'canExportDNSZones', name: 'Export DNS Zones', category: 'dns', description: 'Export DNS zones', requiresMfa: false, isCritical: false },

  // 15. Snapshots & Backups (6)
  { key: 'canViewSnapshots', name: 'View Snapshots', category: 'snapshots', description: 'View snapshots', requiresMfa: false, isCritical: false },
  { key: 'canCreateSnapshots', name: 'Create Snapshots', category: 'snapshots', description: 'Create snapshots', requiresMfa: false, isCritical: false },
  { key: 'canDeleteSnapshots', name: 'Delete Snapshots', category: 'snapshots', description: 'Delete snapshots', requiresMfa: false, isCritical: false },
  { key: 'canRestoreSnapshots', name: 'Restore Snapshots', category: 'snapshots', description: 'Restore from snapshot', requiresMfa: false, isCritical: false },
  { key: 'canTransferSnapshots', name: 'Transfer Snapshots', category: 'snapshots', description: 'Transfer snapshots', requiresMfa: false, isCritical: false },
  { key: 'canScheduleBackups', name: 'Schedule Backups', category: 'snapshots', description: 'Schedule backups', requiresMfa: false, isCritical: false },

  // 16. Floating IPs (4)
  { key: 'canViewFloatingIPs', name: 'View Floating IPs', category: 'floatingips', description: 'View floating IPs', requiresMfa: false, isCritical: false },
  { key: 'canCreateFloatingIPs', name: 'Create Floating IPs', category: 'floatingips', description: 'Create floating IPs', requiresMfa: false, isCritical: false },
  { key: 'canDeleteFloatingIPs', name: 'Delete Floating IPs', category: 'floatingips', description: 'Delete floating IPs', requiresMfa: false, isCritical: false },
  { key: 'canAssignFloatingIPs', name: 'Assign Floating IPs', category: 'floatingips', description: 'Assign floating IPs', requiresMfa: false, isCritical: false },

  // 17. AI Components (11)
  { key: 'canViewAIComponents', name: 'View AI Components', category: 'ai', description: 'View AI components', requiresMfa: false, isCritical: false },
  { key: 'canViewAIAgents', name: 'View AI Agents', category: 'ai', description: 'View AI agents', requiresMfa: false, isCritical: false },
  { key: 'canViewNodes', name: 'View Nodes', category: 'ai', description: 'View nodes', requiresMfa: false, isCritical: false },
  { key: 'canViewTemplates', name: 'View Templates', category: 'ai', description: 'View templates', requiresMfa: false, isCritical: false },
  { key: 'canCreateAIComponents', name: 'Create AI Components', category: 'ai', description: 'Create AI components', requiresMfa: false, isCritical: false },
  { key: 'canEditAIComponents', name: 'Edit AI Components', category: 'ai', description: 'Edit AI components', requiresMfa: false, isCritical: false },
  { key: 'canDeleteAIComponents', name: 'Delete AI Components', category: 'ai', description: 'Delete AI components', requiresMfa: false, isCritical: true },
  { key: 'canDeployAIComponents', name: 'Deploy AI Components', category: 'ai', description: 'Deploy AI components', requiresMfa: false, isCritical: false },
  { key: 'canTrainModels', name: 'Train Models', category: 'ai', description: 'Train models', requiresMfa: false, isCritical: false },
  { key: 'canAccessAIAPI', name: 'Access AI API', category: 'ai', description: 'Access AI API', requiresMfa: false, isCritical: false },
  { key: 'canViewAIMetrics', name: 'View AI Metrics', category: 'ai', description: 'View AI metrics', requiresMfa: false, isCritical: false },

  // 18. Workflows & Automation (6)
  { key: 'canManageWorkflows', name: 'Manage Workflows', category: 'workflows', description: 'Manage workflows', requiresMfa: false, isCritical: false },
  { key: 'canViewWorkflows', name: 'View Workflows', category: 'workflows', description: 'View workflows', requiresMfa: false, isCritical: false },
  { key: 'canExecuteWorkflows', name: 'Execute Workflows', category: 'workflows', description: 'Execute workflows', requiresMfa: false, isCritical: false },
  { key: 'canScheduleWorkflows', name: 'Schedule Workflows', category: 'workflows', description: 'Schedule workflows', requiresMfa: false, isCritical: false },
  { key: 'canViewWorkflowLogs', name: 'View Workflow Logs', category: 'workflows', description: 'View workflow logs', requiresMfa: false, isCritical: false },
  { key: 'canDebugWorkflows', name: 'Debug Workflows', category: 'workflows', description: 'Debug workflows', requiresMfa: false, isCritical: false },

  // 19. Monitoring & Observability (6)
  { key: 'canViewDashboards', name: 'View Dashboards', category: 'monitoring', description: 'View dashboards', requiresMfa: false, isCritical: false },
  { key: 'canCreateDashboards', name: 'Create Dashboards', category: 'monitoring', description: 'Create dashboards', requiresMfa: false, isCritical: false },
  { key: 'canViewLogs', name: 'View Logs', category: 'monitoring', description: 'View logs', requiresMfa: false, isCritical: false },
  { key: 'canExportLogs', name: 'Export Logs', category: 'monitoring', description: 'Export logs', requiresMfa: false, isCritical: false },
  { key: 'canConfigureAlerts', name: 'Configure Alerts', category: 'monitoring', description: 'Configure alerts', requiresMfa: false, isCritical: false },
  { key: 'canViewAuditLogs', name: 'View Audit Logs', category: 'monitoring', description: 'View audit logs', requiresMfa: false, isCritical: false },

  // 20. Documentation (4)
  { key: 'canViewDocumentation', name: 'View Documentation', category: 'documentation', description: 'View documentation', requiresMfa: false, isCritical: false },
  { key: 'canEditDocumentation', name: 'Edit Documentation', category: 'documentation', description: 'Edit documentation', requiresMfa: false, isCritical: false },
  { key: 'canPublishDocumentation', name: 'Publish Documentation', category: 'documentation', description: 'Publish documentation', requiresMfa: false, isCritical: false },
  { key: 'canManageDocVersions', name: 'Manage Doc Versions', category: 'documentation', description: 'Manage doc versions', requiresMfa: false, isCritical: false },
];

// All permission keys as a set for quick lookup
export const ALL_PERMISSION_KEYS = new Set(ALL_PERMISSIONS.map((p) => p.key));

// Permissions that require MFA
export const MFA_REQUIRED_PERMISSIONS = ALL_PERMISSIONS
  .filter((p) => p.requiresMfa)
  .map((p) => p.key);

// Critical permissions
export const CRITICAL_PERMISSIONS = ALL_PERMISSIONS
  .filter((p) => p.isCritical)
  .map((p) => p.key);

/**
 * Get cache key for user permissions
 */
function getCacheKey(userId: string, tenantId: string): string {
  return `${REDIS_KEYS.RBAC}${userId}:${tenantId}`;
}

/**
 * Resolve permissions for a user in a tenant
 * Returns union of primary role + all active secondary roles
 * Per Section 9.2
 */
export async function resolvePermissions(
  userId: string,
  tenantId: string
): Promise<string[]> {
  const redis = getRedis();
  const cacheKey = getCacheKey(userId, tenantId);

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const db = getDb();

  // Get primary role
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    columns: { primaryRoleId: true },
  });

  if (!membership) {
    return [];
  }

  // Get secondary roles (active and not expired)
  const now = new Date();
  const secondaryRoles = await db.query.secondaryRoleAssignments.findMany({
    where: and(
      eq(secondaryRoleAssignments.userId, userId),
      eq(secondaryRoleAssignments.tenantId, tenantId),
      eq(secondaryRoleAssignments.status, 'active')
    ),
    columns: { roleId: true, expiresAt: true },
  });

  // Filter out expired secondary roles
  const activeSecondaryRoleIds = secondaryRoles
    .filter((sr) => !sr.expiresAt || new Date(sr.expiresAt) > now)
    .map((sr) => sr.roleId);

  // Get all role IDs
  const allRoleIds = [membership.primaryRoleId, ...activeSecondaryRoleIds];

  // Get permissions for all roles
  const rolePerms = await db
    .select({
      permissionKey: permissions.key,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, allRoleIds));

  // Union of all permissions (deduplicated)
  const permissionSet = new Set(rolePerms.map((rp) => rp.permissionKey));
  const permissionList = Array.from(permissionSet);

  // Cache the result
  await redis.setex(cacheKey, REDIS_TTL.RBAC, JSON.stringify(permissionList));

  return permissionList;
}

/**
 * Check if user has a specific permission
 */
export async function hasPermission(
  userId: string,
  tenantId: string,
  permission: string
): Promise<boolean> {
  const userPermissions = await resolvePermissions(userId, tenantId);
  return userPermissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions (OR)
 */
export async function hasAnyPermission(
  userId: string,
  tenantId: string,
  requiredPermissions: string[]
): Promise<boolean> {
  const userPermissions = await resolvePermissions(userId, tenantId);
  return requiredPermissions.some((p) => userPermissions.includes(p));
}

/**
 * Check if user has all of the specified permissions (AND)
 */
export async function hasAllPermissions(
  userId: string,
  tenantId: string,
  requiredPermissions: string[]
): Promise<boolean> {
  const userPermissions = await resolvePermissions(userId, tenantId);
  return requiredPermissions.every((p) => userPermissions.includes(p));
}

/**
 * Invalidate permission cache for a user in a tenant
 */
export async function invalidatePermissionCache(
  userId: string,
  tenantId: string
): Promise<void> {
  const redis = getRedis();
  const cacheKey = getCacheKey(userId, tenantId);
  await redis.del(cacheKey);
}

/**
 * Invalidate permission cache for all users with a specific role
 */
export async function invalidateRoleCache(
  roleId: string,
  tenantId: string
): Promise<void> {
  const db = getDb();
  const redis = getRedis();

  // Get all users with this role as primary
  const primaryMembers = await db.query.tenantMembers.findMany({
    where: and(
      eq(tenantMembers.primaryRoleId, roleId),
      eq(tenantMembers.tenantId, tenantId)
    ),
    columns: { userId: true },
  });

  // Get all users with this role as secondary
  const secondaryMembers = await db.query.secondaryRoleAssignments.findMany({
    where: and(
      eq(secondaryRoleAssignments.roleId, roleId),
      eq(secondaryRoleAssignments.tenantId, tenantId),
      eq(secondaryRoleAssignments.status, 'active')
    ),
    columns: { userId: true },
  });

  // Combine and deduplicate user IDs
  const userIds = new Set([
    ...primaryMembers.map((m) => m.userId),
    ...secondaryMembers.map((m) => m.userId),
  ]);

  // Invalidate cache for each user
  const pipeline = redis.pipeline();
  for (const userId of userIds) {
    const cacheKey = getCacheKey(userId, tenantId);
    pipeline.del(cacheKey);
  }
  await pipeline.exec();
}

/**
 * Cache permissions for a user (used during signup)
 */
export async function cachePermissions(
  userId: string,
  tenantId: string,
  permissionKeys: string[]
): Promise<void> {
  const redis = getRedis();
  const cacheKey = getCacheKey(userId, tenantId);
  await redis.setex(cacheKey, REDIS_TTL.RBAC, JSON.stringify(permissionKeys));
}

/**
 * Seed permissions to database (should be run once during setup)
 */
export async function seedPermissions(): Promise<void> {
  const db = getDb();

  // Check if permissions already exist
  const existing = await db.query.permissions.findFirst();
  if (existing) {
    console.log('Permissions already seeded');
    return;
  }

  console.log(`Seeding ${ALL_PERMISSIONS.length} permissions...`);

  await db.insert(permissions).values(
    ALL_PERMISSIONS.map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      description: p.description,
      requiresMfa: p.requiresMfa,
      isCritical: p.isCritical,
    }))
  );

  console.log('Permissions seeded successfully');
}

/**
 * Get all permissions grouped by category
 */
export function getPermissionsByCategory(): Record<string, typeof ALL_PERMISSIONS> {
  const grouped: Record<string, typeof ALL_PERMISSIONS> = {};

  for (const permission of ALL_PERMISSIONS) {
    if (!grouped[permission.category]) {
      grouped[permission.category] = [];
    }
    grouped[permission.category].push(permission);
  }

  return grouped;
}

export const permissionService = {
  ALL_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  MFA_REQUIRED_PERMISSIONS,
  CRITICAL_PERMISSIONS,
  resolvePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  invalidatePermissionCache,
  invalidateRoleCache,
  cachePermissions,
  seedPermissions,
  getPermissionsByCategory,
};
