/**
 * Invite Service
 *
 * Handles tenant member invitations with full lifecycle:
 * - Create invites (for existing or new users)
 * - List pending invites
 * - Resend invites
 * - Cancel invites
 * - Accept invites (creates membership)
 * - Auto-expire invites
 */

import { eq, and, lt, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { getDb } from '../db/client';
import {
  tenantInvites,
  tenantMembers,
  users,
  roles,
  tenants,
  type TenantInvite,
  type Role,
  type User,
} from '../db/schema';
import { canAddMember } from './member.service';
import { sendTeamInviteEmail } from './email.service';

// Invite expiration: 7 days
const INVITE_EXPIRATION_DAYS = 7;
// Maximum resend count
const MAX_RESEND_COUNT = 5;

/**
 * Generate a secure random token for invite links
 */
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Calculate expiration date from now
 */
function getExpirationDate(days: number = INVITE_EXPIRATION_DAYS): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Create a new invite
 */
export async function createInvite(params: {
  tenantId: string;
  email: string;
  roleId: string;
  invitedBy: string;
  message?: string;
}): Promise<{
  success: boolean;
  error?: string;
  invite?: TenantInvite;
}> {
  const { tenantId, email, roleId, invitedBy, message } = params;
  const db = getDb();
  const normalizedEmail = email.toLowerCase().trim();

  // Check if we can add more members (plan limits)
  const canAdd = await canAddMember(tenantId);
  if (!canAdd.allowed) {
    return {
      success: false,
      error: canAdd.reason,
    };
  }

  // Check if invite already exists and is pending
  const existingInvite = await db.query.tenantInvites.findFirst({
    where: and(
      eq(tenantInvites.tenantId, tenantId),
      eq(tenantInvites.email, normalizedEmail),
      eq(tenantInvites.status, 'pending')
    ),
  });

  if (existingInvite) {
    return {
      success: false,
      error: 'An active invite already exists for this email address.',
    };
  }

  // Check if user is already a member
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (existingUser) {
    const existingMembership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, existingUser.id)
      ),
    });

    if (existingMembership) {
      if (existingMembership.status === 'active') {
        return {
          success: false,
          error: 'This user is already a member of this workspace.',
        };
      }
      if (existingMembership.status === 'suspended') {
        return {
          success: false,
          error: 'This user is currently suspended. Unsuspend them instead of sending a new invite.',
        };
      }
      // 'removed' status - can re-invite
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

  // Prevent assigning Owner role
  if (role.slug === 'owner') {
    return {
      success: false,
      error: 'Cannot invite users with the Owner role.',
    };
  }

  // Get tenant info for the email
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { name: true, slug: true },
  });

  // Get inviter info for the email
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, invitedBy),
    columns: { firstName: true, lastName: true, email: true },
  });

  // Create the invite
  const token = generateInviteToken();
  const [invite] = await db
    .insert(tenantInvites)
    .values({
      tenantId,
      email: normalizedEmail,
      userId: existingUser?.id,
      roleId,
      token,
      status: 'pending',
      expiresAt: getExpirationDate(),
      invitedBy,
      message,
    })
    .returning();

  // Send invite email
  const inviterName = inviter
    ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.email
    : 'A team member';

  await sendTeamInviteEmail(normalizedEmail, {
    inviteeName: existingUser?.firstName || undefined,
    inviterName,
    tenantName: tenant?.name || 'a workspace',
    roleName: role.name,
    message,
    inviteToken: token,
    tenantSlug: tenant?.slug || 'app',
    expiresInDays: INVITE_EXPIRATION_DAYS,
  });

  return {
    success: true,
    invite,
  };
}

/**
 * Get all pending invites for a tenant
 */
export async function getPendingInvites(tenantId: string): Promise<
  (TenantInvite & { role: Role; invitedByUser: User })[]
> {
  const db = getDb();

  // First, expire any invites that are past their expiration date
  await expireOldInvites(tenantId);

  const invites = await db.query.tenantInvites.findMany({
    where: and(
      eq(tenantInvites.tenantId, tenantId),
      eq(tenantInvites.status, 'pending')
    ),
    with: {
      role: true,
      invitedByUser: true,
    },
    orderBy: [tenantInvites.invitedAt],
  });

  return invites.map((i) => ({
    ...i,
    role: i.role as Role,
    invitedByUser: i.invitedByUser as User,
  }));
}

