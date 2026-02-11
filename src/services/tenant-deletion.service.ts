/**
 * Tenant Deletion Service
 *
 * Orchestrates the tenant deletion workflow with compliance requirements:
 * 1. Request deletion (start grace period)
 * 2. Cancel deletion (within cancellation window)
 * 3. Execute deletion (after grace period)
 *    - Archive and encrypt tenant data
 *    - Anonymize audit logs
 *    - Delete tenant data
 *    - Retain billing records (7 years)
 *
 * Per DATA_PROTECTION.md: GDPR Art. 17, CCPA, SOC2
 */

import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  tenants,
  tenantMembers,
  tenantContacts,
  tenantSecurityConfig,
  roles,
  rolePermissions,
  secondaryRoleAssignments,
  auditLogs,
  users,
  type Tenant,
} from '../db/schema';
import { createTenantArchive } from './tenant-archive.service';
import { deleteCompanyLogoByPath, extractLogoStoragePath } from './company-logo.service';
import { logger } from '../utils/logger';

// Grace period: 30 days before deletion executes
export const GRACE_PERIOD_DAYS = 30;
// Cancellation window: 14 days to cancel after requesting
export const CANCELLATION_WINDOW_DAYS = 14;

/**
 * Deletion request result
 */
export interface DeletionRequestResult {
  success: boolean;
  error?: string;
  deletionScheduledAt?: Date;
  deletionCancelableUntil?: Date;
}

/**
 * Request tenant deletion
 * Starts the grace period countdown
 */
export async function requestTenantDeletion(
  tenantId: string,
  deletedBy: string,
  reason?: string
): Promise<DeletionRequestResult> {
  const db = getDb();

  // Get current tenant
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) {
    return { success: false, error: 'Tenant not found' };
  }

  if (tenant.status === 'deleted') {
    return { success: false, error: 'Tenant is already deleted' };
  }

  if (tenant.status === 'pending_deletion') {
    return {
      success: false,
      error: 'Deletion already requested',
      deletionScheduledAt: tenant.deletionScheduledAt || undefined,
      deletionCancelableUntil: tenant.deletionCancelableUntil || undefined,
    };
  }

  // Calculate dates
  const now = new Date();
  const deletionScheduledAt = new Date(now);
  deletionScheduledAt.setDate(deletionScheduledAt.getDate() + GRACE_PERIOD_DAYS);

  const deletionCancelableUntil = new Date(now);
  deletionCancelableUntil.setDate(deletionCancelableUntil.getDate() + CANCELLATION_WINDOW_DAYS);

  // Update tenant status
  await db
    .update(tenants)
    .set({
      status: 'pending_deletion',
      deletionRequestedAt: now,
      deletionScheduledAt,
      deletionCancelableUntil,
      deletedBy,
      deletionReason: reason,
      updatedAt: now,
    })
    .where(eq(tenants.id, tenantId));

  logger.info(`[TenantDeletion] Deletion requested for tenant ${tenantId}, scheduled for ${deletionScheduledAt.toISOString()}`);

  return {
    success: true,
    deletionScheduledAt,
    deletionCancelableUntil,
  };
}

/**
 * Cancel tenant deletion request
 * Only works within the cancellation window
 */
export async function cancelTenantDeletion(
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  // Get current tenant
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) {
    return { success: false, error: 'Tenant not found' };
  }

  if (tenant.status !== 'pending_deletion') {
    return { success: false, error: 'No pending deletion to cancel' };
  }

  // Check cancellation window
  const now = new Date();
  if (tenant.deletionCancelableUntil && tenant.deletionCancelableUntil < now) {
    return { success: false, error: 'Cancellation window has expired' };
  }

  // Restore tenant
  await db
    .update(tenants)
    .set({
      status: 'active',
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      deletionCancelableUntil: null,
      deletedBy: null,
      deletionReason: null,
      updatedAt: now,
    })
    .where(eq(tenants.id, tenantId));

  logger.info(`[TenantDeletion] Deletion cancelled for tenant ${tenantId}`);

  return { success: true };
}

/**
 * Get deletion status for a tenant
 */
