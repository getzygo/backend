/**
 * Invite Routes
 *
 * Public and authenticated routes for handling invite acceptance.
 *
 * GET /api/v1/invites/magic-accept - One-click invite accept via magic link (existing users)
 * POST /api/v1/invites/:token/signup-accept - Sign up + accept invite (new users)
 * GET /api/v1/invites/:token - Get invite details (public, for preview)
 * POST /api/v1/invites/:token/accept - Accept invite (requires auth)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware';
import { rateLimit, RATE_LIMITS } from '../middleware/rate-limit.middleware';
import { getInviteByToken, acceptInvite } from '../services/invite.service';
import { verifyMagicLink } from '../services/magic-link.service';
import { createAuthToken, type TenantMembership } from '../services/auth-token.service';
import { createAuthUser, generateSessionForUser } from '../services/supabase.service';
import { hashPassword } from '../services/user.service';
import { sendInviteWelcomeEmail } from '../services/email.service';
import { getDb } from '../db/client';
import { auditLogs, users, tenantMembers, tenants, roles } from '../db/schema';
import type { User } from '../db/schema';

const app = new Hono();

/**
 * GET /api/v1/invites/magic-accept
 * One-click invite acceptance via magic link (existing users).
 * Validates invite + magic link, accepts invite, creates session, redirects.
 */
app.get('/magic-accept', rateLimit(RATE_LIMITS.AUTH), async (c) => {
  const inviteToken = c.req.query('invite');
  const mlToken = c.req.query('ml');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  if (!inviteToken || !mlToken) {
    return c.redirect('https://getzygo.com/?error=invalid_link');
  }

  // 1. Validate invite
  const invite = await getInviteByToken(inviteToken);
  if (!invite || invite.status !== 'pending' || new Date() > new Date(invite.expiresAt)) {
    return c.redirect(
      `https://${invite?.tenant?.slug || 'app'}.zygo.tech/invite/${inviteToken}?error=invite_invalid`
    );
  }

  // 2. Verify magic link (single-use, consumed on verification)
  const mlResult = await verifyMagicLink(mlToken, ipAddress, userAgent);
  if (!mlResult.success) {
    return c.redirect(
      `https://${invite.tenant.slug}.zygo.tech/invite/${inviteToken}?error=magic_link_expired`
    );
  }

  // 3. Verify email match (prevents token substitution)
  if (mlResult.email!.toLowerCase() !== invite.email.toLowerCase()) {
    return c.redirect(
      `https://${invite.tenant.slug}.zygo.tech/invite/${inviteToken}?error=email_mismatch`
    );
  }

  // 4. Get user and check status
  const user = await db.query.users.findFirst({
    where: eq(users.email, mlResult.email!),
  });

  if (!user || user.status === 'suspended' || user.status === 'deleted') {
    return c.redirect(
      `https://${invite.tenant.slug}.zygo.tech/invite/${inviteToken}?error=account_unavailable`
    );
  }

  // 5. MFA check skipped for magic invite links.
  // The magic link itself is a strong single-use authentication factor:
  // - Sent to the invitee's verified email (proves email ownership)
  // - Single-use (consumed on verification)
  // - Time-limited (24-hour expiry)
  // This is equivalent to or stronger than a TOTP code.

  // 6. Accept invite
  const acceptResult = await acceptInvite({
    token: inviteToken,
    userId: user.id,
  });

  if (!acceptResult.success) {
    return c.redirect(
      `https://${invite.tenant.slug}.zygo.tech/invite/${inviteToken}?error=accept_failed`
    );
  }

  // 7. Generate session (same pattern as magic-link.routes.ts)
  const memberships = await db
    .select({
      tenantId: tenantMembers.tenantId,
      isOwner: tenantMembers.isOwner,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantPlan: tenants.plan,
      roleId: roles.id,
      roleName: roles.name,
      roleSlug: roles.slug,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .innerJoin(roles, eq(tenantMembers.primaryRoleId, roles.id))
    .where(
      and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.status, 'active')
      )
    );

  // Target the invite's tenant membership (user just joined)
  const targetMembership = memberships.find((m) => m.tenantId === invite.tenantId) || memberships[0];

  if (!targetMembership) {
    return c.redirect(
      `https://${invite.tenant.slug}.zygo.tech/invite/${inviteToken}?error=no_membership`
    );
  }

  const tenantMemberships: TenantMembership[] = memberships.map((m) => ({
    id: m.tenantId,
    name: m.tenantName,
    slug: m.tenantSlug,
    plan: m.tenantPlan || 'free',
    role: {
      id: m.roleId,
      name: m.roleName,
    },
    isOwner: m.isOwner,
  }));

  // Generate Supabase session tokens
  let supabaseAccessToken: string | undefined;
  let supabaseRefreshToken: string | undefined;

  const sessionResult = await generateSessionForUser(user.id);
  if (sessionResult.session) {
    supabaseAccessToken = sessionResult.session.access_token;
    supabaseRefreshToken = sessionResult.session.refresh_token;
  }

  // Generate opaque auth token
  const authToken = await createAuthToken({
    userId: user.id,
    tenantId: targetMembership.tenantId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl || undefined,
    avatarSource: user.avatarSource || undefined,
    emailVerified: user.emailVerified,
    emailVerifiedVia: user.emailVerifiedVia,
    authMethod: 'magic_link',
    oauthProvider: null,
    hasPassword: user.passwordHash !== null,
    roleId: targetMembership.roleId,
    roleName: targetMembership.roleName,
    roleSlug: targetMembership.roleSlug,
    isOwner: targetMembership.isOwner,
    supabaseAccessToken,
    supabaseRefreshToken,
    tenantMemberships,
  });

  // Update last login
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || null,
    })
    .where(eq(users.id, user.id));

  // 8. Audit logs
  await Promise.all([
    db.insert(auditLogs).values({
      userId: user.id,
      action: 'login',
      resourceType: 'user',
      resourceId: user.id,
      details: { method: 'magic_link', via: 'magic_invite' },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    }),
    db.insert(auditLogs).values({
      userId: user.id,
      action: 'invite_accepted',
      resourceType: 'tenant_invite',
      resourceId: invite.id,
      details: {
        tenant_id: invite.tenantId,
        tenant_slug: invite.tenant.slug,
        member_id: acceptResult.memberId,
        role_id: invite.roleId,
        via: 'magic_invite',
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    }),
  ]);

  // 9. Redirect to tenant app with auth token in fragment (not sent to server)
  return c.redirect(
    `https://${invite.tenant.slug}.zygo.tech/#auth_token=${authToken}`
  );
});

