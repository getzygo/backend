/**
 * Tenant Member Routes
 *
 * Manages team members within a tenant.
 * Enforces plan-based user limits:
 * - Core: 1 user (owner only, cannot invite)
 * - Flow: up to 50 users
 * - Scale: up to 200 users
 * - Enterprise: unlimited users
 *
 * Permissions used:
 * - canViewUsers: List members
 * - canInviteUsers: Invite new members
 * - canManageUsers: Update member roles, suspend/unsuspend
 * - canDeleteUsers: Remove members, restore deleted members
 *
 * GET /api/v1/tenants/:tenantId/members - List members (canViewUsers)
 * GET /api/v1/tenants/:tenantId/members/limits - Get member limits and usage
 * GET /api/v1/tenants/:tenantId/members/invites - List pending invites (canViewUsers)
 * POST /api/v1/tenants/:tenantId/members/invite - Invite a new member (canInviteUsers)
 * DELETE /api/v1/tenants/:tenantId/members/invites/:inviteId - Cancel invite (canInviteUsers)
 * POST /api/v1/tenants/:tenantId/members/invites/:inviteId/resend - Resend invite (canInviteUsers)
 * PATCH /api/v1/tenants/:tenantId/members/:memberId - Update member role (canManageUsers)
 * POST /api/v1/tenants/:tenantId/members/:memberId/suspend - Suspend member (canManageUsers)
 * POST /api/v1/tenants/:tenantId/members/:memberId/unsuspend - Unsuspend member (canManageUsers)
 * POST /api/v1/tenants/:tenantId/members/:memberId/restore - Restore deleted member (canDeleteUsers)
 * POST /api/v1/tenants/:tenantId/members/:memberId/transfer - Transfer data ownership (canManageUsers)
 * DELETE /api/v1/tenants/:tenantId/members/:memberId - Remove member (canDeleteUsers)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { isTenantMember, isTenantOwner } from '../../services/tenant.service';
import { hasPermission } from '../../services/permission.service';
import {
  getTenantMembers,
  getDeletedTenantMembers,
  getMemberById,
  canAddMember,
  updateMemberRole,
  suspendMember,
  unsuspendMember,
  removeMember,
  restoreMember,
  countTenantMembers,
  getPlanUserLimit,
  transferDataOwnership,
} from '../../services/member.service';
import {
  createInvite,
  getPendingInvites,
  getInviteById,
  resendInvite,
  cancelInvite,
} from '../../services/invite.service';
import { getDb } from '../../db/client';
import { auditLogs, tenants, tenantMembers } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import type { User } from '../../db/schema';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

/**
 * GET /api/v1/tenants/:tenantId/members
 * List all members of a tenant
 * Query params:
 *   - status: 'active' (default), 'deleted', 'suspended', 'all'
 * Requires canViewTeamMembers permission
 */
app.get('/:tenantId/members', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const status = c.req.query('status') || 'active';

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canView = await hasPermission(user.id, tenantId, 'canViewUsers');
  if (!canView) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view team members',
      },
      403
    );
  }

  // Fetch members based on status
  let members;
  if (status === 'deleted') {
    // For deleted members, need canDeleteUsers permission
    const canDelete = await hasPermission(user.id, tenantId, 'canDeleteUsers');
    if (!canDelete) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to view deleted members',
        },
        403
      );
    }
    members = await getDeletedTenantMembers(tenantId);
  } else {
    // Valid status values: 'active', 'suspended', 'all'
    const validStatus = status === 'all' ? 'all' : status === 'suspended' ? 'suspended' : 'active';
    members = await getTenantMembers(tenantId, validStatus);
  }

  return c.json({
    members: members.map((m) => ({
      id: m.id,
      user: {
        id: m.user.id,
        email: m.user.email,
        first_name: m.user.firstName,
        last_name: m.user.lastName,
        // Avatar: no URL exposed - fetch via /users/{userId}/avatar/file
        has_avatar: !!m.user.avatarUrl,
      },
      role: {
        id: m.role.id,
        name: m.role.name,
        slug: m.role.slug,
        hierarchy_level: m.role.hierarchyLevel,
        is_protected: m.role.isProtected,
      },
      is_owner: m.isOwner,
      status: m.status,
      joined_at: m.joinedAt,
      invited_at: m.invitedAt,
      // Suspension tracking
      suspended_at: m.suspendedAt,
      suspended_by: m.suspendedBy,
      suspension_reason: m.suspensionReason,
      // Deletion tracking (for removed members)
      deleted_at: m.deletedAt,
      deleted_by: m.deletedBy,
      deletion_reason: m.deletionReason,
      retention_expires_at: m.retentionExpiresAt,
    })),
    count: members.length,
  });
});

/**
 * GET /api/v1/tenants/:tenantId/members/limits
 * Get member limits and current usage
 * Requires canViewTeamMembers permission
 */