/**
 * Get invite by ID
 */
export async function getInviteById(
  tenantId: string,
  inviteId: string
): Promise<TenantInvite | null> {
  const db = getDb();

  const invite = await db.query.tenantInvites.findFirst({
    where: and(
      eq(tenantInvites.id, inviteId),
      eq(tenantInvites.tenantId, tenantId)
    ),
  });

  return invite || null;
}

/**
 * Get invite by token (for acceptance flow)
 */
export async function getInviteByToken(token: string): Promise<
  (TenantInvite & { role: Role; tenant: { id: string; name: string; slug: string } }) | null
> {
  const db = getDb();

  const invite = await db.query.tenantInvites.findFirst({
    where: eq(tenantInvites.token, token),
    with: {
      role: true,
      tenant: {
        columns: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!invite) return null;

  return {
    ...invite,
    role: invite.role as Role,
    tenant: invite.tenant as { id: string; name: string; slug: string },
  };
}

/**
 * Resend an invite (generates new token and extends expiration)
 */
export async function resendInvite(params: {
  tenantId: string;
  inviteId: string;
  resentBy: string;
}): Promise<{
  success: boolean;
  error?: string;
  invite?: TenantInvite;
}> {
  const { tenantId, inviteId, resentBy } = params;
  const db = getDb();

  const invite = await getInviteById(tenantId, inviteId);

  if (!invite) {
    return {
      success: false,
      error: 'Invite not found.',
    };
  }

  if (invite.status !== 'pending') {
    return {
      success: false,
      error: `Cannot resend invite with status '${invite.status}'.`,
    };
  }

  if (invite.resendCount >= MAX_RESEND_COUNT) {
    return {
      success: false,
      error: `Maximum resend limit (${MAX_RESEND_COUNT}) reached. Please cancel and create a new invite.`,
    };
  }

  // Generate new token and extend expiration
  const newToken = generateInviteToken();
  const [updated] = await db
    .update(tenantInvites)
    .set({
      token: newToken,
      expiresAt: getExpirationDate(),
      lastResentAt: new Date(),
      resendCount: invite.resendCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(tenantInvites.id, inviteId))
    .returning();

  // Get tenant, role, and inviter info for the email
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { name: true, slug: true },
  });

  const role = await db.query.roles.findFirst({
    where: eq(roles.id, invite.roleId),
    columns: { name: true },
  });

  const inviter = await db.query.users.findFirst({
    where: eq(users.id, invite.invitedBy),
    columns: { firstName: true, lastName: true, email: true },
  });

  // Get invitee user info if they exist
  const inviteeUser = invite.userId
    ? await db.query.users.findFirst({
        where: eq(users.id, invite.userId),
        columns: { firstName: true },
      })
    : null;

  // Send invite email
  const inviterName = inviter
    ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.email
    : 'A team member';

  await sendTeamInviteEmail(invite.email, {
    inviteeName: inviteeUser?.firstName || undefined,
    inviterName,
    tenantName: tenant?.name || 'a workspace',
    roleName: role?.name || 'Member',
    message: invite.message || undefined,
    inviteToken: newToken,
    tenantSlug: tenant?.slug || 'app',
    expiresInDays: INVITE_EXPIRATION_DAYS,
  });

  return {
    success: true,
    invite: updated,
  };
}

/**
 * Cancel an invite
 */
export async function cancelInvite(params: {
  tenantId: string;
  inviteId: string;
  cancelledBy: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  const { tenantId, inviteId, cancelledBy } = params;
  const db = getDb();

  const invite = await getInviteById(tenantId, inviteId);

  if (!invite) {
    return {
      success: false,
      error: 'Invite not found.',
    };
  }

  if (invite.status !== 'pending') {
    return {
      success: false,
      error: `Cannot cancel invite with status '${invite.status}'.`,
    };
  }

  await db
    .update(tenantInvites)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy,
      updatedAt: new Date(),
    })
    .where(eq(tenantInvites.id, inviteId));

  return {
    success: true,
  };
}

/**
 * Accept an invite (creates membership)
 */
export async function acceptInvite(params: {
  token: string;
  userId: string;
}): Promise<{
  success: boolean;
  error?: string;
  memberId?: string;
  tenantSlug?: string;
}> {
  const { token, userId } = params;
  const db = getDb();

  // Get the invite
  const invite = await getInviteByToken(token);

  if (!invite) {
    return {
      success: false,
      error: 'Invalid or expired invite link.',
    };
  }

  if (invite.status !== 'pending') {
    return {
      success: false,
      error: `This invite has already been ${invite.status}.`,
    };
  }

  if (new Date() > new Date(invite.expiresAt)) {
    // Mark as expired
    await db
      .update(tenantInvites)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(tenantInvites.id, invite.id));

    return {
      success: false,
      error: 'This invite has expired. Please request a new invitation.',
    };
  }

  // Get the accepting user
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return {
      success: false,
      error: 'User not found.',
    };
  }

  // Check if user email matches invite email (case-insensitive)
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return {
      success: false,
      error: 'This invite was sent to a different email address.',
    };
  }

  // Check plan limits again
  const canAdd = await canAddMember(invite.tenantId);
  if (!canAdd.allowed) {
    return {
      success: false,
      error: canAdd.reason || 'Cannot add member due to plan limits.',
    };
  }

  // Check if already a member
  const existingMembership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.tenantId, invite.tenantId),
      eq(tenantMembers.userId, userId)
    ),
  });

  let memberId: string;

  if (existingMembership) {
    if (existingMembership.status === 'active') {
      return {
        success: false,
        error: 'You are already a member of this workspace.',
      };
    }

    // Reactivate if previously removed
    const [updated] = await db
      .update(tenantMembers)
      .set({
        status: 'active',
        primaryRoleId: invite.roleId,
        invitedBy: invite.invitedBy,
        invitedAt: invite.invitedAt,
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantMembers.id, existingMembership.id))
      .returning();

    memberId = updated.id;
  } else {
    // Create new membership
    const [member] = await db
      .insert(tenantMembers)
      .values({
        tenantId: invite.tenantId,
        userId,
        primaryRoleId: invite.roleId,
        isOwner: false,
        status: 'active',
        invitedBy: invite.invitedBy,
        invitedAt: invite.invitedAt,
        joinedAt: new Date(),
      })
      .returning();

    memberId = member.id;
  }

  // Mark invite as accepted
  await db
    .update(tenantInvites)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
      memberId,
      updatedAt: new Date(),
    })
    .where(eq(tenantInvites.id, invite.id));

  return {
    success: true,
    memberId,
    tenantSlug: invite.tenant.slug,
  };
}

