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

    // Billing Information (required for paid subscriptions)
    billingEmail: varchar('billing_email', { length: 255 }),
    billingAddress: varchar('billing_address', { length: 255 }),
    billingCity: varchar('billing_city', { length: 100 }),
    billingState: varchar('billing_state', { length: 100 }),
    billingPostalCode: varchar('billing_postal_code', { length: 20 }),
    billingCountry: varchar('billing_country', { length: 2 }), // ISO 3166-1 alpha-2

    // Company Tax Information (required for paid subscriptions)
    companyLegalName: varchar('company_legal_name', { length: 200 }),
    taxId: varchar('tax_id', { length: 50 }), // VAT ID, Tax ID, EIN, etc.

    // Company Address (General Tab)
    website: varchar('website', { length: 255 }),
    phone: varchar('phone', { length: 30 }),
    phoneCountryCode: varchar('phone_country_code', { length: 5 }),
    addressLine1: varchar('address_line1', { length: 255 }),
    addressLine2: varchar('address_line2', { length: 255 }),
    city: varchar('city', { length: 100 }),
    stateProvince: varchar('state_province', { length: 100 }),
    stateCode: varchar('state_code', { length: 10 }),
    postalCode: varchar('postal_code', { length: 20 }),
    country: varchar('country', { length: 2 }), // ISO 3166-1 alpha-2

    // Legal & Tax (Legal Tab)
    businessType: varchar('business_type', { length: 30 }),
    // 'sole_proprietor' | 'partnership' | 'llc' | 'corporation' | 's_corp' | 'nonprofit' | 'other'
    incorporationDate: timestamp('incorporation_date', { withTimezone: true }),
    countryOfIncorporation: varchar('country_of_incorporation', { length: 2 }),
    registrationNumber: varchar('registration_number', { length: 50 }),
    vatNumber: varchar('vat_number', { length: 30 }),
    vatVerified: boolean('vat_verified').default(false),
    taxIdVerified: boolean('tax_id_verified').default(false),

    // Billing Address (Billing Tab) - additional fields
    useDifferentBillingAddress: boolean('use_different_billing_address').default(false),
    billingAddressLine2: varchar('billing_address_line2', { length: 255 }),
    billingPhone: varchar('billing_phone', { length: 30 }),
    billingPhoneCountryCode: varchar('billing_phone_country_code', { length: 5 }),

    // Verification status for contact fields
    billingEmailVerified: boolean('billing_email_verified').default(false),
    billingEmailVerifiedAt: timestamp('billing_email_verified_at', { withTimezone: true }),
    billingPhoneVerified: boolean('billing_phone_verified').default(false),
    billingPhoneVerifiedAt: timestamp('billing_phone_verified_at', { withTimezone: true }),
    phoneVerified: boolean('phone_verified').default(false),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),

    // Branding
    logoUrl: text('logo_url'),
    primaryColor: varchar('primary_color', { length: 7 }).default('#6366f1'),

    // Domain settings
    customDomain: varchar('custom_domain', { length: 255 }),
    customDomainVerified: boolean('custom_domain_verified').default(false),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'suspended' | 'pending_deletion' | 'deleted'

    // Deletion tracking
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    deletionScheduledAt: timestamp('deletion_scheduled_at', { withTimezone: true }),
    deletionCancelableUntil: timestamp('deletion_cancelable_until', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deletionReason: text('deletion_reason'),

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

    // Idle lock & PIN policy
    idleLockEnabled: boolean('idle_lock_enabled').notNull().default(false),
    idleLockTimeoutMinutes: integer('idle_lock_timeout_minutes').notNull().default(15),
    pinLengthRequirement: integer('pin_length_requirement').notNull().default(4), // 4 or 6
    requirePin: boolean('require_pin').notNull().default(false),
    pinDeadlineDays: integer('pin_deadline_days').notNull().default(7),
    pinMaxAttempts: integer('pin_max_attempts').notNull().default(5),

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

/**
 * Tenant Contacts
 * Contact information for different roles (primary, billing, technical, etc.)
 */
export const tenantContacts = pgTable(
  'tenant_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 30 }).notNull(),
    // 'primary' | 'technical-support' | 'financial' | 'marketing' | 'sales' | 'legal' | 'hr' | 'operations' | 'customer-success'
    name: varchar('name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 30 }),
    phoneCountryCode: varchar('phone_country_code', { length: 5 }),
    // Verification status for contact fields
    emailVerified: boolean('email_verified').default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerified: boolean('phone_verified').default(false),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_tenant_contacts_tenant').on(table.tenantId),
    tenantTypeIdx: uniqueIndex('idx_tenant_contacts_tenant_type').on(table.tenantId, table.type),
  })
);

/**
 * Tenant Archives
 * Encrypted archives of deleted tenant data for legal retention (7 years)
 * Per DATA_PROTECTION.md compliance requirements
 */
export const tenantArchives = pgTable(
  'tenant_archives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(), // Original tenant ID (no FK - tenant may be deleted)
    tenantName: varchar('tenant_name', { length: 100 }).notNull(),
    tenantSlug: varchar('tenant_slug', { length: 50 }).notNull(),

    // Archive details
    archivePath: text('archive_path').notNull(), // S3/storage path
    archiveSizeBytes: integer('archive_size_bytes'),
    encryptionKeyId: varchar('encryption_key_id', { length: 100 }), // KMS key reference
    checksumSha256: varchar('checksum_sha256', { length: 64 }),

    // What's included in archive
    archivedData: jsonb('archived_data').default({}),
    // { users: count, workflows: count, servers: count, ... }

    // Deletion details
    deletedBy: uuid('deleted_by'), // User who initiated deletion
    deletionReason: text('deletion_reason'),

    // Legal hold - prevents automatic purge
    legalHold: boolean('legal_hold').default(false),
    legalHoldReason: text('legal_hold_reason'),
    legalHoldBy: uuid('legal_hold_by'),
    legalHoldAt: timestamp('legal_hold_at', { withTimezone: true }),
    legalHoldUntil: timestamp('legal_hold_until', { withTimezone: true }),

    // Retention
    archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true }),

    // Audit
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_tenant_archives_tenant').on(table.tenantId),
    retentionIdx: index('idx_tenant_archives_retention').on(table.retentionExpiresAt),
    legalHoldIdx: index('idx_tenant_archives_legal_hold').on(table.legalHold),
  })
);

// Relations
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  securityConfig: one(tenantSecurityConfig, {
    fields: [tenants.id],
    references: [tenantSecurityConfig.tenantId],
  }),
  contacts: many(tenantContacts),
}));

export const tenantSecurityConfigRelations = relations(tenantSecurityConfig, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSecurityConfig.tenantId],
    references: [tenants.id],
  }),
}));

export const tenantContactsRelations = relations(tenantContacts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantContacts.tenantId],
    references: [tenants.id],
  }),
}));

// Types
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantSecurityConfig = typeof tenantSecurityConfig.$inferSelect;
export type NewTenantSecurityConfig = typeof tenantSecurityConfig.$inferInsert;
export type TenantContact = typeof tenantContacts.$inferSelect;
export type NewTenantContact = typeof tenantContacts.$inferInsert;
export type TenantArchive = typeof tenantArchives.$inferSelect;
export type NewTenantArchive = typeof tenantArchives.$inferInsert;