app.get('/:tenantId/members/limits', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Get tenant plan
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { plan: true, licenseCount: true },
  });

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  const currentCount = await countTenantMembers(tenantId);
  const baseLimit = getPlanUserLimit(tenant.plan);
  const limit = baseLimit === -1 ? -1 : Math.max(baseLimit, tenant.licenseCount ?? baseLimit);

  return c.json({
    plan: tenant.plan,
    current_count: currentCount,
    limit: limit,
    can_invite: tenant.plan !== 'core' && (limit === -1 || currentCount < limit),
    upgrade_message: tenant.plan === 'core'
      ? 'Upgrade to Flow or higher to invite team members'
      : limit !== -1 && currentCount >= limit
        ? `You've reached the ${limit} user limit. Upgrade or purchase more licenses.`
        : null,
  });
});

/**
 * GET /api/v1/tenants/:tenantId/members/invites
 * List pending invites
 * Requires canViewUsers permission
 */
app.get('/:tenantId/members/invites', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canView = await hasPermission(user.id, tenantId, 'canViewUsers');
  if (!canView) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view invites',
      },
      403
    );
  }

  const invites = await getPendingInvites(tenantId);

  return c.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: {
        id: i.role.id,
        name: i.role.name,
        slug: i.role.slug,
      },
      status: i.status,
      invited_at: i.invitedAt,
      invited_by: {
        id: i.invitedByUser.id,
        email: i.invitedByUser.email,
        first_name: i.invitedByUser.firstName,
        last_name: i.invitedByUser.lastName,
      },
      expires_at: i.expiresAt,
      resend_count: i.resendCount,
      last_resent_at: i.lastResentAt,
    })),
    count: invites.length,
  });
});

// Invite member schema
const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role_id: z.string().uuid('Invalid role ID'),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  message: z.string().max(500).optional(),
});

/**
 * POST /api/v1/tenants/:tenantId/members/invite
 * Invite a new member to the tenant
 * Creates an invite record that the user must accept
 * Requires canInviteUsers permission
 * Enforces plan-based user limits
 */
app.post(
  '/:tenantId/members/invite',
  zValidator('json', inviteMemberSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { email, role_id: roleId, first_name: firstName, last_name: lastName, message } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canInvite = await hasPermission(user.id, tenantId, 'canInviteUsers');
    if (!canInvite) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to invite members',
        },
        403
      );
    }

    // Create invite
    const result = await createInvite({
      tenantId,
      email: email.toLowerCase().trim(),
      roleId,
      invitedBy: user.id,
      firstName,
      lastName,
      message,
    });

    if (!result.success) {
      // Audit failed attempt
      await db.insert(auditLogs).values({
        userId: user.id,
        action: 'member_invite_failed',
        resourceType: 'tenant_invite',
        resourceId: tenantId,
        details: {
          email,
          error: result.error,
        },
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
        status: 'failed',
      });

      return c.json(
        {
          error: 'invite_failed',
          message: result.error,
        },
        400
      );
    }

    // Audit successful invite
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'member_invited',
      resourceType: 'tenant_invite',
      resourceId: result.invite!.id,
      details: {
        invited_email: email,
        role_id: roleId,
        expires_at: result.invite!.expiresAt,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Invitation sent successfully',
      invite: {
        id: result.invite!.id,
        email: result.invite!.email,
        role_id: roleId,
        status: result.invite!.status,
        invited_at: result.invite!.invitedAt,
        expires_at: result.invite!.expiresAt,
      },
    });
  }
);

/**
 * DELETE /api/v1/tenants/:tenantId/members/invites/:inviteId
 * Cancel a pending invite
 * Requires canInviteUsers permission
 */
app.delete('/:tenantId/members/invites/:inviteId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const inviteId = c.req.param('inviteId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canInvite = await hasPermission(user.id, tenantId, 'canInviteUsers');
  if (!canInvite) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to cancel invites',
      },
      403
    );
  }

  // Get invite details for audit
  const invite = await getInviteById(tenantId, inviteId);
  if (!invite) {
    return c.json(
      {
        error: 'invite_not_found',
        message: 'Invite not found',
      },
      404
    );
  }

  const result = await cancelInvite({
    tenantId,
    inviteId,
    cancelledBy: user.id,
  });

  if (!result.success) {
    return c.json(
      {
        error: 'cancel_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'invite_cancelled',
    resourceType: 'tenant_invite',
    resourceId: inviteId,
    details: {
      cancelled_email: invite.email,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Invite cancelled successfully',
  });
});

/**
 * POST /api/v1/tenants/:tenantId/members/invites/:inviteId/resend
 * Resend a pending invite
 * Requires canInviteUsers permission
 */
