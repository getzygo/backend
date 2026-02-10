/**
 * Member Service
 *
 * Handles tenant member management with plan limit enforcement.
 * Core plan: 1 user only (owner)
 * Flow plan: up to 50 users
 * Scale plan: up to 200 users
 * Enterprise plan: unlimited users
 */

import { eq, and, count, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  tenantMembers,
  tenants,
  users,
  roles,
  type TenantMember,
  type NewTenantMember,
  type User,
  type Tenant,
  type Role,
} from '../db/schema';

// Plan user limits
const PLAN_USER_LIMITS: Record<string, number> = {
  core: 1,        // Single user (owner only)
  flow: 50,       // Up to 50 users
  scale: 200,     // Up to 200 users
  enterprise: -1, // Unlimited (-1 = no limit)
};

/**
 * Get the maximum number of users allowed for a plan
 */
export function getPlanUserLimit(plan: string): number {
  return PLAN_USER_LIMITS[plan] ?? PLAN_USER_LIMITS.core;
}

/**
 * Count active members in a tenant
 */
export async function countTenantMembers(tenantId: string): Promise<number> {
  const db = getDb();

  const result = await db
    .select({ count: count() })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.status, 'active')
      )
    );

  return result[0]?.count ?? 0;
}

/**
 * Check if a tenant can add more members based on plan limits
 */
export async function canAddMember(tenantId: string): Promise<{
  allowed: boolean;
  reason?: string;
  currentCount: number;
  limit: number;
  plan: string;
}> {
  const db = getDb();

  // Get tenant with plan info
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { plan: true, licenseCount: true },
  });

  if (!tenant) {
    return {
      allowed: false,
      reason: 'Tenant not found',
      currentCount: 0,
      limit: 0,
      plan: 'unknown',
    };
  }

  const currentCount = await countTenantMembers(tenantId);
  const baseLimit = getPlanUserLimit(tenant.plan);

  // For paid plans, use licenseCount if it's higher than base limit
  const limit = baseLimit === -1
    ? -1
    : Math.max(baseLimit, tenant.licenseCount ?? baseLimit);

  // Core plan: strictly 1 user (owner only)
  if (tenant.plan === 'core') {
    return {
      allowed: false,
      reason: 'Core plan allows only 1 user (owner). Please upgrade to Flow or higher to invite team members.',
      currentCount,
      limit: 1,
      plan: tenant.plan,
    };
  }

  // Unlimited plan
  if (limit === -1) {
    return {
      allowed: true,
      currentCount,
      limit: -1,
      plan: tenant.plan,
    };
  }

  // Check limit
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `You have reached the maximum of ${limit} users for your ${tenant.plan} plan. Please upgrade or purchase more licenses.`,
      currentCount,
      limit,
      plan: tenant.plan,
    };
  }

  return {
    allowed: true,
    currentCount,
    limit,
    plan: tenant.plan,
  };
}

/**
 * Get all members of a tenant with their roles
 * @param tenantId - The tenant ID
 * @param statusFilter - Status filter: 'active' (default), 'suspended', 'all' (no filter)
 */
export async function getTenantMembers(
  tenantId: string,
  statusFilter: 'active' | 'suspended' | 'all' = 'active',
  pagination?: { page: number; perPage: number }
): Promise<{ members: (TenantMember & { user: User; role: Role })[]; total: number }> {
  const db = getDb();

  // Build where conditions
  const conditions = [eq(tenantMembers.tenantId, tenantId)];

  // Filter by status unless 'all' is requested
  // Note: 'removed' members are fetched via getDeletedTenantMembers
  if (statusFilter !== 'all') {
    conditions.push(eq(tenantMembers.status, statusFilter));
  } else {
    // 'all' excludes 'removed' - those are fetched separately
    conditions.push(sql`${tenantMembers.status} != 'removed'`);
  }

  // Get total count
  const countResult = await db
    .select({ count: count() })
    .from(tenantMembers)
    .where(and(...conditions));
  const total = countResult[0]?.count ?? 0;

  const members = await db.query.tenantMembers.findMany({
    where: and(...conditions),
    with: {
      user: true,
      primaryRole: true,
    },
    orderBy: [tenantMembers.isOwner, tenantMembers.joinedAt],
    ...(pagination && {
      limit: pagination.perPage,
      offset: (pagination.page - 1) * pagination.perPage,
    }),
  });

  return {
    members: members.map((m) => ({
      ...m,
      user: m.user as User,
      role: m.primaryRole as Role,
    })),
    total,
  };
}

/**
 * Get a specific member by ID
 */
