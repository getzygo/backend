/**
 * Users Database Schema
 *
 * Core user table with authentication fields.
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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Authentication
    email: varchar('email', { length: 255 }).notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedVia: varchar('email_verified_via', { length: 20 }), // 'email', 'google', 'github', null
    passwordHash: text('password_hash').notNull(),

    // Profile
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    displayName: varchar('display_name', { length: 200 }),
    avatarUrl: text('avatar_url'),

    // Phone
    phone: varchar('phone', { length: 20 }),
    phoneCountryCode: varchar('phone_country_code', { length: 5 }),
    phoneVerified: boolean('phone_verified').notNull().default(false),

    // Location
    country: varchar('country', { length: 2 }), // ISO 3166-1 alpha-2
    city: varchar('city', { length: 100 }),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // active, suspended, deleted

    // MFA
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    mfaBackupCodes: jsonb('mfa_backup_codes'),

    // Terms acceptance
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: varchar('terms_version', { length: 20 }),
    privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true }),
    privacyVersion: varchar('privacy_version', { length: 20 }),

    // Subscription limits
    hasUsedTrial: boolean('has_used_trial').notNull().default(false), // Only 1 trial per email

    // Security
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 45 }),
    failedLoginAttempts: varchar('failed_login_attempts', { length: 10 }).default('0'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),

    // Administrative blocking (different from login lockout)
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    blockReason: varchar('block_reason', { length: 100 }),

    // Metadata
    metadata: jsonb('metadata').default({}),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    emailIdx: uniqueIndex('idx_users_email').on(table.email),
    statusIdx: index('idx_users_status').on(table.status),
    createdAtIdx: index('idx_users_created_at').on(table.createdAt),
  })
);

export const socialLogins = pgTable(
  'social_logins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Provider info
    provider: varchar('provider', { length: 20 }).notNull(),
    // google, github, microsoft, apple

    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    providerEmail: varchar('provider_email', { length: 255 }),

    // Profile data (not sensitive)
    profileData: jsonb('profile_data').default({}),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('idx_social_logins_user').on(table.userId),
    providerIdx: uniqueIndex('idx_social_logins_provider').on(
      table.provider,
      table.providerUserId
    ),
    userProviderIdx: uniqueIndex('idx_social_logins_user_provider').on(
      table.userId,
      table.provider
    ),
  })
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    tokenHash: text('token_hash').notNull().unique(),
    deviceInfo: jsonb('device_info').default({}),
    ipAddress: varchar('ip_address', { length: 45 }),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_refresh_tokens_user').on(table.userId),
    tokenHashIdx: uniqueIndex('idx_refresh_tokens_hash').on(table.tokenHash),
    expiresAtIdx: index('idx_refresh_tokens_expires').on(table.expiresAt),
  })
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    action: varchar('action', { length: 100 }).notNull(),
    // signup, login, logout, password_change, oauth_link, etc.

    resourceType: varchar('resource_type', { length: 50 }),
    resourceId: varchar('resource_id', { length: 100 }),

    details: jsonb('details').default({}),

    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),

    status: varchar('status', { length: 20 }).notNull().default('success'),
    // success, failure

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_audit_logs_user').on(table.userId),
    actionIdx: index('idx_audit_logs_action').on(table.action),
    createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
  })
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  socialLogins: many(socialLogins),
  refreshTokens: many(refreshTokens),
  auditLogs: many(auditLogs),
}));

export const socialLoginsRelations = relations(socialLogins, ({ one }) => ({
  user: one(users, {
    fields: [socialLogins.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SocialLogin = typeof socialLogins.$inferSelect;
export type NewSocialLogin = typeof socialLogins.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
