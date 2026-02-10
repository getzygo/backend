/**
 * Group Service
 *
 * Handles group CRUD, membership management, resource assignment,
 * and visibility filtering for the Groups/Teams feature.
 */

import { eq, and, count, sql, desc, ilike, inArray, or, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getRedis, REDIS_KEYS } from '../db/redis';
import {
  groups,
  groupMembers,
  groupResources,
  tenantMembers,
  users,
  type Group,
  type NewGroup,
  type GroupMember,
  type NewGroupMember,
  type GroupResource,
  type NewGroupResource,
} from '../db/schema';
import { createAuditLog, AUDIT_ACTIONS } from './audit.service';
import { logger } from '../utils/logger';

// ============================================================================
// Constants
// ============================================================================

const GROUP_CACHE_PREFIX = 'group_membership:';
const GROUP_CACHE_TTL = 5 * 60; // 5 minutes

const GROUP_ROLE_HIERARCHY: Record<string, number> = {
  owner: 1,
  admin: 2,
  member: 3,
  viewer: 4,
};

const PLAN_GROUP_LIMITS: Record<string, number> = {
  core: 0,
  flow: 5,
  scale: 20,
  enterprise: -1, // unlimited
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

function getGroupCacheKey(userId: string, tenantId: string): string {
  return `${GROUP_CACHE_PREFIX}${userId}:${tenantId}`;
}

async function invalidateGroupMembershipCache(userId: string, tenantId: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(getGroupCacheKey(userId, tenantId));
  } catch (error) {
    logger.error('Failed to invalidate group membership cache:', error);
  }
}

// ============================================================================
// Group CRUD
// ============================================================================

export async function getGroupsByTenant(params: {
  tenantId: string;
  userId: string;
  isAdminOrOwner: boolean;
  filter?: 'all' | 'my' | 'archived';
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<{ groups: any[]; total: number }> {
  const db = getDb();
  const { tenantId, userId, isAdminOrOwner, filter = 'all', search, page = 1, perPage = 20 } = params;
  const offset = (page - 1) * perPage;

  const conditions: any[] = [eq(groups.tenantId, tenantId)];

  if (filter === 'archived') {
    conditions.push(eq(groups.status, 'archived'));
  } else {
    conditions.push(eq(groups.status, 'active'));
  }

  if (search) {
    conditions.push(
      or(
        ilike(groups.name, `%${search}%`),
        ilike(groups.slug, `%${search}%`)
      )
    );
  }

  // For non-admin users, filter by visibility and membership
  if (!isAdminOrOwner && filter !== 'my') {
    // Exclude private groups where user is not a member
    const userGroupIds = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupMembers.tenantId, tenantId),
          eq(groupMembers.status, 'active')
        )
      );
    const memberGroupIds = userGroupIds.map((g) => g.groupId);

    if (memberGroupIds.length > 0) {
      conditions.push(
        or(
          ne(groups.visibility, 'private'),
          inArray(groups.id, memberGroupIds)
        )
      );
    } else {
      conditions.push(ne(groups.visibility, 'private'));
    }
  }

  if (filter === 'my') {
    const userGroupIds = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupMembers.tenantId, tenantId),
          eq(groupMembers.status, 'active')
        )
      );
    const memberGroupIds = userGroupIds.map((g) => g.groupId);
    if (memberGroupIds.length === 0) {
      return { groups: [], total: 0 };
    }
    conditions.push(inArray(groups.id, memberGroupIds));
  }

  const whereClause = and(...conditions);

  const [groupList, totalResult] = await Promise.all([
    db
      .select()
      .from(groups)
      .where(whereClause)
      .orderBy(desc(groups.createdAt))
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: count() })
      .from(groups)
      .where(whereClause),
  ]);

  const total = Number(totalResult[0]?.count || 0);

  // Enrich with member counts and user's role
  const enrichedGroups = await Promise.all(
    groupList.map(async (group) => {
      const [memberCount, resourceCount, userMembership] = await Promise.all([
        db
          .select({ count: count() })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, 'active'))),
        db
          .select({ count: count() })
          .from(groupResources)
          .where(eq(groupResources.groupId, group.id)),
        db
          .select({ role: groupMembers.role })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, group.id),
              eq(groupMembers.userId, userId),
              eq(groupMembers.status, 'active')
            )
          ),
      ]);

      return {
        ...group,
        memberCount: Number(memberCount[0]?.count || 0),
        resourceCount: Number(resourceCount[0]?.count || 0),
        userRole: userMembership[0]?.role || null,
      };
    })
  );

  return { groups: enrichedGroups, total };
}

