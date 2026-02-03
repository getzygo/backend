/**
 * Security Database Schema
 *
 * Tables for authentication security enhancements:
 * - passkeys: WebAuthn credentials
 * - trusted_devices: MFA skip for trusted devices
 * - user_sessions: Active session management
 * - magic_links: Passwordless email authentication
 * - login_alerts: Suspicious login notifications
 * - webauthn_challenges: Temporary WebAuthn challenges
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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { tenants } from './tenants';

// Passkeys (WebAuthn credentials)
export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports').array(), // WebAuthn transports
    deviceType: varchar('device_type', { length: 50 }), // 'platform', 'cross-platform'
    name: varchar('name', { length: 100 }), // User-friendly name
    aaguid: text('aaguid'), // Authenticator Attestation GUID

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_passkeys_user').on(table.userId),
    credentialIdx: uniqueIndex('idx_passkeys_credential').on(table.credentialId),
  })
);

// Trusted Devices (MFA Remember)
export const trustedDevices = pgTable(
  'trusted_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    deviceHash: text('device_hash').notNull(),
    deviceName: varchar('device_name', { length: 100 }),
    browser: varchar('browser', { length: 50 }),
    os: varchar('os', { length: 50 }),
    ipAddress: varchar('ip_address', { length: 45 }),

    trustedUntil: timestamp('trusted_until', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_trusted_devices_user').on(table.userId),
    hashIdx: index('idx_trusted_devices_hash').on(table.deviceHash),
    expiresIdx: index('idx_trusted_devices_expires').on(table.trustedUntil),
  })
);

// User Sessions (Active Session Management)
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),

    tokenHash: text('token_hash').notNull().unique(),
    deviceName: varchar('device_name', { length: 100 }),
    browser: varchar('browser', { length: 50 }),
    os: varchar('os', { length: 50 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    locationCity: varchar('location_city', { length: 100 }),
    locationCountry: varchar('location_country', { length: 100 }),

    isCurrent: boolean('is_current').notNull().default(false),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_user_sessions_user').on(table.userId),
    tenantIdx: index('idx_user_sessions_tenant').on(table.tenantId),
    tokenIdx: uniqueIndex('idx_user_sessions_token').on(table.tokenHash),
    expiresIdx: index('idx_user_sessions_expires').on(table.expiresAt),
  })
);

// Magic Links
export const magicLinks = pgTable(
  'magic_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    redirectUrl: text('redirect_url'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index('idx_magic_links_email').on(table.email),
    tokenIdx: uniqueIndex('idx_magic_links_token').on(table.tokenHash),
    expiresIdx: index('idx_magic_links_expires').on(table.expiresAt),
  })
);

// Login Alerts
export const loginAlerts = pgTable(
  'login_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    alertType: varchar('alert_type', { length: 20 }).notNull(), // 'new_device', 'new_location', 'new_browser'
    ipAddress: varchar('ip_address', { length: 45 }),
    deviceInfo: jsonb('device_info').default({}),
    location: jsonb('location').default({}),

    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    isSuspicious: boolean('is_suspicious').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_login_alerts_user').on(table.userId),
    typeIdx: index('idx_login_alerts_type').on(table.alertType),
    createdIdx: index('idx_login_alerts_created').on(table.createdAt),
  })
);

// WebAuthn Challenges (temporary storage)
export const webauthnChallenges = pgTable(
  'webauthn_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

    challenge: text('challenge').notNull(),
    type: varchar('type', { length: 20 }).notNull(), // 'registration', 'authentication'

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_webauthn_challenges_user').on(table.userId),
    expiresIdx: index('idx_webauthn_challenges_expires').on(table.expiresAt),
  })
);

// Relations
export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, {
    fields: [passkeys.userId],
    references: [users.id],
  }),
}));

export const trustedDevicesRelations = relations(trustedDevices, ({ one }) => ({
  user: one(users, {
    fields: [trustedDevices.userId],
    references: [users.id],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [userSessions.tenantId],
    references: [tenants.id],
  }),
}));

export const loginAlertsRelations = relations(loginAlerts, ({ one }) => ({
  user: one(users, {
    fields: [loginAlerts.userId],
    references: [users.id],
  }),
}));

export const webauthnChallengesRelations = relations(webauthnChallenges, ({ one }) => ({
  user: one(users, {
    fields: [webauthnChallenges.userId],
    references: [users.id],
  }),
}));

// Types
export type Passkey = typeof passkeys.$inferSelect;
export type NewPasskey = typeof passkeys.$inferInsert;
export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type NewTrustedDevice = typeof trustedDevices.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type MagicLink = typeof magicLinks.$inferSelect;
export type NewMagicLink = typeof magicLinks.$inferInsert;
export type LoginAlert = typeof loginAlerts.$inferSelect;
export type NewLoginAlert = typeof loginAlerts.$inferInsert;
export type WebAuthnChallenge = typeof webauthnChallenges.$inferSelect;
export type NewWebAuthnChallenge = typeof webauthnChallenges.$inferInsert;