export async function getMemberById(
  tenantId: string,
  memberId: string
): Promise<(TenantMember & { user: User; role: Role }) | null> {
  const db = getDb();

  const member = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.id, memberId),
      eq(tenantMembers.tenantId, tenantId)
    ),
    with: {
      user: true,
      primaryRole: true,
    },
  });

  if (!member) return null;

  return {
    ...member,
    user: member.user as User,
    role: member.primaryRole as Role,
  };
}

/**
 * Get member by user ID
 */
export async function getMemberByUserId(
  tenantId: string,
  userId: string
): Promise<TenantMember | null> {
  const db = getDb();

  const member = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId)
    ),
  });

  return member || null;
}

/**
 * Invite a new member to a tenant
 * Enforces plan limits before adding
 */
export async function inviteMember(params: {
  tenantId: string;
  email: string;
  roleId: string;
  invitedBy: string;
}): Promise<{
  success: boolean;
  error?: string;
  member?: TenantMember;
  user?: User;
}> {
  const { tenantId, email, roleId, invitedBy } = params;
  const db = getDb();

  // Check if we can add more members
  const canAdd = await canAddMember(tenantId);
  if (!canAdd.allowed) {
    return {
      success: false,
      error: canAdd.reason,
    };
  }

  // Find or check if user exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase().trim()),
  });

  if (!existingUser) {
    // User doesn't exist - they need to sign up first
    // In a full implementation, we'd create an invitation record
    // and send an email with signup + invitation link
    return {
      success: false,
      error: 'User not found. They must create a Zygo account first before being invited.',
    };
  }

  // Check if user is already a member
  const existingMembership = await getMemberByUserId(tenantId, existingUser.id);
  if (existingMembership) {
    if (existingMembership.status === 'active') {
      return {
        success: false,
        error: 'User is already a member of this workspace.',
      };
    }
    // Reactivate if previously removed
    if (existingMembership.status === 'removed') {
      const [updated] = await db
        .update(tenantMembers)
        .set({
          status: 'active',
          primaryRoleId: roleId,
          invitedBy,
          invitedAt: new Date(),
          joinedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tenantMembers.id, existingMembership.id))
        .returning();

      return {
        success: true,
        member: updated,
        user: existingUser,
      };
    }
  }

  // Verify the role exists and belongs to this tenant
  const role = await db.query.roles.findFirst({
    where: and(
      eq(roles.id, roleId),
      eq(roles.tenantId, tenantId)
    ),
  });

  if (!role) {
    return {
      success: false,
      error: 'Invalid role for this workspace.',
    };
  }

  // Prevent assigning Owner role (only one owner per tenant)
  if (role.slug === 'owner') {
    return {
      success: false,
      error: 'Cannot assign Owner role to invited members.',
    };
  }

  // Create membership
  const [member] = await db
    .insert(tenantMembers)
    .values({
      tenantId,
      userId: existingUser.id,
      primaryRoleId: roleId,
      isOwner: false,
      status: 'active',
      invitedBy,
      invitedAt: new Date(),
      joinedAt: new Date(),
    })
    .returning();

  return {
    success: true,
    member,
    user: existingUser,
  };
}

/**
 * Update a member's role
 */
export async function updateMemberRole(params: {
  tenantId: string;
  memberId: string;
  newRoleId: string;
  updatedBy: string;
}): Promise<{
  success: boolean;
  error?: string;
  member?: TenantMember;
}> {
  const { tenantId, memberId, newRoleId, updatedBy } = params;
  const db = getDb();

  // Get the member
  const member = await getMemberById(tenantId, memberId);
  if (!member) {
    return {
      success: false,
      error: 'Member not found.',
    };
  }

  // Cannot change owner's role
  if (member.isOwner) {
    return {
      success: false,
      error: 'Cannot change the role of the workspace owner.',
    };
  }

  // Verify the new role exists and belongs to this tenant
  const role = await db.query.roles.findFirst({
    where: and(
      eq(roles.id, newRoleId),
      eq(roles.tenantId, tenantId)
    ),
  });

  if (!role) {
    return {
      success: false,
      error: 'Invalid role for this workspace.',
    };
  }

  // Prevent assigning Owner role
  if (role.slug === 'owner') {
    return {
      success: false,
      error: 'Cannot assign Owner role.',
    };
  }

  // Update the role
  const [updated] = await db
    .update(tenantMembers)
    .set({
      primaryRoleId: newRoleId,
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, memberId))
    .returning();

  return {
    success: true,
    member: updated,
  };
}

/**
 * Remove a member from a tenant
 */