export async function getGroupById(groupId: string, tenantId: string): Promise<Group | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
  return result[0] || null;
}

export async function createGroup(params: {
  tenantId: string;
  name: string;
  description?: string;
  type?: string;
  visibility?: string;
  color?: string;
  createdBy: string;
}): Promise<{ success: boolean; group?: Group; error?: string }> {
  const db = getDb();
  const { tenantId, name, description, type = 'team', visibility = 'internal', color = '#6366f1', createdBy } = params;

  const slug = generateSlug(name);

  // Check for slug uniqueness
  const existing = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.tenantId, tenantId), eq(groups.slug, slug)));

  if (existing.length > 0) {
    return { success: false, error: 'A group with this name already exists' };
  }

  const [group] = await db
    .insert(groups)
    .values({
      tenantId,
      name,
      slug,
      description,
      type,
      visibility,
      color,
      createdBy,
    })
    .returning();

  // Add creator as group owner
  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: createdBy,
    tenantId,
    role: 'owner',
    addedBy: createdBy,
  });

  await invalidateGroupMembershipCache(createdBy, tenantId);

  await createAuditLog({
    userId: createdBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_CREATED,
    resourceType: 'group',
    resourceId: group.id,
    details: { name, slug, type, visibility },
    status: 'success',
  });

  return { success: true, group };
}

export async function updateGroup(params: {
  groupId: string;
  tenantId: string;
  updates: Partial<Pick<Group, 'name' | 'description' | 'type' | 'visibility' | 'color' | 'avatarUrl'>>;
  updatedBy: string;
}): Promise<{ success: boolean; group?: Group; error?: string }> {
  const db = getDb();
  const { groupId, tenantId, updates, updatedBy } = params;

  const existing = await getGroupById(groupId, tenantId);
  if (!existing) {
    return { success: false, error: 'Group not found' };
  }

  const updateData: any = { ...updates, updatedAt: new Date() };

  // Regenerate slug if name changed
  if (updates.name && updates.name !== existing.name) {
    const newSlug = generateSlug(updates.name);
    const slugConflict = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.slug, newSlug), ne(groups.id, groupId)));
    if (slugConflict.length > 0) {
      return { success: false, error: 'A group with this name already exists' };
    }
    updateData.slug = newSlug;
  }

  const [group] = await db
    .update(groups)
    .set(updateData)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)))
    .returning();

  await createAuditLog({
    userId: updatedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_UPDATED,
    resourceType: 'group',
    resourceId: groupId,
    details: { updates },
    status: 'success',
  });

  return { success: true, group };
}

export async function archiveGroup(params: {
  groupId: string;
  tenantId: string;
  archivedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const { groupId, tenantId, archivedBy } = params;

  const existing = await getGroupById(groupId, tenantId);
  if (!existing) {
    return { success: false, error: 'Group not found' };
  }
  if (existing.status === 'archived') {
    return { success: false, error: 'Group is already archived' };
  }

  await db
    .update(groups)
    .set({ status: 'archived', archivedAt: new Date(), archivedBy, updatedAt: new Date() })
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));

  await createAuditLog({
    userId: archivedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_ARCHIVED,
    resourceType: 'group',
    resourceId: groupId,
    details: { name: existing.name },
    status: 'success',
  });

  return { success: true };
}

