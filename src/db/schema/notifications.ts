/**
 * Notifications Database Schema
 *
 * Tables for the notification system:
 * - notifications: In-app notifications for users
 * - notification_preferences: Per-user, per-tenant notification settings
 * - security_alert_log: Deduplication tracking for security alerts
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  integer,
  time,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { tenants } from './tenants';

// ============================================================================
// Notifications Table
// ============================================================================

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Notification content
    type: varchar('type', { length: 50 }).notNull(), // 'security', 'system', 'workflow', etc.
    category: varchar('category', { length: 50 }).notNull(), // 'login_alert', 'mfa_enabled', etc.
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message'),

    // Action (SECURITY: Store internal route only, NOT full URL to prevent open redirect)
    // Example: '/settings/security' not 'https://evil.com/phish'
    actionRoute: varchar('action_route', { length: 255 }),
    actionLabel: varchar('action_label', { length: 100 }),

    // Severity levels: 'info', 'warning', 'danger', 'success'
    severity: varchar('severity', { length: 20 }).notNull().default('info'),

    // Read status
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),

    // Additional metadata (for custom data)
    metadata: jsonb('metadata').default({}),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Auto-cleanup old notifications (90 days default)
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW() + INTERVAL '90 days'`),
  },
  (table) => ({
    // Composite index for tenant-scoped queries
    userTenantIdx: index('idx_notifications_user_tenant').on(table.userId, table.tenantId),
    // Partial index for unread notifications (most common query)
    unreadIdx: index('idx_notifications_unread').on(table.userId, table.tenantId, table.isRead),
    // For cleanup job
    expiresIdx: index('idx_notifications_expires').on(table.expiresAt),
    // For chronological listing
    createdIdx: index('idx_notifications_created').on(table.createdAt),
  })
);

// ============================================================================
// Notification Preferences Table
// ============================================================================

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Global toggles
    emailEnabled: boolean('email_enabled').notNull().default(true),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    soundEnabled: boolean('sound_enabled').notNull().default(true),
    soundVolume: integer('sound_volume').notNull().default(50), // 0-100

    // Do Not Disturb settings
    dndEnabled: boolean('dnd_enabled').notNull().default(false),
    dndStartTime: time('dnd_start_time'), // e.g., '22:00'
    dndEndTime: time('dnd_end_time'), // e.g., '08:00'

    // Per-category preferences (for user-disableable categories only)
    // Format: { "login_alert": { "email": true, "in_app": true }, ... }
    categoryPreferences: jsonb('category_preferences').default({}),

    // Temporary pause (until this timestamp)
    pausedUntil: timestamp('paused_until', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Per-tenant unique constraint
    userTenantUnique: uniqueIndex('idx_notification_preferences_user_tenant').on(
      table.userId,
      table.tenantId
    ),
  })
);

// ============================================================================
// Security Alert Log Table (for deduplication)
// ============================================================================

export const securityAlertLog = pgTable(
  'security_alert_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    alertType: varchar('alert_type', { length: 50 }).notNull(), // 'login_alert', 'suspicious_login', etc.
    // Fingerprint: hash of device+ip+browser for deduplication
    fingerprint: varchar('fingerprint', { length: 255 }).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Auto-cleanup after 24 hours
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW() + INTERVAL '24 hours'`),
  },
  (table) => ({
    // Deduplication index
    dedupIdx: index('idx_security_alert_dedup').on(
      table.userId,
      table.alertType,
      table.fingerprint
    ),
    // For cleanup job
    expiresIdx: index('idx_security_alert_expires').on(table.expiresAt),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [notifications.tenantId],
    references: [tenants.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [notificationPreferences.tenantId],
    references: [tenants.id],
  }),
}));

export const securityAlertLogRelations = relations(securityAlertLog, ({ one }) => ({
  user: one(users, {
    fields: [securityAlertLog.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Types
// ============================================================================

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

export type SecurityAlertLog = typeof securityAlertLog.$inferSelect;
export type NewSecurityAlertLog = typeof securityAlertLog.$inferInsert;

// Category preference type
export interface CategoryPreference {
  email?: boolean;
  inApp?: boolean;
  sound?: boolean;
}

export type CategoryPreferences = Record<string, CategoryPreference>;
