/**
 * RBAC Database Schema
 *
 * Role-Based Access Control tables for multi-tenant authorization.
 * Per UNIFIED_AUTH_STRATEGY.md Section 9 and rbac_contract.md.
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
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { tenants } from './tenants';

/**
 * Roles table - System and custom roles per tenant
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Role identification
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    description: text('description'),

    // Role hierarchy (1 = highest/Owner, 100 = lowest)
    hierarchyLevel: integer('hierarchy_level').notNull().default(50),

    // Role type flags
    isSystem: boolean('is_system').notNull().default(false),
    isProtected: boolean('is_protected').notNull().default(false),
    // Protected roles cannot be modified or deleted (e.g., Owner)

    // Metadata
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantSlugIdx: uniqueIndex('idx_roles_tenant_slug').on(table.tenantId, table.slug),
    tenantIdx: index('idx_roles_tenant').on(table.tenantId),
    hierarchyIdx: index('idx_roles_hierarchy').on(table.tenantId, table.hierarchyLevel),
    isSystemIdx: index('idx_roles_is_system').on(table.tenantId, table.isSystem),
  })
);

/**
 * Permissions table - All 114 granular permissions
 */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Permission identification
    key: varchar('key', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Category for grouping in UI
    category: varchar('category', { length: 50 }).notNull(),

    // Security flags
    requiresMfa: boolean('requires_mfa').notNull().default(false),
    isCritical: boolean('is_critical').notNull().default(false),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_permissions_key').on(table.key),
    categoryIdx: index('idx_permissions_category').on(table.category),
  })
);

/**
 * Role-Permission mapping table
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Audit info
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rolePermissionIdx: uniqueIndex('idx_role_permissions_unique').on(
      table.roleId,
      table.permissionId
    ),
    roleIdx: index('idx_role_permissions_role').on(table.roleId),
    permissionIdx: index('idx_role_permissions_permission').on(table.permissionId),
    tenantIdx: index('idx_role_permissions_tenant').on(table.tenantId),
  })
);

/**
 * Tenant Members table - Primary role assignment per tenant
 * Each user can have ONE primary role per tenant
 */
export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Primary role (required)
    primaryRoleId: uuid('primary_role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),

    // Owner flag - marks the tenant owner (only one per tenant)
    isOwner: boolean('is_owner').notNull().default(false),

    // Tenant-scoped profile fields (user can have different values per tenant)
    jobTitle: varchar('job_title', { length: 100 }),
    reportingManagerId: uuid('reporting_manager_id').references(() => users.id, { onDelete: 'set null' }),

    // Membership status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'suspended' | 'removed'

    // Invitation tracking
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),

    // Suspension tracking
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: uuid('suspended_by').references(() => users.id, { onDelete: 'set null' }),
    suspensionReason: text('suspension_reason'),

    // Deletion/removal tracking (soft delete with retention)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    deletionReason: text('deletion_reason'),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserIdx: uniqueIndex('idx_tenant_members_tenant_user').on(
      table.tenantId,
      table.userId
    ),
    tenantIdx: index('idx_tenant_members_tenant').on(table.tenantId),
    userIdx: index('idx_tenant_members_user').on(table.userId),
    ownerIdx: index('idx_tenant_members_owner').on(table.tenantId, table.isOwner),
    statusIdx: index('idx_tenant_members_status').on(table.tenantId, table.status),
  })
);

/**
 * Secondary Role Assignments - Optional time-limited additional roles
 * Users can have multiple secondary roles that augment their primary role
 */
export const secondaryRoleAssignments = pgTable(
  'secondary_role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    // Time-limited access
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // null = permanent

    // Reason for assignment
    reason: text('reason'),

    // Assignment status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'expired' | 'revoked'

    // Audit info
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserRoleIdx: uniqueIndex('idx_secondary_roles_unique').on(
      table.tenantId,
      table.userId,
      table.roleId
    ),
    tenantIdx: index('idx_secondary_roles_tenant').on(table.tenantId),
    userIdx: index('idx_secondary_roles_user').on(table.userId),
    roleIdx: index('idx_secondary_roles_role').on(table.roleId),
    expiresIdx: index('idx_secondary_roles_expires').on(table.expiresAt),
    statusIdx: index('idx_secondary_roles_status').on(table.status),
  })
);