export async function removeMember(params: {
  tenantId: string;
  memberId: string;
  removedBy: string;
  reason?: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  const { tenantId, memberId, removedBy, reason } = params;
  const db = getDb();

  // Get the member
  const member = await getMemberById(tenantId, memberId);
  if (!member) {
    return {
      success: false,
      error: 'Member not found.',
    };
  }

  // Cannot remove the owner
  if (member.isOwner) {
    return {
      success: false,
      error: 'Cannot remove the workspace owner. Transfer ownership first.',
    };
  }

  // Soft-delete: set status to 'removed' with retention period (30 days)
  const retentionDays = 30;
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays);

  await db
    .update(tenantMembers)
    .set({
      status: 'removed',
      deletedAt: new Date(),
      deletedBy: removedBy,
      deletionReason: reason,
      retentionExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, memberId));

  return {
    success: true,
  };
}

/**
 * Get all deleted (removed) members of a tenant
 */
export async function getDeletedTenantMembers(
  tenantId: string,
  pagination?: { page: number; perPage: number }
): Promise<{ members: (TenantMember & { user: User; role: Role })[]; total: number }> {
  const db = getDb();

  const conditions = [
    eq(tenantMembers.tenantId, tenantId),
    eq(tenantMembers.status, 'removed'),
  ];

  // Get total count
  const countResult = await db
    .select({ count: count() })
    .from(tenantMembers)
    .where(and(...conditions));
  const total = countResult[0]?.count ?? 0;

  const members = await db.query.tenantMembers.findMany({
    where: and(...conditions),
    with: {
      user: true,
      primaryRole: true,
    },
    orderBy: [tenantMembers.updatedAt],
    ...(pagination && {
      limit: pagination.perPage,
      offset: (pagination.page - 1) * pagination.perPage,
    }),
  });

  return {
    members: members.map((m) => ({
      ...m,
      user: m.user as User,
      role: m.primaryRole as Role,
    })),
    total,
  };
}

/**
 * Suspend a member (blocks access but preserves data)
 */
export async function suspendMember(params: {
  tenantId: string;
  memberId: string;
  suspendedBy: string;
  reason?: string;
}): Promise<{
  success: boolean;
  error?: string;
  member?: TenantMember;
}> {
  const { tenantId, memberId, suspendedBy, reason } = params;
  const db = getDb();

  // Get the member
  const member = await getMemberById(tenantId, memberId);
  if (!member) {
    return {
      success: false,
      error: 'Member not found.',
    };
  }

  // Cannot suspend the owner
  if (member.isOwner) {
    return {
      success: false,
      error: 'Cannot suspend the workspace owner.',
    };
  }

  // Cannot suspend already suspended member
  if (member.status === 'suspended') {
    return {
      success: false,
      error: 'Member is already suspended.',
    };
  }

  // Set status to suspended with tracking info
  const [updated] = await db
    .update(tenantMembers)
    .set({
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedBy,
      suspensionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, memberId))
    .returning();

  return {
    success: true,
    member: updated,
  };
}

/**
 * Unsuspend a member (restore access)
 */
export async function unsuspendMember(params: {
  tenantId: string;
  memberId: string;
  unsuspendedBy: string;
}): Promise<{
  success: boolean;
  error?: string;
  member?: TenantMember;
}> {
  const { tenantId, memberId, unsuspendedBy } = params;
  const db = getDb();

  // Get the member
  const member = await getMemberById(tenantId, memberId);
  if (!member) {
    return {
      success: false,
      error: 'Member not found.',
    };
  }

  // Can only unsuspend suspended members
  if (member.status !== 'suspended') {
    return {
      success: false,
      error: 'Member is not suspended.',
    };
  }

  // Set status back to active and clear suspension fields
  const [updated] = await db
    .update(tenantMembers)
    .set({
      status: 'active',
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, memberId))
    .returning();

  return {
    success: true,
    member: updated,
  };
}

/**
 * Restore a removed member (within retention period)
 */