app.post('/:tenantId/members/invites/:inviteId/resend', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const inviteId = c.req.param('inviteId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canInvite = await hasPermission(user.id, tenantId, 'canInviteUsers');
  if (!canInvite) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to resend invites',
      },
      403
    );
  }

  const result = await resendInvite({
    tenantId,
    inviteId,
    resentBy: user.id,
  });

  if (!result.success) {
    return c.json(
      {
        error: 'resend_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'invite_resent',
    resourceType: 'tenant_invite',
    resourceId: inviteId,
    details: {
      resent_email: result.invite!.email,
      resend_count: result.invite!.resendCount,
      new_expires_at: result.invite!.expiresAt,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Invite resent successfully',
    invite: {
      id: result.invite!.id,
      email: result.invite!.email,
      expires_at: result.invite!.expiresAt,
      resend_count: result.invite!.resendCount,
    },
  });
});

// Update member schema
const updateMemberSchema = z.object({
  role_id: z.string().uuid('Invalid role ID'),
});

/**
 * PATCH /api/v1/tenants/:tenantId/members/:memberId
 * Update a member's role
 * Requires canManageMembers permission
 */
app.patch(
  '/:tenantId/members/:memberId',
  zValidator('json', updateMemberSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const memberId = c.req.param('memberId');
    const { role_id: roleId } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageUsers');
    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to manage members',
        },
        403
      );
    }

    // Get the member to check hierarchy
    const targetMember = await getMemberById(tenantId, memberId);
    if (!targetMember) {
      return c.json(
        {
          error: 'member_not_found',
          message: 'Member not found',
        },
        404
      );
    }

    // Prevent self-demotion (unless owner)
    if (targetMember.userId === user.id && !targetMember.isOwner) {
      return c.json(
        {
          error: 'cannot_modify_self',
          message: 'You cannot modify your own role',
        },
        400
      );
    }

    const result = await updateMemberRole({
      tenantId,
      memberId,
      newRoleId: roleId,
      updatedBy: user.id,
    });

    if (!result.success) {
      return c.json(
        {
          error: 'update_failed',
          message: result.error,
        },
        400
      );
    }

    // Audit
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'member_role_updated',
      resourceType: 'tenant_member',
      resourceId: memberId,
      details: {
        old_role_id: targetMember.role.id,
        new_role_id: roleId,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Member role updated successfully',
      member: {
        id: result.member!.id,
        role_id: roleId,
        status: result.member!.status,
      },
    });
  }
);

// Suspend member schema
const suspendMemberSchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/v1/tenants/:tenantId/members/:memberId/suspend
 * Suspend a member
 * Requires canManageUsers permission
 */
app.post(
  '/:tenantId/members/:memberId/suspend',
  zValidator('json', suspendMemberSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const memberId = c.req.param('memberId');
    const { reason } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageUsers');
    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to suspend members',
        },
        403
      );
    }

    // Get the member
    const targetMember = await getMemberById(tenantId, memberId);
    if (!targetMember) {
      return c.json(
        {
          error: 'member_not_found',
          message: 'Member not found',
        },
        404
      );
    }

    // Cannot suspend yourself
    if (targetMember.userId === user.id) {
      return c.json(
        {
          error: 'cannot_suspend_self',
          message: 'You cannot suspend yourself',
        },
        400
      );
    }

    // Cannot suspend the owner
    if (targetMember.isOwner) {
      return c.json(
        {
          error: 'cannot_suspend_owner',
          message: 'Cannot suspend the workspace owner',
        },
        400
      );
    }

    const result = await suspendMember({
      tenantId,
      memberId,
      suspendedBy: user.id,
      reason,
    });

    if (!result.success) {
      return c.json(
        {
          error: 'suspend_failed',
          message: result.error,
        },
        400
      );
    }

    // Audit
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'member_suspended',
      resourceType: 'tenant_member',
      resourceId: memberId,
      details: {
        suspended_user_id: targetMember.userId,
        suspended_email: targetMember.user.email,
        reason,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Member suspended successfully',
    });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/members/:memberId/unsuspend
 * Unsuspend a member
 * Requires canManageUsers permission
 */
app.post('/:tenantId/members/:memberId/unsuspend', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const memberId = c.req.param('memberId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canManage = await hasPermission(user.id, tenantId, 'canManageUsers');
  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to unsuspend members',
      },
      403
    );
  }

  // Get the member
  const targetMember = await getMemberById(tenantId, memberId);
  if (!targetMember) {
    return c.json(
      {
        error: 'member_not_found',
        message: 'Member not found',
      },
      404
    );
  }

  if (targetMember.status !== 'suspended') {
    return c.json(
      {
        error: 'not_suspended',
        message: 'Member is not suspended',
      },
      400
    );
  }

  const result = await unsuspendMember({
    tenantId,
    memberId,
    unsuspendedBy: user.id,
  });

  if (!result.success) {
    return c.json(
      {
        error: 'unsuspend_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'member_unsuspended',
    resourceType: 'tenant_member',
    resourceId: memberId,
    details: {
      unsuspended_user_id: targetMember.userId,
      unsuspended_email: targetMember.user.email,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Member unsuspended successfully',
  });
});

