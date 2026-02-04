/**
 * Invite Routes
 *
 * Public and authenticated routes for handling invite acceptance.
 *
 * GET /api/v1/invites/:token - Get invite details (public, for preview)
 * POST /api/v1/invites/:token/accept - Accept invite (requires auth)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { getInviteByToken, acceptInvite } from '../services/invite.service';
import { getDb } from '../db/client';
import { auditLogs } from '../db/schema';
import type { User } from '../db/schema';

const app = new Hono();

/**
 * GET /api/v1/invites/:token
 * Get invite details for preview (before accepting)
 * Public endpoint - no auth required
 */
app.get('/:token', async (c) => {
  const token = c.req.param('token');

  const invite = await getInviteByToken(token);

  if (!invite) {
    return c.json(
      {
        error: 'invite_not_found',
        message: 'Invalid or expired invite link.',
      },
      404
    );
  }

  // Check if expired
  if (new Date() > new Date(invite.expiresAt)) {
    return c.json(
      {
        error: 'invite_expired',
        message: 'This invite has expired. Please request a new invitation.',
      },
      410
    );
  }

  if (invite.status !== 'pending') {
    return c.json(
      {
        error: 'invite_invalid',
        message: `This invite has already been ${invite.status}.`,
      },
      410
    );
  }

  // Return invite details (safe for public view)
  return c.json({
    invite: {
      id: invite.id,
      email: invite.email,
      tenant: {
        name: invite.tenant.name,
        slug: invite.tenant.slug,
      },
      role: {
        name: invite.role.name,
      },
      expires_at: invite.expiresAt,
      message: invite.message,
    },
  });
});

/**
 * POST /api/v1/invites/:token/accept
 * Accept an invite (creates membership)
 * Requires authentication - user must be logged in
 */
app.post('/:token/accept', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const token = c.req.param('token');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Get invite for audit details
  const invite = await getInviteByToken(token);

  const result = await acceptInvite({
    token,
    userId: user.id,
  });

  if (!result.success) {
    // Audit failed attempt
    if (invite) {
      await db.insert(auditLogs).values({
        userId: user.id,
        action: 'invite_accept_failed',
        resourceType: 'tenant_invite',
        resourceId: invite.id,
        details: {
          error: result.error,
          tenant_id: invite.tenantId,
        },
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
        status: 'failed',
      });
    }

    return c.json(
      {
        error: 'accept_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit successful acceptance
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'invite_accepted',
    resourceType: 'tenant_invite',
    resourceId: invite!.id,
    details: {
      tenant_id: invite!.tenantId,
      tenant_slug: result.tenantSlug,
      member_id: result.memberId,
      role_id: invite!.roleId,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Invite accepted successfully. Welcome to the workspace!',
    member_id: result.memberId,
    tenant_slug: result.tenantSlug,
  });
});

export default app;