export async function restoreMember(params: {
  tenantId: string;
  memberId: string;
  restoredBy: string;
}): Promise<{
  success: boolean;
  error?: string;
  member?: TenantMember;
}> {
  const { tenantId, memberId, restoredBy } = params;
  const db = getDb();

  // Get the member (including removed ones)
  const member = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.id, memberId),
      eq(tenantMembers.tenantId, tenantId)
    ),
    with: {
      user: true,
      primaryRole: true,
    },
  });

  if (!member) {
    return {
      success: false,
      error: 'Member not found.',
    };
  }

  // Can only restore removed members
  if (member.status !== 'removed') {
    return {
      success: false,
      error: 'Member is not deleted and cannot be restored.',
    };
  }

  // Check if retention period has expired
  if (member.retentionExpiresAt && new Date() > new Date(member.retentionExpiresAt)) {
    return {
      success: false,
      error: 'Retention period has expired. This member cannot be restored.',
    };
  }

  // Check plan limits before restoring
  const canAdd = await canAddMember(tenantId);
  if (!canAdd.allowed) {
    return {
      success: false,
      error: canAdd.reason || 'Cannot restore member due to plan limits.',
    };
  }

  // Restore: set status back to active and clear deletion fields
  const [updated] = await db
    .update(tenantMembers)
    .set({
      status: 'active',
      deletedAt: null,
      deletedBy: null,
      deletionReason: null,
      retentionExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, memberId))
    .returning();

  return {
    success: true,
    member: updated,
  };
}

/**
 * Transfer data ownership from one user to another
 * Updates the owner/creator fields on all user-owned data within a tenant
 *
 * Note: This function is a framework that will transfer data from tables
 * as they are implemented. Currently handles:
 * - (Add tables as they're created: workflows, agents, conversations, etc.)
 */
export async function transferDataOwnership(params: {
  tenantId: string;
  sourceUserId: string;
  targetUserId: string;
  transferredBy: string;
}): Promise<{
  success: boolean;
  error?: string;
  summary: {
    workflows: number;
    agents: number;
    conversations: number;
    files: number;
    total: number;
  };
}> {
  const { tenantId, sourceUserId, targetUserId, transferredBy } = params;
  const db = getDb();

  // Verify both users are members of the tenant
  const sourceMember = await getMemberByUserId(tenantId, sourceUserId);
  const targetMember = await getMemberByUserId(tenantId, targetUserId);

  if (!sourceMember) {
    return {
      success: false,
      error: 'Source user is not a member of this workspace.',
      summary: { workflows: 0, agents: 0, conversations: 0, files: 0, total: 0 },
    };
  }

  if (!targetMember) {
    return {
      success: false,
      error: 'Target user is not a member of this workspace.',
      summary: { workflows: 0, agents: 0, conversations: 0, files: 0, total: 0 },
    };
  }

  if (targetMember.status !== 'active') {
    return {
      success: false,
      error: 'Target user must have an active membership.',
      summary: { workflows: 0, agents: 0, conversations: 0, files: 0, total: 0 },
    };
  }

  // Summary of transferred items
  const summary = {
    workflows: 0,
    agents: 0,
    conversations: 0,
    files: 0,
    total: 0,
  };

  // TODO: Transfer workflows
  // When workflows table is implemented:
  // const workflowResult = await db
  //   .update(workflows)
  //   .set({ ownerId: targetUserId, updatedAt: new Date() })
  //   .where(and(eq(workflows.tenantId, tenantId), eq(workflows.ownerId, sourceUserId)))
  //   .returning();
  // summary.workflows = workflowResult.length;

  // TODO: Transfer agents
  // When agents table is implemented:
  // const agentResult = await db
  //   .update(agents)
  //   .set({ createdBy: targetUserId, updatedAt: new Date() })
  //   .where(and(eq(agents.tenantId, tenantId), eq(agents.createdBy, sourceUserId)))
  //   .returning();
  // summary.agents = agentResult.length;

  // TODO: Transfer conversations
  // When conversations table is implemented:
  // const conversationResult = await db
  //   .update(conversations)
  //   .set({ userId: targetUserId, updatedAt: new Date() })
  //   .where(and(eq(conversations.tenantId, tenantId), eq(conversations.userId, sourceUserId)))
  //   .returning();
  // summary.conversations = conversationResult.length;

  // TODO: Transfer files/uploads
  // When files table is implemented:
  // const fileResult = await db
  //   .update(files)
  //   .set({ uploadedBy: targetUserId, updatedAt: new Date() })
  //   .where(and(eq(files.tenantId, tenantId), eq(files.uploadedBy, sourceUserId)))
  //   .returning();
  // summary.files = fileResult.length;

  summary.total = summary.workflows + summary.agents + summary.conversations + summary.files;

  return {
    success: true,
    summary,
  };
}

export const memberService = {
  getPlanUserLimit,
  countTenantMembers,
  canAddMember,
  getTenantMembers,
  getDeletedTenantMembers,
  getMemberById,
  getMemberByUserId,
  inviteMember,
  updateMemberRole,
  suspendMember,
  unsuspendMember,
  removeMember,
  restoreMember,
  transferDataOwnership,
};
