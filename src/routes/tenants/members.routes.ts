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
 * - canManageUsers: Update member roles
 * - canDeleteUsers: Remove members
 *
 * GET /api/v1/tenants/:tenantId/members - List members (canViewUsers)
 * GET /api/v1/tenants/:tenantId/members/limits - Get member limits and usage
 * POST /api/v1/tenants/:tenantId/members/invite - Invite a new member (canInviteUsers)
 * PATCH /api/v1/tenants/:tenantId/members/:memberId - Update member role (canManageUsers)
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
  getMemberById,
  canAddMember,
  inviteMember,
  updateMemberRole,
  removeMember,
  countTenantMembers,
  getPlanUserLimit,
} from '../../services/member.service';
import { getDb } from '../../db/client';
import { auditLogs, tenants } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { User } from '../../db/schema';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

/**
 * GET /api/v1/tenants/:tenantId/members
 * List all members of a tenant
 * Requires canViewTeamMembers permission
 */
app.get('/:tenantId/members', async (c) => {
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
        message: 'You do not have permission to view team members',
      },
      403
    );
  }

  const members = await getTenantMembers(tenantId);

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

// Invite member schema
const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role_id: z.string().uuid('Invalid role ID'),
});

/**
 * POST /api/v1/tenants/:tenantId/members/invite
 * Invite a new member to the tenant
 * Requires canInviteMembers permission
 * Enforces plan-based user limits
 */
app.post(
  '/:tenantId/members/invite',
  zValidator('json', inviteMemberSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { email, role_id: roleId } = c.req.valid('json');
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

    // Attempt to invite
    const result = await inviteMember({
      tenantId,
      email: email.toLowerCase().trim(),
      roleId,
      invitedBy: user.id,
    });

    if (!result.success) {
      // Audit failed attempt
      await db.insert(auditLogs).values({
        userId: user.id,
        action: 'member_invite_failed',
        resourceType: 'tenant_member',
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
      resourceType: 'tenant_member',
      resourceId: result.member!.id,
      details: {
        invited_user_id: result.user!.id,
        invited_email: email,
        role_id: roleId,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Member invited successfully',
      member: {
        id: result.member!.id,
        user: {
          id: result.user!.id,
          email: result.user!.email,
          first_name: result.user!.firstName,
          last_name: result.user!.lastName,
        },
        role_id: roleId,
        status: result.member!.status,
        joined_at: result.member!.joinedAt,
      },
    });
  }
);

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

/**
 * DELETE /api/v1/tenants/:tenantId/members/:memberId
 * Remove a member from the tenant
 * Requires canRemoveMembers permission
 */
app.delete('/:tenantId/members/:memberId', async (c) => {
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
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Member removed successfully',
  });
});

export default app;
