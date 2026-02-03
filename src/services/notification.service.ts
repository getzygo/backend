/**
 * Notification Service
 *
 * Handles in-app notification creation, retrieval, and management.
 * All operations are scoped to (user_id, tenant_id) for proper isolation.
 */

import { eq, and, desc, lt, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { notifications, notificationPreferences } from '../db/schema';
import type {
  Notification,
  NewNotification,
  NotificationPreference,
  NewNotificationPreference,
  CategoryPreferences,
} from '../db/schema/notifications';

// Notification types
export type NotificationType = 'security' | 'system' | 'workflow' | 'team' | 'integration';
export type NotificationCategory =
  | 'login_alert'
  | 'suspicious_login'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'password_changed'
  | 'session_revoked'
  | 'backup_codes'
  | 'welcome'
  | 'workflow_created'
  | 'workflow_published'
  | 'team_invitation'
  | 'integration_failure'
  // Reminder categories
  | 'mfa_enablement_first'
  | 'mfa_enablement_final'
  | 'phone_verification_first'
  | 'phone_verification_final'
  | 'trial_expiration_first'
  | 'trial_expiration_final';
export type NotificationSeverity = 'info' | 'warning' | 'danger' | 'success';

// Server-side policy - NOT controlled by UI toggles
export const ALERT_POLICIES = {
  suspicious_login: 'ALWAYS_SEND',
  mfa_disabled: 'ALWAYS_SEND',
  account_locked: 'ALWAYS_SEND',
  password_changed: 'ALWAYS_SEND',
  login_alert: 'ALLOW_DISABLE',
  mfa_enabled: 'ALLOW_DISABLE',
  backup_codes: 'ALLOW_DISABLE',
  session_revoked: 'ALLOW_DISABLE',
  welcome: 'ALLOW_DISABLE',
  workflow_created: 'ALLOW_DISABLE',
  workflow_published: 'ALLOW_DISABLE',
  team_invitation: 'ALLOW_DISABLE',
  integration_failure: 'ALLOW_DISABLE',
  // Reminder policies - MFA and phone are critical security reminders
  mfa_enablement_first: 'ALWAYS_SEND',
  mfa_enablement_final: 'ALWAYS_SEND',
  phone_verification_first: 'ALWAYS_SEND',
  phone_verification_final: 'ALWAYS_SEND',
  // Trial reminders can be disabled by user
  trial_expiration_first: 'ALLOW_DISABLE',
  trial_expiration_final: 'ALLOW_DISABLE',
} as const;

interface CreateNotificationOptions {
  userId: string;
  tenantId: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message?: string;
  actionRoute?: string;
  actionLabel?: string;
  severity?: NotificationSeverity;
  metadata?: Record<string, unknown>;
}

interface GetNotificationsOptions {
  userId: string;
  tenantId: string;
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
}

interface NotificationWithPagination {
  notifications: Notification[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Create a new notification
 */
export async function createNotification(
  options: CreateNotificationOptions
): Promise<Notification> {
  const db = getDb();

  const [notification] = await db
    .insert(notifications)
    .values({
      userId: options.userId,
      tenantId: options.tenantId,
      type: options.type,
      category: options.category,
      title: options.title,
      message: options.message,
      actionRoute: options.actionRoute,
      actionLabel: options.actionLabel,
      severity: options.severity || 'info',
      metadata: options.metadata || {},
    })
    .returning();

  return notification;
}

/**
 * Get notifications for a user with pagination
 */
export async function getNotifications(
  options: GetNotificationsOptions
): Promise<NotificationWithPagination> {
  const db = getDb();
  const limit = Math.min(options.limit || 20, 100);

  // Build where conditions
  const whereConditions = [
    eq(notifications.userId, options.userId),
    eq(notifications.tenantId, options.tenantId),
  ];

  if (options.unreadOnly) {
    whereConditions.push(eq(notifications.isRead, false));
  }

  // Cursor-based pagination
  if (options.cursor) {
    const cursorNotification = await db.query.notifications.findFirst({
      where: eq(notifications.id, options.cursor),
    });
    if (cursorNotification) {
      whereConditions.push(lt(notifications.createdAt, cursorNotification.createdAt));
    }
  }

  const result = await db.query.notifications.findMany({
    where: and(...whereConditions),
    orderBy: desc(notifications.createdAt),
    limit: limit + 1, // Fetch one extra to check if there are more
  });

  const hasMore = result.length > limit;
  const notificationList = hasMore ? result.slice(0, limit) : result;
  const nextCursor = hasMore && notificationList.length > 0
    ? notificationList[notificationList.length - 1].id
    : undefined;

  return {
    notifications: notificationList,
    nextCursor,
    hasMore,
  };
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string, tenantId: string): Promise<number> {
  const db = getDb();

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.isRead, false)
      )
    );

  return result[0]?.count || 0;
}

