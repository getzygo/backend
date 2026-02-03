/**
 * Audit Service
 *
 * Logs actions to the audit_logs table for security and compliance tracking.
 * Provides tenant-scoped audit trails for sensitive operations.
 */

import { getDb } from '../db/client';
import { auditLogs, type NewAuditLog } from '../db/schema';
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';

// ============================================================================
// Audit Action Types
// ============================================================================

export const AUDIT_ACTIONS = {
  // Authentication
  SIGNUP: 'signup',
  LOGIN: 'login',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  PASSWORD_CHANGE: 'password_change',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET_COMPLETE: 'password_reset_complete',

  // MFA
  MFA_ENABLED: 'mfa_enabled',
  MFA_DISABLED: 'mfa_disabled',
  MFA_BACKUP_CODES_REGENERATED: 'mfa_backup_codes_regenerated',

  // Sessions
  SESSION_CREATED: 'session_created',
  SESSION_REVOKED: 'session_revoked',

  // OAuth
  OAUTH_LINK: 'oauth_link',
  OAUTH_UNLINK: 'oauth_unlink',

  // Profile
  PROFILE_UPDATE: 'profile_update',
  AVATAR_UPLOAD: 'avatar_upload',
  AVATAR_DELETE: 'avatar_delete',

  // Notifications
  NOTIFICATION_PREFERENCES_UPDATE: 'notification_preferences_update',
  NOTIFICATION_PREFERENCES_PAUSE: 'notification_preferences_pause',
  NOTIFICATION_PREFERENCES_RESUME: 'notification_preferences_resume',
  NOTIFICATION_DELETE: 'notification_delete',
  NOTIFICATION_MARK_READ: 'notification_mark_read',
  NOTIFICATION_MARK_ALL_READ: 'notification_mark_all_read',

  // Tenant
  TENANT_SETTINGS_UPDATE: 'tenant_settings_update',
  TENANT_SECURITY_UPDATE: 'tenant_security_update',

  // Users
  USER_INVITE: 'user_invite',
  USER_ROLE_CHANGE: 'user_role_change',
  USER_DELETE: 'user_delete',

  // Roles
  ROLE_CREATE: 'role_create',
  ROLE_UPDATE: 'role_update',
  ROLE_DELETE: 'role_delete',

  // Secrets
  SECRET_CREATE: 'secret_create',
  SECRET_UPDATE: 'secret_update',
  SECRET_DELETE: 'secret_delete',
  SECRET_ROTATE: 'secret_rotate',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

// ============================================================================
// Interfaces
// ============================================================================

export interface AuditLogEntry {
  userId?: string;
  tenantId?: string;
  action: AuditAction | string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status?: 'success' | 'failure';
}

export interface AuditQueryOptions {
  userId?: string;
  tenantId?: string;
  action?: string;
  resourceType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Audit Service Functions
// ============================================================================

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  const db = getDb();

  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details || {},
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      status: entry.status || 'success',
    });
  } catch (error) {
    // Log error but don't throw - audit logging should not break the main flow
    logger.error('Failed to create audit log:', error);
  }
}

/**
 * Log a notification preference change
 */
export async function logNotificationPreferenceChange(
  userId: string,
  tenantId: string,
  changes: Record<string, { old: unknown; new: unknown }>,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    userId,
    tenantId,
    action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATE,
    resourceType: 'notification_preferences',
    resourceId: `${userId}:${tenantId}`,
    details: {
      changes,
      changedAt: new Date().toISOString(),
    },
    ipAddress,
    userAgent,
    status: 'success',
  });
}

/**
 * Log notification pause action
 */
export async function logNotificationPause(
  userId: string,
  tenantId: string,
  pausedUntil: Date,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    userId,
    tenantId,
    action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_PAUSE,
    resourceType: 'notification_preferences',
    resourceId: `${userId}:${tenantId}`,
    details: {
      pausedUntil: pausedUntil.toISOString(),
      pausedAt: new Date().toISOString(),
    },
    ipAddress,
    userAgent,
    status: 'success',
  });
}

/**
 * Log notification resume action
 */
export async function logNotificationResume(
  userId: string,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    userId,
    tenantId,
    action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_RESUME,
    resourceType: 'notification_preferences',
    resourceId: `${userId}:${tenantId}`,
    details: {
      resumedAt: new Date().toISOString(),
    },
    ipAddress,
    userAgent,
    status: 'success',
  });
}

/**
 * Log notification deletion
 */
export async function logNotificationDelete(
  userId: string,
  tenantId: string,
  notificationId: string,
  notificationDetails?: {
    type?: string;
    category?: string;
    title?: string;
  },
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    userId,
    tenantId,
    action: AUDIT_ACTIONS.NOTIFICATION_DELETE,
    resourceType: 'notification',
    resourceId: notificationId,
    details: {
      ...notificationDetails,
      deletedAt: new Date().toISOString(),
    },
    ipAddress,
    userAgent,
    status: 'success',
  });
}

/**
 * Log mark all notifications as read
 */
export async function logNotificationMarkAllRead(
  userId: string,
  tenantId: string,
  count: number,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    userId,
    tenantId,
    action: AUDIT_ACTIONS.NOTIFICATION_MARK_ALL_READ,
    resourceType: 'notification',
    resourceId: `${userId}:${tenantId}`,
    details: {
      markedCount: count,
      markedAt: new Date().toISOString(),
    },
    ipAddress,
    userAgent,
    status: 'success',
  });
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(options: AuditQueryOptions): Promise<{
  logs: Array<typeof auditLogs.$inferSelect>;
  total: number;
}> {
  const db = getDb();
  const { userId, action, resourceType, startDate, endDate, limit = 50, offset = 0 } = options;

  // Build conditions
  const conditions = [];

  if (userId) {
    conditions.push(eq(auditLogs.userId, userId));
  }

  if (action) {
    conditions.push(eq(auditLogs.action, action));
  }

  if (resourceType) {
    conditions.push(eq(auditLogs.resourceType, resourceType));
  }

  if (startDate) {
    conditions.push(gte(auditLogs.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(auditLogs.createdAt, endDate));
  }

  // Get logs with pagination
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(whereClause);

  const total = Number(countResult[0]?.count || 0);

  return { logs, total };
}

/**
 * Get audit logs for a specific user
 */
export async function getUserAuditLogs(
  userId: string,
  options: Omit<AuditQueryOptions, 'userId'> = {}
): Promise<{
  logs: Array<typeof auditLogs.$inferSelect>;
  total: number;
}> {
  return queryAuditLogs({ ...options, userId });
}

/**
 * Get recent notification-related audit logs for a user
 */
export async function getNotificationAuditLogs(
  userId: string,
  tenantId: string,
  limit = 20
): Promise<Array<typeof auditLogs.$inferSelect>> {
  const db = getDb();

  const notificationActions = [
    AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATE,
    AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_PAUSE,
    AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_RESUME,
    AUDIT_ACTIONS.NOTIFICATION_DELETE,
    AUDIT_ACTIONS.NOTIFICATION_MARK_ALL_READ,
  ];

  const logs = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        sql`${auditLogs.action} = ANY(${notificationActions})`
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return logs;
}

// ============================================================================
// Export Service
// ============================================================================

export const auditService = {
  AUDIT_ACTIONS,
  createAuditLog,
  logNotificationPreferenceChange,
  logNotificationPause,
  logNotificationResume,
  logNotificationDelete,
  logNotificationMarkAllRead,
  queryAuditLogs,
  getUserAuditLogs,
  getNotificationAuditLogs,
};