/**
 * Expire old invites for a tenant
 */
export async function expireOldInvites(tenantId?: string): Promise<number> {
  const db = getDb();

  const conditions = [
    eq(tenantInvites.status, 'pending'),
    lt(tenantInvites.expiresAt, new Date()),
  ];

  if (tenantId) {
    conditions.push(eq(tenantInvites.tenantId, tenantId));
  }

  const result = await db
    .update(tenantInvites)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  return result.length;
}

/**
 * Get invite statistics for a tenant
 */
export async function getInviteStats(tenantId: string): Promise<{
  pending: number;
  accepted: number;
  expired: number;
  cancelled: number;
}> {
  const db = getDb();

  const invites = await db.query.tenantInvites.findMany({
    where: eq(tenantInvites.tenantId, tenantId),
    columns: { status: true },
  });

  const stats = {
    pending: 0,
    accepted: 0,
    expired: 0,
    cancelled: 0,
  };

  for (const invite of invites) {
    if (invite.status in stats) {
      stats[invite.status as keyof typeof stats]++;
    }
  }

  return stats;
}

export const inviteService = {
  createInvite,
  getPendingInvites,
  getInviteById,
  getInviteByToken,
  resendInvite,
  cancelInvite,
  acceptInvite,
  expireOldInvites,
  getInviteStats,
};