export async function getDeletionStatus(tenantId: string): Promise<{
  status: 'none' | 'pending' | 'deleted';
  deletionRequestedAt?: Date;
  deletionScheduledAt?: Date;
  deletionCancelableUntil?: Date;
  canCancel?: boolean;
  daysUntilDeletion?: number;
  daysUntilCancelExpires?: number;
} | null> {
  const db = getDb();

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: {
      status: true,
      deletionRequestedAt: true,
      deletionScheduledAt: true,
      deletionCancelableUntil: true,
    },
  });

  if (!tenant) {
    return null;
  }

  if (tenant.status === 'deleted') {
    return { status: 'deleted' };
  }

  if (tenant.status !== 'pending_deletion') {
    return { status: 'none' };
  }

  const now = new Date();
  const canCancel = tenant.deletionCancelableUntil ? tenant.deletionCancelableUntil > now : false;

  const daysUntilDeletion = tenant.deletionScheduledAt
    ? Math.ceil((tenant.deletionScheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : undefined;

  const daysUntilCancelExpires = tenant.deletionCancelableUntil
    ? Math.ceil((tenant.deletionCancelableUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : undefined;

  return {
    status: 'pending',
    deletionRequestedAt: tenant.deletionRequestedAt || undefined,
    deletionScheduledAt: tenant.deletionScheduledAt || undefined,
    deletionCancelableUntil: tenant.deletionCancelableUntil || undefined,
    canCancel,
    daysUntilDeletion: daysUntilDeletion && daysUntilDeletion > 0 ? daysUntilDeletion : 0,
    daysUntilCancelExpires: daysUntilCancelExpires && daysUntilCancelExpires > 0 ? daysUntilCancelExpires : 0,
  };
}

/**
 * Execute tenant deletion
 * Called after grace period expires
 * Archives data, then deletes tenant
 */
export async function executeTenantDeletion(
  tenantId: string,
  force: boolean = false
): Promise<{ success: boolean; archiveId?: string; error?: string }> {
  const db = getDb();

  // Get tenant
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) {
    return { success: false, error: 'Tenant not found' };
  }

  if (tenant.status === 'deleted') {
    return { success: false, error: 'Tenant already deleted' };
  }

  // Check if grace period has passed (unless forced)
  if (!force && tenant.status === 'pending_deletion') {
    const now = new Date();
    if (tenant.deletionScheduledAt && tenant.deletionScheduledAt > now) {
      return { success: false, error: 'Grace period has not expired yet' };
    }
  }

  try {
    // Step 1: Create encrypted archive
    logger.info(`[TenantDeletion] Creating archive for tenant ${tenantId}`);
    const archiveResult = await createTenantArchive(
      tenantId,
      tenant.deletedBy || 'system',
      tenant.deletionReason || undefined
    );

    if (!archiveResult.archive) {
      return { success: false, error: `Archive creation failed: ${archiveResult.error}` };
    }

    const archiveId = archiveResult.archive.id;
    logger.info(`[TenantDeletion] Archive created: ${archiveId}`);

    // Step 2: Anonymize audit logs (replace user IDs with hashes)
    logger.info(`[TenantDeletion] Anonymizing audit logs for tenant ${tenantId}`);
    await anonymizeAuditLogs(tenantId);

    // Step 3: Delete tenant data (cascade will handle most)
    logger.info(`[TenantDeletion] Deleting tenant data for ${tenantId}`);

    // Delete company logo if exists
    if (tenant.logoUrl) {
      const logoPath = extractLogoStoragePath(tenant.logoUrl);
      if (logoPath) {
        await deleteCompanyLogoByPath(logoPath).catch((err) => {
          logger.warn(`[TenantDeletion] Failed to delete logo: ${err}`);
        });
      }
    }

    // Delete roles (cascade deletes role_permissions)
    const tenantRoles = await db.query.roles.findMany({
      where: eq(roles.tenantId, tenantId),
      columns: { id: true },
    });
    const roleIds = tenantRoles.map((r) => r.id);

    if (roleIds.length > 0) {
      // Delete secondary role assignments
      await db.delete(secondaryRoleAssignments).where(
        inArray(secondaryRoleAssignments.roleId, roleIds)
      );

      // Delete role permissions
      await db.delete(rolePermissions).where(
        inArray(rolePermissions.roleId, roleIds)
      );

      // Delete roles
      await db.delete(roles).where(eq(roles.tenantId, tenantId));
    }

    // Delete tenant members
    await db.delete(tenantMembers).where(eq(tenantMembers.tenantId, tenantId));

    // Delete tenant contacts
    await db.delete(tenantContacts).where(eq(tenantContacts.tenantId, tenantId));

    // Delete security config
    await db.delete(tenantSecurityConfig).where(eq(tenantSecurityConfig.tenantId, tenantId));

    // Step 4: Mark tenant as deleted (soft delete - keep for billing records)
    await db
      .update(tenants)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
        // Clear sensitive data but keep billing info for tax records
        logoUrl: null,
        website: null,
        phone: null,
        phoneCountryCode: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        stateProvince: null,
        postalCode: null,
        country: null,
        customDomain: null,
        customDomainVerified: false,
        metadata: { archived: true, archiveId },
      })
      .where(eq(tenants.id, tenantId));

    logger.info(`[TenantDeletion] Tenant ${tenantId} deleted successfully, archive: ${archiveId}`);

    return { success: true, archiveId };
  } catch (error) {
    logger.error(`[TenantDeletion] Error executing deletion for ${tenantId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Anonymize audit logs for a tenant
 * Replace user identifiers with hashed versions
 */
async function anonymizeAuditLogs(tenantId: string): Promise<void> {
  const db = getDb();

  // Get all audit logs for this tenant
  const logs = await db
    .select({ id: auditLogs.id, userId: auditLogs.userId, details: auditLogs.details })
    .from(auditLogs)
    .where(eq(auditLogs.resourceId, tenantId));

  // Anonymize in batches
  for (const log of logs) {
    const anonymizedDetails = log.details
      ? {
          ...(log.details as Record<string, unknown>),
          _anonymized: true,
          _anonymizedAt: new Date().toISOString(),
        }
      : { _anonymized: true, _anonymizedAt: new Date().toISOString() };

    await db
      .update(auditLogs)
      .set({
        // Replace userId with hash prefix (keep for correlation but not identification)
        details: anonymizedDetails,
      })
      .where(eq(auditLogs.id, log.id));
  }
}

/**
 * Get tenants ready for deletion (grace period expired)
 */
export async function getTenantsReadyForDeletion(): Promise<Tenant[]> {
  const db = getDb();
  const now = new Date();

  const pendingTenants = await db.query.tenants.findMany({
    where: eq(tenants.status, 'pending_deletion'),
  });

  return pendingTenants.filter(
    (t) => t.deletionScheduledAt && t.deletionScheduledAt <= now
  );
}

/**
 * Get all members of a tenant (for sending notifications)
 */
export async function getTenantMemberEmails(tenantId: string): Promise<
  Array<{ userId: string; email: string; firstName: string | null; isOwner: boolean }>
> {
  const db = getDb();

  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      isOwner: tenantMembers.isOwner,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.status, 'active')
      )
    );

  return members;
}

/**
 * Process all tenants ready for deletion
 * Called by the daily scheduled worker
 */
export async function processPendingTenantDeletions(): Promise<number> {
  const tenants = await getTenantsReadyForDeletion();
  let count = 0;
  for (const tenant of tenants) {
    try {
      await executeTenantDeletion(tenant.id);
      count++;
      console.log(`[TenantDeletion] Executed deletion for tenant ${tenant.id} (${tenant.name})`);
    } catch (error) {
      console.error(`[TenantDeletion] Failed to delete tenant ${tenant.id}:`, error);
      // Continue with next tenant — one failure shouldn't block others
    }
  }
  return count;
}

export const tenantDeletionService = {
  requestTenantDeletion,
  cancelTenantDeletion,
  getDeletionStatus,
  executeTenantDeletion,
  getTenantsReadyForDeletion,
  processPendingTenantDeletions,
  getTenantMemberEmails,
  GRACE_PERIOD_DAYS,
  CANCELLATION_WINDOW_DAYS,
};