// Relations
export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [roles.tenantId],
    references: [tenants.id],
  }),
  createdByUser: one(users, {
    fields: [roles.createdBy],
    references: [users.id],
  }),
  rolePermissions: many(rolePermissions),
  tenantMembers: many(tenantMembers),
  secondaryRoleAssignments: many(secondaryRoleAssignments),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
  tenant: one(tenants, {
    fields: [rolePermissions.tenantId],
    references: [tenants.id],
  }),
  grantedByUser: one(users, {
    fields: [rolePermissions.grantedBy],
    references: [users.id],
  }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tenantMembers.userId],
    references: [users.id],
  }),
  primaryRole: one(roles, {
    fields: [tenantMembers.primaryRoleId],
    references: [roles.id],
  }),
  invitedByUser: one(users, {
    fields: [tenantMembers.invitedBy],
    references: [users.id],
  }),
}));

export const secondaryRoleAssignmentsRelations = relations(secondaryRoleAssignments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [secondaryRoleAssignments.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [secondaryRoleAssignments.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [secondaryRoleAssignments.roleId],
    references: [roles.id],
  }),
  assignedByUser: one(users, {
    fields: [secondaryRoleAssignments.assignedBy],
    references: [users.id],
  }),
  revokedByUser: one(users, {
    fields: [secondaryRoleAssignments.revokedBy],
    references: [users.id],
  }),
}));

/**
 * Tenant Invites table - Pending invitations for users to join a tenant
 * Invites can be for existing users or email addresses (who will sign up)
 */
export const tenantInvites = pgTable(
  'tenant_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Invitee information
    email: varchar('email', { length: 255 }).notNull(),
    // If user already exists in system
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

    // Role to assign upon acceptance
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    // Invite token for accepting via email link
    token: varchar('token', { length: 64 }).notNull(),

    // Invite status
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending' | 'accepted' | 'expired' | 'cancelled'

    // Expiration (default 7 days)
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Tracking
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),

    // Acceptance tracking
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    // Member ID created upon acceptance
    memberId: uuid('member_id').references(() => tenantMembers.id, { onDelete: 'set null' }),

    // Cancellation tracking
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),

    // Resend tracking
    lastResentAt: timestamp('last_resent_at', { withTimezone: true }),
    resendCount: integer('resend_count').notNull().default(0),

    // Optional personal message from inviter
    message: text('message'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmailIdx: uniqueIndex('idx_tenant_invites_tenant_email').on(
      table.tenantId,
      table.email
    ),
    tenantIdx: index('idx_tenant_invites_tenant').on(table.tenantId),
    emailIdx: index('idx_tenant_invites_email').on(table.email),
    tokenIdx: uniqueIndex('idx_tenant_invites_token').on(table.token),
    statusIdx: index('idx_tenant_invites_status').on(table.tenantId, table.status),
    expiresIdx: index('idx_tenant_invites_expires').on(table.expiresAt),
  })
);

// Tenant Invites Relations
export const tenantInvitesRelations = relations(tenantInvites, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantInvites.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tenantInvites.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [tenantInvites.roleId],
    references: [roles.id],
  }),
  invitedByUser: one(users, {
    fields: [tenantInvites.invitedBy],
    references: [users.id],
  }),
  cancelledByUser: one(users, {
    fields: [tenantInvites.cancelledBy],
    references: [users.id],
  }),
  member: one(tenantMembers, {
    fields: [tenantInvites.memberId],
    references: [tenantMembers.id],
  }),
}));

// Types
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
export type SecondaryRoleAssignment = typeof secondaryRoleAssignments.$inferSelect;
export type NewSecondaryRoleAssignment = typeof secondaryRoleAssignments.$inferInsert;
export type TenantInvite = typeof tenantInvites.$inferSelect;
export type NewTenantInvite = typeof tenantInvites.$inferInsert;