export async function deleteGroup(params: {
  groupId: string;
  tenantId: string;
  deletedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const { groupId, tenantId, deletedBy } = params;

  const existing = await getGroupById(groupId, tenantId);
  if (!existing) {
    return { success: false, error: 'Group not found' };
  }

  // Get all members to invalidate their caches
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));

  await db
    .delete(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));

  // Invalidate cache for all members
  await Promise.all(
    members.map((m) => invalidateGroupMembershipCache(m.userId, tenantId))
  );

  await createAuditLog({
    userId: deletedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_DELETED,
    resourceType: 'group',
    resourceId: groupId,
    details: { name: existing.name },
    status: 'success',
  });

  return { success: true };
}

// ============================================================================
// Membership
// ============================================================================

export async function getGroupMembers(params: {
  groupId: string;
  tenantId: string;
  page?: number;
  perPage?: number;
}): Promise<{ members: any[]; total: number }> {
  const db = getDb();
  const { groupId, tenantId, page = 1, perPage = 50 } = params;
  const offset = (page - 1) * perPage;

  const whereClause = and(
    eq(groupMembers.groupId, groupId),
    eq(groupMembers.tenantId, tenantId),
    eq(groupMembers.status, 'active')
  );

  const [memberList, totalResult] = await Promise.all([
    db
      .select({
        id: groupMembers.id,
        groupId: groupMembers.groupId,
        userId: groupMembers.userId,
        role: groupMembers.role,
        status: groupMembers.status,
        createdAt: groupMembers.createdAt,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userDisplayName: users.displayName,
        userEmail: users.email,
        userAvatarUrl: users.avatarUrl,
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(whereClause)
      .orderBy(groupMembers.createdAt)
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: count() })
      .from(groupMembers)
      .where(whereClause),
  ]);

  const formattedMembers = memberList.map((m) => ({
    user_id: m.userId,
    name: m.userDisplayName || [m.userFirstName, m.userLastName].filter(Boolean).join(' ') || m.userEmail,
    email: m.userEmail,
    avatar_url: m.userAvatarUrl,
    role: m.role,
    joined_at: m.createdAt,
  }));

  return {
    members: formattedMembers,
    total: Number(totalResult[0]?.count || 0),
  };
}

export async function addGroupMember(params: {
  groupId: string;
  userId: string;
  tenantId: string;
  role?: string;
  addedBy: string;
}): Promise<{ success: boolean; member?: GroupMember; error?: string }> {
  const db = getDb();
  const { groupId, userId, tenantId, role = 'member', addedBy } = params;

  // Verify user is a tenant member
  const tenantMember = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.status, 'active')
      )
    );
  if (tenantMember.length === 0) {
    return { success: false, error: 'User is not a member of this tenant' };
  }

  // Check if already a member
  const existing = await db
    .select({ id: groupMembers.id, status: groupMembers.status })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));

  if (existing.length > 0) {
    if (existing[0].status === 'active') {
      return { success: false, error: 'User is already a member of this group' };
    }
    // Re-activate removed member
    const [member] = await db
      .update(groupMembers)
      .set({ status: 'active', role, addedBy, removedBy: null, removedAt: null, updatedAt: new Date() })
      .where(eq(groupMembers.id, existing[0].id))
      .returning();

    await invalidateGroupMembershipCache(userId, tenantId);
    return { success: true, member };
  }

  const [member] = await db
    .insert(groupMembers)
    .values({ groupId, userId, tenantId, role, addedBy })
    .returning();

  await invalidateGroupMembershipCache(userId, tenantId);

  await createAuditLog({
    userId: addedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_MEMBER_ADDED,
    resourceType: 'group_member',
    resourceId: member.id,
    details: { groupId, userId, role },
    status: 'success',
  });

  return { success: true, member };
}