// Signup + accept schema for new users
const signupAcceptSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
});

/**
 * POST /api/v1/invites/:token/signup-accept
 * Create a new account and accept invite in one step (new users without a Zygo account)
 */
app.post('/:token/signup-accept', rateLimit(RATE_LIMITS.AUTH), zValidator('json', signupAcceptSchema), async (c) => {
  const token = c.req.param('token');
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // 1. Validate invite
  const invite = await getInviteByToken(token);
  if (!invite || invite.status !== 'pending' || new Date() > new Date(invite.expiresAt)) {
    return c.json({ error: 'invite_invalid', message: 'Invalid or expired invite.' }, 400);
  }

  // 2. Check email doesn't already have an account
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, invite.email),
  });
  if (existingUser) {
    return c.json({
      error: 'account_exists',
      message: 'An account already exists for this email. Please sign in instead.',
    }, 400);
  }

  // 3. Create user in Supabase Auth
  const authResult = await createAuthUser(invite.email, body.password, {
    first_name: body.first_name,
    last_name: body.last_name,
  });
  if (authResult.error || !authResult.user) {
    return c.json({ error: 'signup_failed', message: authResult.error || 'Failed to create account.' }, 500);
  }

  const supabaseUserId = authResult.user.id;

  // 4. Create user in app database (same ID as Supabase for JWT validation)
  const passwordHash = await hashPassword(body.password);
  const now = new Date();

  const [newUser] = await db
    .insert(users)
    .values({
      id: supabaseUserId,
      email: invite.email,
      emailVerified: true,
      emailVerifiedVia: 'invite',
      passwordHash,
      firstName: body.first_name,
      lastName: body.last_name,
      displayName: `${body.first_name} ${body.last_name}`.trim(),
      status: 'active',
      passwordChangedAt: now,
    })
    .returning();

  // 5. Accept invite (creates tenant membership)
  const acceptResult = await acceptInvite({ token, userId: newUser.id });
  if (!acceptResult.success) {
    return c.json({ error: 'accept_failed', message: acceptResult.error || 'Failed to accept invite.' }, 500);
  }

  // 6. Generate session tokens
  const memberships = await db
    .select({
      tenantId: tenantMembers.tenantId,
      isOwner: tenantMembers.isOwner,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantPlan: tenants.plan,
      roleId: roles.id,
      roleName: roles.name,
      roleSlug: roles.slug,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .innerJoin(roles, eq(tenantMembers.primaryRoleId, roles.id))
    .where(
      and(
        eq(tenantMembers.userId, newUser.id),
        eq(tenantMembers.status, 'active')
      )
    );

  const targetMembership = memberships.find((m) => m.tenantId === invite.tenantId) || memberships[0];
  if (!targetMembership) {
    return c.json({ error: 'no_membership', message: 'Membership creation failed.' }, 500);
  }

  const tenantMemberships: TenantMembership[] = memberships.map((m) => ({
    id: m.tenantId,
    name: m.tenantName,
    slug: m.tenantSlug,
    plan: m.tenantPlan || 'free',
    role: { id: m.roleId, name: m.roleName },
    isOwner: m.isOwner,
  }));

  // Generate Supabase session
  let supabaseAccessToken: string | undefined;
  let supabaseRefreshToken: string | undefined;
  const sessionResult = await generateSessionForUser(newUser.id);
  if (sessionResult.session) {
    supabaseAccessToken = sessionResult.session.access_token;
    supabaseRefreshToken = sessionResult.session.refresh_token;
  }

  // Generate opaque auth token
  const authToken = await createAuthToken({
    userId: newUser.id,
    tenantId: targetMembership.tenantId,
    email: newUser.email,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    avatarUrl: undefined,
    avatarSource: undefined,
    emailVerified: true,
    emailVerifiedVia: 'invite',
    authMethod: 'password',
    oauthProvider: null,
    hasPassword: true,
    roleId: targetMembership.roleId,
    roleName: targetMembership.roleName,
    roleSlug: targetMembership.roleSlug,
    isOwner: targetMembership.isOwner,
    supabaseAccessToken,
    supabaseRefreshToken,
    tenantMemberships,
  });

  // 7. Update last login
  await db
    .update(users)
    .set({ lastLoginAt: now, lastLoginIp: ipAddress || null })
    .where(eq(users.id, newUser.id));

  // 8. Audit logs
  await Promise.all([
    db.insert(auditLogs).values({
      userId: newUser.id,
      action: 'signup',
      resourceType: 'user',
      resourceId: newUser.id,
      details: { method: 'invite', tenant_id: invite.tenantId },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    }),
    db.insert(auditLogs).values({
      userId: newUser.id,
      action: 'invite_accepted',
      resourceType: 'tenant_invite',
      resourceId: invite.id,
      details: {
        tenant_id: invite.tenantId,
        tenant_slug: invite.tenant.slug,
        member_id: acceptResult.memberId,
        role_id: invite.roleId,
        via: 'signup_accept',
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    }),
  ]);

  // 9. Send welcome email to new user (non-blocking)
  sendInviteWelcomeEmail(newUser.email, {
    firstName: newUser.firstName || undefined,
    tenantName: invite.tenant.name,
    tenantSlug: invite.tenant.slug,
    roleName: targetMembership.roleName,
  }).catch((err) => console.error('[Invite] Welcome email failed:', err));

  // 10. Return auth data (frontend will store and redirect)
  return c.json({
    success: true,
    auth_token: authToken,
    redirect_url: `https://${invite.tenant.slug}.zygo.tech/#auth_token=${authToken}`,
    user: {
      id: newUser.id,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
    },
    tenant: {
      slug: invite.tenant.slug,
      name: invite.tenant.name,
    },
  });
});

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
      first_name: invite.firstName || null,
      last_name: invite.lastName || null,
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
