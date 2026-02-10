/**
 * Groups Database Schema
 *
 * Groups/Teams tables for scoped collaboration within tenants.
 * Enables organizing users into sub-groups with their own role hierarchy
 * and shared resource visibility.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { tenants } from './tenants';

/**
 * Groups table - Teams and departments within a tenant
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Group identification
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    description: text('description'),

    // Group classification
    type: varchar('type', { length: 20 }).notNull().default('team'),
    // 'team' | 'department'
    visibility: varchar('visibility', { length: 20 }).notNull().default('internal'),
    // 'open' | 'internal' | 'private'

    // Appearance
    avatarUrl: text('avatar_url'),
    color: varchar('color', { length: 7 }).notNull().default('#6366f1'),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'archived'
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'set null' }),

    // Metadata
    metadata: jsonb('metadata').notNull().default({}),

    // Audit
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantSlugIdx: uniqueIndex('idx_groups_tenant_slug').on(table.tenantId, table.slug),
    tenantIdx: index('idx_groups_tenant').on(table.tenantId),
    tenantStatusIdx: index('idx_groups_tenant_status').on(table.tenantId, table.status),
    tenantTypeIdx: index('idx_groups_tenant_type').on(table.tenantId, table.type),
    tenantVisibilityIdx: index('idx_groups_tenant_visibility').on(table.tenantId, table.visibility),
  })
);

/**
 * Group Members table - User membership in groups
 */
export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Group role
    role: varchar('role', { length: 20 }).notNull().default('member'),
    // 'owner' | 'admin' | 'member' | 'viewer'

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'removed'

    // Audit
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    removedAt: timestamp('removed_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupUserIdx: uniqueIndex('idx_group_members_group_user').on(table.groupId, table.userId),
    groupIdx: index('idx_group_members_group').on(table.groupId),
    userIdx: index('idx_group_members_user').on(table.userId),
    tenantIdx: index('idx_group_members_tenant').on(table.tenantId),
    tenantUserIdx: index('idx_group_members_tenant_user').on(table.tenantId, table.userId),
    groupStatusIdx: index('idx_group_members_group_status').on(table.groupId, table.status),
    groupRoleIdx: index('idx_group_members_group_role').on(table.groupId, table.role),
  })
);

/**
 * Group Resources table - Polymorphic resource assignment to groups
 */
export const groupResources = pgTable(
  'group_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Polymorphic resource reference
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    // 'server' | 'workflow' | 'ai_agent' | 'volume' etc.
    resourceId: varchar('resource_id', { length: 255 }).notNull(),

    // Audit
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupResourceIdx: uniqueIndex('idx_group_resources_unique').on(
      table.groupId,
      table.resourceType,
      table.resourceId
    ),
    groupIdx: index('idx_group_resources_group').on(table.groupId),
    tenantIdx: index('idx_group_resources_tenant').on(table.tenantId),
    resourceIdx: index('idx_group_resources_resource').on(table.resourceType, table.resourceId),
    tenantResourceIdx: index('idx_group_resources_tenant_resource').on(
      table.tenantId,
      table.resourceType,
      table.resourceId
    ),
  })
);

// Relations
export const groupsRelations = relations(groups, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [groups.tenantId],
    references: [tenants.id],
  }),
  createdByUser: one(users, {
    fields: [groups.createdBy],
    references: [users.id],
  }),
  archivedByUser: one(users, {
    fields: [groups.archivedBy],
    references: [users.id],
  }),
  members: many(groupMembers),
  resources: many(groupResources),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, {
    fields: [groupMembers.groupId],
    references: [groups.id],
  }),
  user: one(users, {
    fields: [groupMembers.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [groupMembers.tenantId],
    references: [tenants.id],
  }),
  addedByUser: one(users, {
    fields: [groupMembers.addedBy],
    references: [users.id],
  }),
  removedByUser: one(users, {
    fields: [groupMembers.removedBy],
    references: [users.id],
  }),
}));

export const groupResourcesRelations = relations(groupResources, ({ one }) => ({
  group: one(groups, {
    fields: [groupResources.groupId],
    references: [groups.id],
  }),
  tenant: one(tenants, {
    fields: [groupResources.tenantId],
    references: [tenants.id],
  }),
  assignedByUser: one(users, {
    fields: [groupResources.assignedBy],
    references: [users.id],
  }),
}));

// Types
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
export type GroupResource = typeof groupResources.$inferSelect;
export type NewGroupResource = typeof groupResources.$inferInsert;