/**
 * POST /api/v1/tenants/:tenantId/members/:memberId/restore
 * Restore a removed/deleted member
 * Requires canDeleteUsers permission
 */
app.post('/:tenantId/members/:memberId/restore', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const memberId = c.req.param('memberId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission (same permission as delete)
  const canDelete = await hasPermission(user.id, tenantId, 'canDeleteUsers');
  if (!canDelete) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to restore members',
      },
      403
    );
  }

  const result = await restoreMember({
    tenantId,
    memberId,
    restoredBy: user.id,
  });

  if (!result.success) {
    return c.json(
      {
        error: 'restore_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'member_restored',
    resourceType: 'tenant_member',
    resourceId: memberId,
    details: {
      restored_user_id: result.member!.userId,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Member restored successfully',
  });
});

// Transfer ownership schema
const transferOwnershipSchema = z.object({
  target_member_id: z.string().uuid('Invalid target member ID'),
});

/**
 * POST /api/v1/tenants/:tenantId/members/:memberId/transfer
 * Transfer data ownership from one member to another
 * Requires canManageUsers permission
 */
app.post(
  '/:tenantId/members/:memberId/transfer',
  zValidator('json', transferOwnershipSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const sourceMemberId = c.req.param('memberId');
    const { target_member_id: targetMemberId } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageUsers');
    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to transfer data ownership',
        },
        403
      );
    }

    // Get source member
    const sourceMember = await getMemberById(tenantId, sourceMemberId);
    if (!sourceMember) {
      return c.json(
        {
          error: 'source_not_found',
          message: 'Source member not found',
        },
        404
      );
    }

    // Get target member
    const targetMember = await getMemberById(tenantId, targetMemberId);
    if (!targetMember) {
      return c.json(
        {
          error: 'target_not_found',
          message: 'Target member not found',
        },
        404
      );
    }

    // Cannot transfer to same member
    if (sourceMemberId === targetMemberId) {
      return c.json(
        {
          error: 'same_member',
          message: 'Cannot transfer to the same member',
        },
        400
      );
    }

    // Perform the data transfer
    const result = await transferDataOwnership({
      tenantId,
      sourceUserId: sourceMember.userId,
      targetUserId: targetMember.userId,
      transferredBy: user.id,
    });

    if (!result.success) {
      return c.json(
        {
          error: 'transfer_failed',
          message: result.error,
        },
        400
      );
    }

    // Audit
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'data_ownership_transferred',
      resourceType: 'tenant_member',
      resourceId: sourceMemberId,
      details: {
        source_user_id: sourceMember.userId,
        target_user_id: targetMember.userId,
        target_member_id: targetMemberId,
        items_transferred: result.summary,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Data ownership transferred successfully',
      summary: result.summary,
    });
  }
);

/**
 * DELETE /api/v1/tenants/:tenantId/members/:memberId
 * Remove a member from the tenant
 * Requires canDeleteUsers permission
 * Body (optional): { reason?: string }
 */
app.delete('/:tenantId/members/:memberId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const memberId = c.req.param('memberId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Parse optional body for deletion reason
  let reason: string | undefined;
  try {
    const body = await c.req.json();
    if (body && typeof body.reason === 'string') {
      reason = body.reason.slice(0, 500); // Limit reason to 500 chars
    }
  } catch {
    // Body is optional, ignore parse errors
  }

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canRemove = await hasPermission(user.id, tenantId, 'canDeleteUsers');
  if (!canRemove) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to remove members',
      },
      403
    );
  }

  // Get the member
  const targetMember = await getMemberById(tenantId, memberId);
  if (!targetMember) {
    return c.json(
      {
        error: 'member_not_found',
        message: 'Member not found',
      },
      404
    );
  }

  // Cannot remove yourself
  if (targetMember.userId === user.id) {
    return c.json(
      {
        error: 'cannot_remove_self',
        message: 'You cannot remove yourself from the workspace',
      },
      400
    );
  }

  const result = await removeMember({
    tenantId,
    memberId,
    removedBy: user.id,
    reason,
  });

  if (!result.success) {
    return c.json(
      {
        error: 'remove_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'member_removed',
    resourceType: 'tenant_member',
    resourceId: memberId,
    details: {
      removed_user_id: targetMember.userId,
      removed_email: targetMember.user.email,
      reason: reason || null,
      retention_days: 30,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Member removed successfully',
    retention_days: 30,
  });
});

export default app;
