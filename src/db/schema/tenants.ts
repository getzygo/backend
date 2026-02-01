/**
 * Tenants Database Schema
 *
 * Multi-tenant organization tables with security configuration.
 * Per UNIFIED_AUTH_STRATEGY.md Section 15.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Tenants table - Organizations/workspaces
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Basic info
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull().unique(),
    type: varchar('type', { length: 20 }).notNull().default('organization'),
    // 'personal' | 'organization'

    // Company details (for organization type)
    industry: varchar('industry', { length: 50 }),
    // 'technology' | 'finance' | 'healthcare' | 'manufacturing' | 'retail' | 'other'
    companySize: varchar('company_size', { length: 20 }),
    // '1-10' | '11-50' | '51-200' | '201-500' | '500+'

    // Compliance requirements
    complianceRequirements: jsonb('compliance_requirements').default([]),
    // ['GDPR', 'HIPAA', 'SOC2', 'PCI-DSS', 'ISO27001']

    // Subscription
    plan: varchar('plan', { length: 20 }).notNull().default('core'),
    // 'core' | 'flow' | 'scale' | 'enterprise'
    billingCycle: varchar('billing_cycle', { length: 10 }).default('monthly'),
    // 'monthly' | 'annual'
    licenseCount: integer('license_count').default(1),
    trialExpiresAt: timestamp('trial_expires_at', { withTimezone: true }),
    subscriptionId: varchar('subscription_id', { length: 100 }),
    subscriptionStatus: varchar('subscription_status', { length: 20 }).default('trialing'),
    // 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'

    // Branding
    logoUrl: text('logo_url'),
    primaryColor: varchar('primary_color', { length: 7 }).default('#6366f1'),

    // Domain settings
    customDomain: varchar('custom_domain', { length: 255 }),
    customDomainVerified: boolean('custom_domain_verified').default(false),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'suspended' | 'deleted'

    // Metadata
    metadata: jsonb('metadata').default({}),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    slugIdx: uniqueIndex('idx_tenants_slug').on(table.slug),
    statusIdx: index('idx_tenants_status').on(table.status),
    planIdx: index('idx_tenants_plan').on(table.plan),
    createdAtIdx: index('idx_tenants_created_at').on(table.createdAt),
  })
);

/**
 * Tenant Security Configuration
 * Per-tenant verification requirements and deadlines (Section 3.2)
 */
export const tenantSecurityConfig = pgTable(
  'tenant_security_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Verification requirements
    requirePhoneVerification: boolean('require_phone_verification').notNull().default(true),
    requireMfa: boolean('require_mfa').notNull().default(true),

    // Grace periods (days from account creation)
    phoneVerificationDeadlineDays: integer('phone_verification_deadline_days').notNull().default(3),
    mfaDeadlineDays: integer('mfa_deadline_days').notNull().default(7),

    // Session settings
    sessionTimeoutMinutes: integer('session_timeout_minutes').default(480), // 8 hours
    maxConcurrentSessions: integer('max_concurrent_sessions').default(5),

    // Password policy
    passwordMinLength: integer('password_min_length').default(12),
    passwordRequireUppercase: boolean('password_require_uppercase').default(true),
    passwordRequireLowercase: boolean('password_require_lowercase').default(true),
    passwordRequireNumbers: boolean('password_require_numbers').default(true),
    passwordRequireSymbols: boolean('password_require_symbols').default(true),
    passwordExpiryDays: integer('password_expiry_days'), // null = no expiry

    // IP restrictions
    ipWhitelist: jsonb('ip_whitelist').default([]),
    // Array of IP addresses/CIDR ranges

    // SSO settings
    ssoEnabled: boolean('sso_enabled').default(false),
    ssoProvider: varchar('sso_provider', { length: 20 }),
    // 'saml' | 'oidc'
    ssoConfig: jsonb('sso_config').default({}),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: uniqueIndex('idx_tenant_security_config_tenant').on(table.tenantId),
  })
);

// Relations
export const tenantsRelations = relations(tenants, ({ one }) => ({
  securityConfig: one(tenantSecurityConfig, {
    fields: [tenants.id],
    references: [tenantSecurityConfig.tenantId],
  }),
}));

export const tenantSecurityConfigRelations = relations(tenantSecurityConfig, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSecurityConfig.tenantId],
    references: [tenants.id],
  }),
}));

// Types
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantSecurityConfig = typeof tenantSecurityConfig.$inferSelect;
export type NewTenantSecurityConfig = typeof tenantSecurityConfig.$inferInsert;
