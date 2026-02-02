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
 */
export async function getTenantMembers(tenantId: string): Promise<
  (TenantMember & { user: User; role: Role })[]
> {
  const db = getDb();

  const members = await db.query.tenantMembers.findMany({
    where: and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    with: {
      user: true,
      primaryRole: true,
    },
    orderBy: [tenantMembers.isOwner, tenantMembers.joinedAt],
  });

  return members.map((m) => ({
    ...m,
    user: m.user as User,
    role: m.primaryRole as Role,
  }));
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
}): Promise<{
  success: boolean;
  error?: string;
}> {
  const { tenantId, memberId, removedBy } = params;
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

  // Soft-delete: set status to 'removed'
  await db
    .update(tenantMembers)
    .set({
      status: 'removed',
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, memberId));

  return {
    success: true,
  };
}

export const memberService = {
  getPlanUserLimit,
  countTenantMembers,
  canAddMember,
  getTenantMembers,
  getMemberById,
  getMemberByUserId,
  inviteMember,
  updateMemberRole,
  removeMember,
};