export async function updateGroupMemberRole(params: {
  groupId: string;
  userId: string;
  tenantId: string;
  newRole: string;
  updatedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const { groupId, userId, tenantId, newRole, updatedBy } = params;

  const existing = await db
    .select({ id: groupMembers.id, role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, 'active')
      )
    );

  if (existing.length === 0) {
    return { success: false, error: 'Member not found in group' };
  }

  // Prevent demoting the last admin/owner — group must always have at least 1 admin
  const isCurrentlyAdminOrOwner = existing[0].role === 'owner' || existing[0].role === 'admin';
  const isNewRoleLower = newRole !== 'owner' && newRole !== 'admin';
  if (isCurrentlyAdminOrOwner && isNewRoleLower) {
    const adminOwnerCount = await db
      .select({ count: count() })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          sql`${groupMembers.role} IN ('owner', 'admin')`,
          eq(groupMembers.status, 'active')
        )
      );
    if (Number(adminOwnerCount[0]?.count || 0) <= 1) {
      return { success: false, error: 'Group must have at least one admin. Promote another member first.' };
    }
  }

  await db
    .update(groupMembers)
    .set({ role: newRole, updatedAt: new Date() })
    .where(eq(groupMembers.id, existing[0].id));

  await invalidateGroupMembershipCache(userId, tenantId);

  await createAuditLog({
    userId: updatedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_MEMBER_ROLE_UPDATED,
    resourceType: 'group_member',
    resourceId: existing[0].id,
    details: { groupId, userId, oldRole: existing[0].role, newRole },
    status: 'success',
  });

  return { success: true };
}

export async function removeGroupMember(params: {
  groupId: string;
  userId: string;
  tenantId: string;
  removedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const { groupId, userId, tenantId, removedBy } = params;

  const existing = await db
    .select({ id: groupMembers.id, role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, 'active')
      )
    );

  if (existing.length === 0) {
    return { success: false, error: 'Member not found in group' };
  }

  // Prevent removing if it would leave 0 admins/owners — group must always have at least 1 admin
  if (existing[0].role === 'owner' || existing[0].role === 'admin') {
    const adminOwnerCount = await db
      .select({ count: count() })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          sql`${groupMembers.role} IN ('owner', 'admin')`,
          eq(groupMembers.status, 'active')
        )
      );
    if (Number(adminOwnerCount[0]?.count || 0) <= 1) {
      return { success: false, error: 'Group must have at least one admin. Promote another member before leaving.' };
    }
  }

  await db
    .update(groupMembers)
    .set({ status: 'removed', removedBy, removedAt: new Date(), updatedAt: new Date() })
    .where(eq(groupMembers.id, existing[0].id));

  await invalidateGroupMembershipCache(userId, tenantId);

  await createAuditLog({
    userId: removedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_MEMBER_REMOVED,
    resourceType: 'group_member',
    resourceId: existing[0].id,
    details: { groupId, userId },
    status: 'success',
  });

  return { success: true };
}

export async function getUserGroups(userId: string, tenantId: string): Promise<any[]> {
  const db = getDb();

  const result = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
      groupName: groups.name,
      groupSlug: groups.slug,
      groupType: groups.type,
      groupColor: groups.color,
      groupStatus: groups.status,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.status, 'active'),
        eq(groups.status, 'active')
      )
    );

  return result;
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, 'active')
      )
    );
  return result.length > 0;
}

export async function getGroupMemberRole(groupId: string, userId: string): Promise<string | null> {
  const db = getDb();
  const result = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, 'active')
      )
    );
  return result[0]?.role || null;
}

// ============================================================================
// Resources
// ============================================================================

export async function getGroupResources(params: {
  groupId: string;
  tenantId: string;
  resourceType?: string;
  page?: number;
  perPage?: number;
}): Promise<{ resources: GroupResource[]; total: number }> {
  const db = getDb();
  const { groupId, tenantId, resourceType, page = 1, perPage = 50 } = params;
  const offset = (page - 1) * perPage;

  const conditions: any[] = [eq(groupResources.groupId, groupId), eq(groupResources.tenantId, tenantId)];
  if (resourceType) {
    conditions.push(eq(groupResources.resourceType, resourceType));
  }

  const whereClause = and(...conditions);

  const [resourceList, totalResult] = await Promise.all([
    db
      .select()
      .from(groupResources)
      .where(whereClause)
      .orderBy(desc(groupResources.createdAt))
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: count() })
      .from(groupResources)
      .where(whereClause),
  ]);

  return {
    resources: resourceList,
    total: Number(totalResult[0]?.count || 0),
  };
}