/**
 * Mark a notification as read
 */
export async function markAsRead(
  notificationId: string,
  userId: string,
  tenantId: string
): Promise<boolean> {
  const db = getDb();

  const result = await db
    .update(notifications)
    .set({
      isRead: true,
      readAt: new Date(),
    })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId)
      )
    )
    .returning({ id: notifications.id });

  return result.length > 0;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string, tenantId: string): Promise<number> {
  const db = getDb();

  const result = await db
    .update(notifications)
    .set({
      isRead: true,
      readAt: new Date(),
    })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.isRead, false)
      )
    )
    .returning({ id: notifications.id });

  return result.length;
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  notificationId: string,
  userId: string,
  tenantId: string
): Promise<boolean> {
  const db = getDb();

  const result = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId)
      )
    )
    .returning({ id: notifications.id });

  return result.length > 0;
}

// ============================================================================
// Notification Preferences
// ============================================================================

/**
 * Get notification preferences for a user in a tenant
 */
export async function getPreferences(
  userId: string,
  tenantId: string
): Promise<NotificationPreference | null> {
  const db = getDb();

  const prefs = await db.query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.tenantId, tenantId)
    ),
  });

  return prefs || null;
}

/**
 * Get or create notification preferences for a user
 */
export async function getOrCreatePreferences(
  userId: string,
  tenantId: string
): Promise<NotificationPreference> {
  const db = getDb();

  // Try to get existing preferences
  let prefs = await getPreferences(userId, tenantId);

  if (!prefs) {
    // Create default preferences
    const [newPrefs] = await db
      .insert(notificationPreferences)
      .values({
        userId,
        tenantId,
      })
      .returning();
    prefs = newPrefs;
  }

  return prefs;
}

/**
 * Update notification preferences
 */
export async function updatePreferences(
  userId: string,
  tenantId: string,
  updates: Partial<{
    emailEnabled: boolean;
    inAppEnabled: boolean;
    soundEnabled: boolean;
    soundVolume: number;
    dndEnabled: boolean;
    dndStartTime: string;
    dndEndTime: string;
    categoryPreferences: CategoryPreferences;
    pausedUntil: Date | null;
  }>
): Promise<NotificationPreference> {
  const db = getDb();

  // Ensure preferences exist
  await getOrCreatePreferences(userId, tenantId);

  const [updated] = await db
    .update(notificationPreferences)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.tenantId, tenantId)
      )
    )
    .returning();

  return updated;
}

/**
 * Pause notifications until a specific time
 */
export async function pauseNotifications(
  userId: string,
  tenantId: string,
  pauseUntil: Date
): Promise<NotificationPreference> {
  return updatePreferences(userId, tenantId, { pausedUntil: pauseUntil });
}

/**
 * Resume notifications (clear pause)
 */
export async function resumeNotifications(
  userId: string,
  tenantId: string
): Promise<NotificationPreference> {
  return updatePreferences(userId, tenantId, { pausedUntil: null });
}

/**
 * Check if notifications are currently paused
 */
export async function areNotificationsPaused(userId: string, tenantId: string): Promise<boolean> {
  const prefs = await getPreferences(userId, tenantId);

  if (!prefs || !prefs.pausedUntil) {
    return false;
  }

  return new Date(prefs.pausedUntil) > new Date();
}

/**
 * Check if a notification category is enabled for a user
 * Respects ALWAYS_SEND policy
 */
export async function isCategoryEnabled(
  userId: string,
  tenantId: string,
  category: NotificationCategory,
  channel: 'email' | 'inApp' | 'sound'
): Promise<boolean> {
  // Check if this category has ALWAYS_SEND policy
  const policy = ALERT_POLICIES[category as keyof typeof ALERT_POLICIES];
  if (policy === 'ALWAYS_SEND') {
    return true;
  }

  const prefs = await getPreferences(userId, tenantId);

  if (!prefs) {
    // Default to enabled if no preferences set
    return true;
  }

  // Check global channel setting
  if (channel === 'email' && !prefs.emailEnabled) return false;
  if (channel === 'inApp' && !prefs.inAppEnabled) return false;
  if (channel === 'sound' && !prefs.soundEnabled) return false;

  // Check category-specific preference
  const categoryPrefs = prefs.categoryPreferences as CategoryPreferences | null;
  if (categoryPrefs && categoryPrefs[category]) {
    const catPref = categoryPrefs[category];
    if (channel === 'email' && catPref.email === false) return false;
    if (channel === 'inApp' && catPref.inApp === false) return false;
    if (channel === 'sound' && catPref.sound === false) return false;
  }

  return true;
}

export const notificationService = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getPreferences,
  getOrCreatePreferences,
  updatePreferences,
  pauseNotifications,
  resumeNotifications,
  areNotificationsPaused,
  isCategoryEnabled,
  ALERT_POLICIES,
};

export default notificationService;