export async function assignResourceToGroup(params: {
  groupId: string;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  assignedBy: string;
}): Promise<{ success: boolean; resource?: GroupResource; error?: string }> {
  const db = getDb();
  const { groupId, tenantId, resourceType, resourceId, assignedBy } = params;

  // Check if already assigned
  const existing = await db
    .select({ id: groupResources.id })
    .from(groupResources)
    .where(
      and(
        eq(groupResources.groupId, groupId),
        eq(groupResources.resourceType, resourceType),
        eq(groupResources.resourceId, resourceId)
      )
    );

  if (existing.length > 0) {
    return { success: false, error: 'Resource is already assigned to this group' };
  }

  const [resource] = await db
    .insert(groupResources)
    .values({ groupId, tenantId, resourceType, resourceId, assignedBy })
    .returning();

  await createAuditLog({
    userId: assignedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_RESOURCE_ASSIGNED,
    resourceType: 'group_resource',
    resourceId: resource.id,
    details: { groupId, resourceType, resourceId },
    status: 'success',
  });

  return { success: true, resource };
}

export async function removeResourceFromGroup(params: {
  groupId: string;
  resourceId: string;
  tenantId: string;
  removedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const { groupId, resourceId, tenantId, removedBy } = params;

  const existing = await db
    .select({ id: groupResources.id, resourceType: groupResources.resourceType })
    .from(groupResources)
    .where(
      and(
        eq(groupResources.id, resourceId),
        eq(groupResources.groupId, groupId),
        eq(groupResources.tenantId, tenantId)
      )
    );

  if (existing.length === 0) {
    return { success: false, error: 'Resource assignment not found' };
  }

  await db
    .delete(groupResources)
    .where(eq(groupResources.id, resourceId));

  await createAuditLog({
    userId: removedBy,
    tenantId,
    action: AUDIT_ACTIONS.GROUP_RESOURCE_REMOVED,
    resourceType: 'group_resource',
    resourceId,
    details: { groupId, resourceType: existing[0].resourceType },
    status: 'success',
  });

  return { success: true };
}

// ============================================================================
// Visibility
// ============================================================================

export async function getVisibleResourceIds(params: {
  userId: string;
  tenantId: string;
  resourceType: string;
  isAdminOrOwner: boolean;
}): Promise<{ ids: string[] | null; unrestricted: boolean }> {
  const { userId, tenantId, resourceType, isAdminOrOwner } = params;

  // Admins/owners see everything
  if (isAdminOrOwner) {
    return { ids: null, unrestricted: true };
  }

  const db = getDb();

  // Get user's group IDs
  const userGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.status, 'active')
      )
    );

  const groupIds = userGroups.map((g) => g.groupId);

  if (groupIds.length === 0) {
    return { ids: [], unrestricted: false };
  }

  // Get resource IDs from user's groups
  const resources = await db
    .select({ resourceId: groupResources.resourceId })
    .from(groupResources)
    .where(
      and(
        inArray(groupResources.groupId, groupIds),
        eq(groupResources.resourceType, resourceType),
        eq(groupResources.tenantId, tenantId)
      )
    );

  return {
    ids: resources.map((r) => r.resourceId),
    unrestricted: false,
  };
}

// ============================================================================
// Export
// ============================================================================

export const groupService = {
  getGroupsByTenant,
  getGroupById,
  createGroup,
  updateGroup,
  archiveGroup,
  deleteGroup,
  getGroupMembers,
  addGroupMember,
  updateGroupMemberRole,
  removeGroupMember,
  getUserGroups,
  isGroupMember,
  getGroupMemberRole,
  getGroupResources,
  assignResourceToGroup,
  removeResourceFromGroup,
  getVisibleResourceIds,
};
